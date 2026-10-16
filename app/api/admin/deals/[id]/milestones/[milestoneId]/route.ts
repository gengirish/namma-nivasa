import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { updateMilestone } from "@/lib/deals";
import { dealMilestoneUpdateSchema, firstIssueMessage } from "@/lib/validations";

/**
 * PATCH /api/admin/deals/[id]/milestones/[milestoneId] — tick, block, skip, re-date or annotate
 * one milestone. `dueAt` is an IST calendar date (due at the end of that day). CURATOR+.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; milestoneId: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  await requireRole("CURATOR");
  const { id, milestoneId } = await ctx.params;

  const raw = await req.json().catch(() => null);
  const parsed = dealMilestoneUpdateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  return apiOk(await updateMilestone(id, milestoneId, parsed.data));
});
