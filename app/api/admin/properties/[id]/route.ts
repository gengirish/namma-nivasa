import type { NextRequest } from "next/server";

import { archiveProperty, updateProperty } from "@/lib/admin-properties";
import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstIssueMessage, propertyUpdateSchema } from "@/lib/validations";

/**
 * GET    /api/admin/properties/[id] — the full row, for the editor. VIEWER+.
 * PATCH  /api/admin/properties/[id] — edit, publish, unpublish. CURATOR+.
 * DELETE /api/admin/properties/[id] — archive. OWNER only, and it never removes a row.
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    await requireRole("VIEWER");
    const { id } = await ctx.params;

    const property = await prisma.property.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
        hood: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!property) return apiError("Not found", 404);
    return apiOk(property);
  },
);

export const PATCH = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    const session = await requireRole("CURATOR");
    const { id } = await ctx.params;

    const raw = await req.json().catch(() => null);
    const parsed = propertyUpdateSchema.safeParse(raw);
    if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

    const property = await updateProperty(id, parsed.data, session.adminId);
    return apiOk(property);
  },
);

export const DELETE = withApiErrors(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    await requireRole("OWNER");
    const { id } = await ctx.params;
    await archiveProperty(id);
    return apiOk({ archived: true });
  },
);
