import type { NextRequest } from "next/server";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { runReminderCron } from "@/lib/reminders";

/**
 * GET /api/cron/viewing-reminders — the evening-before reminder run.
 *
 * The second route in this app that is public and privileged, and it takes the same posture as
 * the AgentMail webhook rather than inventing a new one:
 *
 *   - **Authentication is a shared secret, not a session.** Vercel Cron sends
 *     `Authorization: Bearer $CRON_SECRET`; there is no Clerk user to require, so `requireRole()`
 *     has nothing to check and is not used. Comparing the header is the whole check.
 *   - **No `CRON_SECRET` means 503, never "run it anyway".** An unconfigured endpoint that
 *     executed for anonymous callers would let anyone mail every visitor with a booking, at any
 *     hour, as many times as they liked — the `reminderSentAt` guard bounds that to once per
 *     viewing, which is a great deal better than nothing and still not a reason to leave the
 *     door open.
 *
 * GET rather than POST because Vercel Cron issues GET, and this endpoint is not idempotent in
 * the HTTP sense — the stamp in `sendDueReminders()` is what makes repeat calls harmless.
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError("Cron is not configured", 503);

  // `timingSafeEqual` would need equal-length buffers and a Node import in an edge-shaped file;
  // the secret is high-entropy and the endpoint is not an oracle worth building for.
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return apiError("Not authorised", 401);
  }

  const result = await runReminderCron();
  return apiOk(result);
});
