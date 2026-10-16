import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { deletePayment, updatePayment } from "@/lib/deals";
import { dealPaymentUpdateSchema, firstIssueMessage } from "@/lib/validations";

/**
 * PATCH  /api/admin/deals/[id]/payments/[paymentId] — correct a ledger row, or mark a planned
 *                                                     payment paid. CURATOR+.
 * DELETE /api/admin/deals/[id]/payments/[paymentId] — remove a ledger row. CURATOR+.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  await requireRole("CURATOR");
  const { id, paymentId } = await ctx.params;

  const raw = await req.json().catch(() => null);
  const parsed = dealPaymentUpdateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  return apiOk(await updatePayment(id, paymentId, parsed.data));
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: Ctx): Promise<Response> => {
  await requireRole("CURATOR");
  const { id, paymentId } = await ctx.params;
  return apiOk(await deletePayment(id, paymentId));
});
