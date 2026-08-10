import type { NotificationType, Prisma } from "@prisma/client";

import { agentMailConfigured, sendEmail } from "@/lib/agentmail";
import { prisma } from "@/lib/prisma";
import { siteUrl, unusableBaseUrl } from "@/lib/site-url";

/**
 * The single outbound orchestrator. Nothing else in the app composes a message.
 *
 * `notify()` never throws. Its callers are enquiry and submission paths where an exception
 * costs a lead that a person actually typed in, and a failed notification must degrade to a
 * visible row rather than a 500 in front of the visitor.
 *
 * The log row is written PENDING *before* any send and finalised after. A crash then leaves a
 * visible "we may have sent this", which beats the opposite ordering's "a real message reached
 * a real person and there is no record of it".
 *
 * Delivery is AgentMail (`lib/agentmail.ts`). With no credentials configured the behaviour is
 * exactly what it was before one was wired — every row lands SKIPPED with the reason recorded,
 * and /dashboard/outbox is a readable outbox rather than a silent hole. Nothing above this file
 * changed when the provider arrived.
 */

export interface NotifyInput {
  type: NotificationType;
  recipient: string;
  subject: string;
  body: string;
  subjectId?: string | null;
}

type DeliveryResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; reason: string };

/**
 * The one function a messaging integration owns.
 *
 * `logId` is the idempotency key, not decoration: the log row is written before the send, so it
 * is a stable id for this exact message that survives a retry. Without it a request that timed
 * out after AgentMail accepted it would be re-sent, and the recipient would get the message
 * twice with no way for us to know we had done it.
 */
async function deliverEmail(input: NotifyInput, logId: string): Promise<DeliveryResult> {
  if (!agentMailConfigured()) {
    return { ok: false, skipped: true, reason: "No email provider is configured" };
  }

  const result = await sendEmail({
    to: input.recipient,
    subject: input.subject,
    text: input.body,
    idempotencyKey: logId,
  });

  if (result.ok) return { ok: true };
  if (result.skipped) return { ok: false, skipped: true, reason: result.reason };
  return {
    ok: false,
    skipped: false,
    reason: result.retryable ? `${result.reason} (retryable)` : result.reason,
  };
}

export async function notify(input: NotifyInput): Promise<void> {
  let logId: string | null = null;

  try {
    const created = await prisma.notificationLog.create({
      data: {
        type: input.type,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        subjectId: input.subjectId ?? null,
      },
      select: { id: true },
    });
    logId = created.id;
  } catch (err) {
    // Losing the audit row must not lose the enquiry that triggered it.
    console.error("[notify] could not write log row", err);
    return;
  }

  let update: Prisma.NotificationLogUpdateInput;
  try {
    const result = await deliverEmail(input, logId);
    if (result.ok) {
      update = { status: "SENT", sentAt: new Date() };
    } else if (result.skipped) {
      update = { status: "SKIPPED", error: result.reason };
    } else {
      update = { status: "FAILED", error: result.reason };
    }
  } catch (err) {
    update = { status: "FAILED", error: err instanceof Error ? err.message : "Unknown error" };
  }

  await prisma.notificationLog.update({ where: { id: logId }, data: update }).catch((err) => {
    console.error("[notify] could not finalise log row", err);
  });
}

/**
 * The link block appended to team-facing messages. Refuses to compose against a localhost
 * origin for the same reason `unusableBaseUrl` exists.
 */
export function dashboardLink(path: string): string {
  const base = siteUrl();
  const problem = unusableBaseUrl(base);
  if (problem) return `(no link — ${problem})`;
  return `${base}${path}`;
}

/** Where team notifications go until per-admin routing exists. */
export function teamInbox(): string {
  return process.env.NIVASA_TEAM_EMAIL || "team@nivasa.invalid";
}
