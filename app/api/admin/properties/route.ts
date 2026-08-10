import type { NextRequest } from "next/server";
import type { Prisma, PropertyStatus } from "@prisma/client";

import { createProperty } from "@/lib/admin-properties";
import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  firstIssueMessage,
  listQuerySchema,
  propertyCreateSchema,
  propertyStatusSchema,
} from "@/lib/validations";

/**
 * GET  /api/admin/properties — every listing, any status. VIEWER+.
 * POST /api/admin/properties — create a DRAFT listing. CURATOR+.
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: NextRequest): Promise<Response> => {
  await requireRole("VIEWER");

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
  const { status, q, limit, offset } = parsed.data;

  const statusFilter = status ? propertyStatusSchema.safeParse(status) : null;
  if (status && !statusFilter?.success) return apiError("Unknown status filter", 400);

  const where: Prisma.PropertyWhereInput = {
    ...(statusFilter?.success ? { status: statusFilter.data as PropertyStatus } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { locality: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [properties, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        slug: true,
        name: true,
        locality: true,
        status: true,
        bhk: true,
        pricePaise: true,
        weeklyViewingSlots: true,
        publishedAt: true,
        updatedAt: true,
        _count: { select: { enquiries: true, viewings: true } },
      },
    }),
    prisma.property.count({ where }),
  ]);

  return apiOk({ properties, total, limit, offset });
});

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  await requireRole("CURATOR");

  const raw = await req.json().catch(() => null);
  const parsed = propertyCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  const property = await createProperty(parsed.data);
  return apiOk(property, 201);
});
