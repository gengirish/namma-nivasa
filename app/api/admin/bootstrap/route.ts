import type { NextRequest } from "next/server";

import { apiError, apiOk, bootstrapFirstAdmin, getClerkIdentity, withApiErrors } from "@/lib/auth";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";

/**
 * POST /api/admin/bootstrap — the one route that cannot call `requireRole()`, because its whole
 * point is a signed-in Clerk user who has no `Admin` row yet.
 *
 * It is not a standing back door: `bootstrapFirstAdmin()` only creates a row while the table is
 * empty, and it checks that inside the transaction so two concurrent callers cannot both become
 * OWNER. Rate-limited because it is the sole unguarded write.
 */
export const dynamic = "force-dynamic";

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  if (!(await rateLimitAsync(`bootstrap:${getClientIp(req)}`, 5, 60 * 60_000))) {
    return apiError("Too many attempts — try again shortly", 429);
  }

  const identity = await getClerkIdentity();
  if (!identity) return apiError("Sign in to continue", 401);

  const result = await bootstrapFirstAdmin(identity);
  if (!result.ok) return apiError(result.error, result.status);
  return apiOk({ role: result.role }, 201);
});
