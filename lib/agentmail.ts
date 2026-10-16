import { AgentMailClient, AgentMailError } from "agentmail";

/**
 * The only file that talks to AgentMail.
 *
 * Everything above it — `notify()`, the reply agent, the admin send route — works in terms of
 * the `SendResult` union below and never imports the SDK. That is what keeps "swap the email
 * provider" a one-file change, the same property `deliverEmail()` had while it was a stub.
 *
 * Nothing here touches Prisma. These functions must stay callable from a route, a script, or a
 * future cron without a database in scope.
 */

let cached: { key: string; client: AgentMailClient } | null = null;

/** True when both halves are present. An API key with no inbox cannot send anything. */
export function agentMailConfigured(): boolean {
  return Boolean(process.env.AGENTMAIL_API_KEY && process.env.AGENTMAIL_INBOX_ID);
}

/** The inbox everything is sent from and received on, e.g. `hello@nivasa.agentmail.to`. */
export function agentMailInbox(): string {
  return process.env.AGENTMAIL_INBOX_ID ?? "";
}

/**
 * Memoized on the key itself rather than on a bare module-level flag, so a test or a script that
 * swaps the credential mid-process gets a client for the credential it just set.
 */
function client(): AgentMailClient {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY is not set");
  if (cached?.key !== apiKey) cached = { key: apiKey, client: new AgentMailClient({ apiKey }) };
  return cached.client;
}

export type SendResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; retryable: boolean; reason: string };

export interface OutboundEmail {
  to: string;
  /**
   * Copied recipients. CC rather than BCC on purpose: these messages go to the team and to the
   * owner of the home being asked about, and both sides being able to see who else received it
   * is what lets one of them reply-all instead of answering the same visitor twice.
   */
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  /** Base64 `content`, which is the shape AgentMail's `SendAttachment` takes. */
  attachments?: { filename: string; contentType: string; content: string }[];
  /**
   * Passed to AgentMail as `Idempotency-Key`. Give it a stable id from our own tables — a
   * NotificationLog id, an AgentDraft id — so a retried request reaches a real person once.
   * A random key per attempt would make this parameter decorative.
   */
  idempotencyKey?: string;
}

/**
 * A 4xx is our fault and will fail identically forever — a bad address, a rejected message.
 * A 429 or 5xx is the provider's and may not. The distinction is the whole reason callers get
 * `retryable` instead of a boolean: one of them is worth surfacing to a human, the other is
 * worth trying again.
 */
function classify(err: unknown): { retryable: boolean; reason: string } {
  if (err instanceof AgentMailError) {
    const status = err.statusCode ?? 0;
    const detail =
      (err.body as { message?: string } | undefined)?.message ?? err.message ?? "Unknown error";
    return { retryable: status === 429 || status >= 500, reason: `${status || "?"}: ${detail}` };
  }
  // A network failure never reached AgentMail, so it is always worth another attempt.
  return { retryable: true, reason: err instanceof Error ? err.message : "Unknown error" };
}

/** Starts a new thread. */
export async function sendEmail(input: OutboundEmail): Promise<SendResult> {
  if (!agentMailConfigured()) {
    return { ok: false, skipped: true, reason: "No email provider is configured" };
  }

  try {
    const sent = await client().inboxes.messages.send(
      agentMailInbox(),
      {
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
    return { ok: true, messageId: sent.messageId, threadId: sent.threadId };
  } catch (err) {
    return { ok: false, skipped: false, ...classify(err) };
  }
}

/**
 * Adds to an existing thread. `inReplyToMessageId` is AgentMail's message id for the message
 * being answered — replying rather than sending is what keeps the visitor's mail client showing
 * one conversation instead of a series of unrelated messages.
 */
export async function replyToEmail(input: {
  inReplyToMessageId: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
}): Promise<SendResult> {
  if (!agentMailConfigured()) {
    return { ok: false, skipped: true, reason: "No email provider is configured" };
  }

  try {
    const sent = await client().inboxes.messages.reply(
      agentMailInbox(),
      input.inReplyToMessageId,
      { text: input.text, ...(input.html ? { html: input.html } : {}) },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
    return { ok: true, messageId: sent.messageId, threadId: sent.threadId };
  } catch (err) {
    return { ok: false, skipped: false, ...classify(err) };
  }
}
