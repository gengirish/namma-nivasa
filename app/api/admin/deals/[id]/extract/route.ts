import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { proposeForDeal } from "@/lib/deals";
import { rateLimitAsync } from "@/lib/rate-limit";
import { dealExtractSchema, firstIssueMessage } from "@/lib/validations";

/**
 * POST /api/admin/deals/[id]/extract — `{ text }` (a pasted WhatsApp export or notes, at most
 * 50,000 characters) → an `ExtractionProposal`. CURATOR+. Writes nothing: the curator confirms
 * the proposal and saves it through PATCH /api/admin/deals/[id].
 *
 * **The pasted text is never stored or logged** (handover §7). It lives in this request only:
 * it is not written to the database, not echoed in an error, and nothing here hands it to
 * `console`. A parse failure answers with the schema's sentence, never anything from the body.
 *
 * Rate-limited per admin rather than per IP: each call is a paid model request, and the curator
 * is the unit that spends it. 503 without `ANTHROPIC_API_KEY`.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const EXTRACTIONS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60_000;

export const POST = withApiErrors(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  const session = await requireRole("CURATOR");
  const { id } = await ctx.params;

  const allowed = await rateLimitAsync(
    `deal-extract:${session.adminId}`,
    EXTRACTIONS_PER_WINDOW,
    WINDOW_MS,
  );
  if (!allowed) return apiError("Too many extractions — try again in a few minutes", 429);

  const raw = await req.json().catch(() => null);
  const parsed = dealExtractSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  return apiOk(await proposeForDeal(id, parsed.data.text));
});
