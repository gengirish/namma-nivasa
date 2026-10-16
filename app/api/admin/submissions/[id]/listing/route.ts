import type { NextRequest } from "next/server";

import { createListingFromSubmission } from "@/lib/admin-properties";
import { apiOk, requireRole, withApiErrors } from "@/lib/auth";

/**
 * POST /api/admin/submissions/[id]/listing — draft a listing from an accepted submission.
 * CURATOR+. Answers with the listing's id whether it was made now or already existed, so a
 * second click opens the same draft rather than failing.
 */
export const dynamic = "force-dynamic";

export const POST = withApiErrors(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    await requireRole("CURATOR");
    const { id } = await ctx.params;
    return apiOk(await createListingFromSubmission(id));
  },
);
