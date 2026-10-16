import type { NextRequest } from "next/server";

import { apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { sendPartyUpdate } from "@/lib/deals";

/**
 * POST /api/admin/deals/[id]/party-update — email "where your deal stands" to every seller and
 * buyer with an address on the sheet, through notify(). CURATOR+.
 *
 * Responds `{ notified, recipients }`. Delivery problems never fail the request — they are
 * FAILED / SKIPPED rows in /dashboard/outbox. 422 when no seller or buyer has an email.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (_req: NextRequest, ctx: Ctx): Promise<Response> => {
  const session = await requireRole("CURATOR");
  const { id } = await ctx.params;
  return apiOk(await sendPartyUpdate(id, session.adminId));
});
