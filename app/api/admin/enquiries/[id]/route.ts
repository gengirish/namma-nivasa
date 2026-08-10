import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enquiryUpdateSchema, firstIssueMessage } from "@/lib/validations";

/**
 * PATCH /api/admin/enquiries/[id] — triage: move the status, leave a note. CURATOR+.
 *
 * Cancelling an enquiry cancels its viewing in the same transaction, so a slot never stays
 * BOOKED against a lead the team has closed. The row is kept rather than deleted — the hour
 * stays visibly spoken for, which is the honest state after an owner has already been told.
 */
export const dynamic = "force-dynamic";

export const PATCH = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    const session = await requireRole("CURATOR");
    const { id } = await ctx.params;

    const raw = await req.json().catch(() => null);
    const parsed = enquiryUpdateSchema.safeParse(raw);
    if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
    const { status, notes } = parsed.data;

    const existing = await prisma.enquiry.findUnique({
      where: { id },
      select: { id: true, viewing: { select: { id: true } } },
    });
    if (!existing) return apiError("Not found", 404);

    const enquiry = await prisma.$transaction(async (tx) => {
      const updated = await tx.enquiry.update({
        where: { id },
        data: {
          ...(status ? { status } : {}),
          ...(notes !== undefined ? { notes } : {}),
          handledBy: session.adminId,
        },
        include: { viewing: { select: { scheduledFor: true, status: true } } },
      });

      if (status === "CANCELLED" && existing.viewing) {
        await tx.viewing.update({
          where: { id: existing.viewing.id },
          data: { status: "CANCELLED" },
        });
      }
      return updated;
    });

    return apiOk(enquiry);
  },
);
