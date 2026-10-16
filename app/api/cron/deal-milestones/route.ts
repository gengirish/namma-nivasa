import type { NextRequest } from "next/server";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { runDealMilestoneCron } from "@/lib/deals";

/**
 * GET /api/cron/deal-milestones — the morning Close digest to the curator team.
 *
 * Same posture as /api/cron/viewing-reminders, deliberately copied rather than reinvented:
 *
 *   - **Authentication is `Authorization: Bearer $CRON_SECRET`**, which Vercel Cron sends. There
 *     is no session, so `requireRole()` has nothing to check and is not used.
 *   - **No `CRON_SECRET` means 503**, never "run it anyway" for an anonymous caller.
 *
 * Scheduled at 03:30 UTC = 09:00 IST, the start of the working day, when a curator can still
 * chase a bank about something due today. `DealMilestone.lastNotifiedAt` makes a repeat call on
 * the same IST day harmless: each milestone is in at most one digest per day.
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError("Cron is not configured", 503);

  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return apiError("Not authorised", 401);
  }

  return apiOk(await runDealMilestoneCron());
});
