import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstIssueMessage, submissionUpdateSchema } from "@/lib/validations";

/** PATCH /api/admin/submissions/[id] — triage an owner submission. CURATOR+. */
export const dynamic = "force-dynamic";

export const PATCH = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    await requireRole("CURATOR");
    const { id } = await ctx.params;

    const raw = await req.json().catch(() => null);
    const parsed = submissionUpdateSchema.safeParse(raw);
    if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
    const { status, notes } = parsed.data;

    const submission = await prisma.ownerSubmission.update({
      where: { id },
      data: { ...(status ? { status } : {}), ...(notes !== undefined ? { notes } : {}) },
    });
    return apiOk(submission);
  },
);
