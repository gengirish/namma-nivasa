import type { NextRequest } from "next/server";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { createOwnerSubmission } from "@/lib/owner-submissions";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { firstIssueMessage, ownerSubmissionCreateSchema } from "@/lib/validations";

/** POST /api/owner-submissions — public, rate-limited. */
export const dynamic = "force-dynamic";

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const ip = getClientIp(req);
  if (!(await rateLimitAsync(`owner:${ip}`, 4, 60 * 60_000))) {
    return apiError("Too many submissions from this connection — try again shortly", 429);
  }

  const raw = await req.json().catch(() => null);
  const parsed = ownerSubmissionCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  const receipt = await createOwnerSubmission(parsed.data);
  return apiOk(receipt, 201);
});
