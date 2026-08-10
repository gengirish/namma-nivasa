import type { NextRequest } from "next/server";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { subscribe } from "@/lib/owner-submissions";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { firstIssueMessage, subscriberCreateSchema } from "@/lib/validations";

/**
 * POST /api/subscribers — newsletter sign-up. Public, rate-limited.
 *
 * An address already on the list gets the same 200 and the same copy as a new one. Answering
 * differently would turn this into a free "is this person a Nivasa subscriber" oracle.
 */
export const dynamic = "force-dynamic";

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const ip = getClientIp(req);
  if (!(await rateLimitAsync(`subscribe:${ip}`, 8, 60 * 60_000))) {
    return apiError("Too many sign-ups from this connection — try again shortly", 429);
  }

  const raw = await req.json().catch(() => null);
  const parsed = subscriberCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  await subscribe(parsed.data.email);
  return apiOk({ ok: true }, 201);
});
