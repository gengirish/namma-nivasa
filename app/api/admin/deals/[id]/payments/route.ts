import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { addPayment } from "@/lib/deals";
import { dealPaymentCreateSchema, firstIssueMessage } from "@/lib/validations";

/**
 * POST /api/admin/deals/[id]/payments — add a ledger row. `paidAt` is an IST calendar date
 * (stored as IST noon); absent or null records a planned payment. CURATOR+.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  await requireRole("CURATOR");
  const { id } = await ctx.params;

  const raw = await req.json().catch(() => null);
  const parsed = dealPaymentCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  return apiOk(await addPayment(id, parsed.data), 201);
});
