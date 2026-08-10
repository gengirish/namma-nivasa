import type { NextRequest } from "next/server";
import type { EnquiryStatus, Prisma } from "@prisma/client";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstIssueMessage, listQuerySchema } from "@/lib/validations";

/** GET /api/admin/enquiries — the inbox, newest first. VIEWER+. */
export const dynamic = "force-dynamic";

const STATUSES = ["NEW", "CONTACTED", "SCHEDULED", "CLOSED", "CANCELLED"] as const;

export const GET = withApiErrors(async (req: NextRequest): Promise<Response> => {
  await requireRole("VIEWER");

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
  const { status, q, limit, offset } = parsed.data;

  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return apiError("Unknown status filter", 400);
  }

  const where: Prisma.EnquiryWhereInput = {
    ...(status ? { status: status as EnquiryStatus } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { reference: { contains: q, mode: "insensitive" as const } },
            { propertyName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [enquiries, total, counts] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      skip: offset,
      include: {
        viewing: { select: { scheduledFor: true, status: true } },
        handler: { select: { name: true, email: true } },
      },
    }),
    prisma.enquiry.count({ where }),
    prisma.enquiry.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return apiOk({
    enquiries,
    total,
    limit,
    offset,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});
