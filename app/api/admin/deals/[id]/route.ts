import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { getDeal, setDealStatus, updateSheet } from "@/lib/deals";
import { dealUpdateSchema } from "@/lib/validations";

/**
 * GET   /api/admin/deals/[id] — the deal room: sheet, parties, milestones, ledger, documents,
 *                               consistency issues. CURATOR+.
 * PATCH /api/admin/deals/[id] — `{ sheet }` saves the deal sheet (partial allowed while DRAFT);
 *                               `{ status: "CLOSED" | "CANCELLED" }` closes it. CURATOR+.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, ctx: Ctx): Promise<Response> => {
  await requireRole("CURATOR");
  const { id } = await ctx.params;
  return apiOk(await getDeal(id));
});

export const PATCH = withApiErrors(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  const session = await requireRole("CURATOR");
  const { id } = await ctx.params;

  const raw = await req.json().catch(() => null);
  const parsed = dealUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError("Send either { sheet } or { status: \"CLOSED\" | \"CANCELLED\" }", 400);
  }

  const deal =
    "sheet" in parsed.data
      ? await updateSheet(id, parsed.data.sheet, session.adminId)
      : await setDealStatus(id, parsed.data.status, session.adminId);
  return apiOk(deal);
});
