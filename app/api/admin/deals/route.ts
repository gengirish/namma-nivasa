import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { createDeal, createDealFromEnquiry, listDeals } from "@/lib/deals";
import { dealCreateSchema, firstIssueMessage } from "@/lib/validations";

/**
 * GET  /api/admin/deals — every Close deal, AT_RISK first, then by deadline. CURATOR+.
 * POST /api/admin/deals — a new DRAFT deal from a playbook, or one click from a CLOSED enquiry
 *                         when the body carries `enquiryId`. CURATOR+.
 *
 * Nothing deal-related is ever served outside /api/admin (handover §7).
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (): Promise<Response> => {
  await requireRole("CURATOR");
  return apiOk(await listDeals());
});

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const session = await requireRole("CURATOR");

  const raw = await req.json().catch(() => null);
  const parsed = dealCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
  const { enquiryId, playbook, ...rest } = parsed.data;

  const deal = enquiryId
    ? await createDealFromEnquiry(enquiryId, session.adminId, playbook)
    : await createDeal({ playbook, ...rest }, session.adminId);
  return apiOk(deal, 201);
});
