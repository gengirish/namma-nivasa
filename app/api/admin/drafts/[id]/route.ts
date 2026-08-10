import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { sendDraft } from "@/lib/email-threads";
import { prisma } from "@/lib/prisma";
import { agentDraftActionSchema, firstIssueMessage } from "@/lib/validations";

/**
 * PATCH /api/admin/drafts/[id] — approve or throw away a drafted reply. CURATOR+.
 *
 * The one place a human turns an agent's suggestion into a real email. Two things it refuses:
 *
 *   - **A draft that has already been resolved.** Only PENDING_REVIEW and FAILED can be acted
 *     on. Two curators opening the same queue and both pressing Send is the ordinary case, not
 *     the exotic one, and the second press must not send the message twice. The state check runs
 *     inside the transaction that claims the draft, so the loser sees a 409 rather than winning
 *     a race it did not know it was in.
 *   - **Sending without a message to reply to.** The reply threads off the inbound message's
 *     provider id; without it there is nothing to attach to.
 */
export const dynamic = "force-dynamic";

const ACTIONABLE = ["PENDING_REVIEW", "FAILED"] as const;

export const PATCH = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
    const session = await requireRole("CURATOR");
    const { id } = await ctx.params;

    const raw = await req.json().catch(() => null);
    const parsed = agentDraftActionSchema.safeParse(raw);
    if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
    const { action, subject, body } = parsed.data;

    const draft = await prisma.agentDraft.findUnique({
      where: { id },
      include: { inReplyTo: { select: { providerMessageId: true } } },
    });
    if (!draft) return apiError("Not found", 404);
    if (!ACTIONABLE.includes(draft.status as (typeof ACTIONABLE)[number])) {
      return apiError("That draft has already been dealt with", 409);
    }

    if (action === "dismiss") {
      await prisma.$transaction(async (tx) => {
        await tx.agentDraft.update({
          where: { id },
          data: { status: "DISMISSED", reviewedBy: session.adminId, error: null },
        });
        // The conversation is still open — dismissing the suggestion is not the same as being
        // done with the person. Only the review flag comes off.
        await tx.emailThread.update({
          where: { id: draft.threadId },
          data: { status: "OPEN" },
        });
      });
      return apiOk({ id, status: "DISMISSED" });
    }

    // Claim it before sending. `updateMany` with the status in the WHERE is the concurrency
    // control: exactly one caller moves the row out of an actionable state, the other updates
    // nothing and gets a 409. SENDING exists precisely so the claimed row is not itself
    // claimable — parking it in FAILED for the duration would leave the same race open.
    const claimed = await prisma.agentDraft.updateMany({
      where: { id, status: { in: [...ACTIONABLE] } },
      data: { status: "SENDING", error: null, reviewedBy: session.adminId },
    });
    if (claimed.count === 0) return apiError("That draft has already been dealt with", 409);

    const result = await sendDraft({
      draft,
      inReplyToMessageId: draft.inReplyTo.providerMessageId,
      status: "SENT",
      reviewedBy: session.adminId,
      subject,
      body,
    });

    if (!result.ok) return apiError(result.reason ?? "Could not send that reply", 502);
    return apiOk({ id, status: "SENT" });
  },
);
