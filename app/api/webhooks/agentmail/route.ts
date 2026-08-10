import type { NextRequest } from "next/server";
import { Webhook } from "svix";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { existingDraftFor, recordInboundMessage, unanswerableReason } from "@/lib/email-threads";
import { dashboardLink, notify, teamInbox } from "@/lib/notifications";
import { draftReply, replyAgentConfigured } from "@/lib/reply-agent";
import { agentMailEventSchema } from "@/lib/validations";

/**
 * POST /api/webhooks/agentmail — inbound mail.
 *
 * PUBLIC by design, and the only route in the app that is both public and privileged. It has no
 * Clerk session and cannot have one; its authentication is the Svix signature over the raw body,
 * checked before the payload is parsed. Two consequences worth stating plainly:
 *
 *   - **No secret means 503, never "process it anyway".** An unconfigured webhook that accepted
 *     unsigned bodies would let anyone put words in a curator's review queue, and — with
 *     autosend on — in a visitor's inbox.
 *   - **The raw text is verified, not the parsed object.** `req.text()` before anything else.
 *     Re-serialising JSON changes the bytes and the MAC no longer matches.
 *
 * It answers 200 to almost everything. Svix retries any non-2xx, so a response code is a request
 * to be sent the same message again — worth it for "I could not verify you", worthless for
 * "your message is stored but my drafting model timed out". The second case is a suggestion we
 * did not make; re-delivering it would not fix that and would re-run the loop indefinitely.
 */
export const dynamic = "force-dynamic";

/** Last-resort body when a message arrives HTML-only, as forwarded mail usually does. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) return apiError("Inbound email is not configured", 503);

  const raw = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let verified: unknown;
  try {
    verified = new Webhook(secret).verify(raw, headers);
  } catch {
    // Also covers a replayed delivery outside Svix's five-minute tolerance. Never log the body.
    return apiError("Signature verification failed", 400);
  }

  const parsed = agentMailEventSchema.safeParse(verified);
  if (!parsed.success) return apiOk({ handled: false, reason: "Unrecognised payload" });

  const { event_type: eventType, message } = parsed.data;

  // Everything except the clean variant is acknowledged and dropped. AgentMail has already
  // judged `.spam` / `.blocked` / `.unauthenticated`, and storing that judgement's output would
  // put junk in front of a curator under the heading "someone wrote to you".
  if (eventType !== "message.received" || !message) {
    return apiOk({ handled: false, reason: `Ignoring ${eventType}` });
  }

  const body =
    message.extracted_text?.trim() ||
    message.text?.trim() ||
    (message.extracted_html ? stripHtml(message.extracted_html) : "") ||
    (message.html ? stripHtml(message.html) : "");

  const receivedAt = message.timestamp ? new Date(message.timestamp) : new Date();

  const { thread, message: stored, isNew } = await recordInboundMessage({
    inboxId: message.inbox_id,
    providerThreadId: message.thread_id,
    providerMessageId: message.message_id,
    from: message.from,
    to: message.to,
    subject: message.subject ?? null,
    text: body,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
  });

  // A retry whose first attempt got all the way through has nothing left to do. A retry whose
  // first attempt died between storing the message and writing the draft still does — which is
  // why this asks about the draft rather than trusting `isNew`.
  if (await existingDraftFor(stored.id)) {
    return apiOk({ handled: true, replayed: !isNew, drafted: false });
  }

  const refusal = unanswerableReason({ from: message.from, labels: message.labels, eventType });
  if (refusal) {
    return apiOk({ handled: true, drafted: false, reason: refusal });
  }

  if (!body) {
    return apiOk({ handled: true, drafted: false, reason: "Message has no readable body" });
  }

  if (!replyAgentConfigured()) {
    return apiOk({ handled: true, drafted: false, reason: "No reply agent is configured" });
  }

  try {
    const outcome = await draftReply({
      thread,
      messageId: stored.id,
      providerMessageId: message.message_id,
    });

    if (!outcome.autoSent) {
      await notify({
        type: "AGENT_REPLY_PENDING",
        recipient: teamInbox(),
        subject: `Reply drafted for ${thread.participantEmail} — needs a look`,
        body: [
          `${thread.participantEmail} wrote in about "${thread.subject ?? "(no subject)"}".`,
          `A reply is drafted but held: ${outcome.heldBecause}`,
          "",
          dashboardLink("/dashboard/inbox"),
        ].join("\n"),
        subjectId: outcome.draft.id,
      });
    }

    return apiOk({ handled: true, drafted: true, autoSent: outcome.autoSent });
  } catch (err) {
    // The message is stored and visible either way; only the suggestion is lost. Returning 200
    // stops Svix re-running a model call that just failed, and a curator sees the thread with
    // no draft beside it — which is the truth.
    console.error("[agentmail] drafting failed", err);
    return apiOk({ handled: true, drafted: false, reason: "Drafting failed" });
  }
});
