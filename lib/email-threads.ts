import { Prisma } from "@prisma/client";
import type { AgentDraft, EmailMessage, EmailThread } from "@prisma/client";

import { agentMailInbox, replyToEmail } from "@/lib/agentmail";
import { prisma } from "@/lib/prisma";

/**
 * Inbound mail: recording it, matching it to a lead, and the rules about what may be answered
 * automatically. The webhook route parses and verifies; everything it then does is in here.
 *
 * Two invariants this file exists to hold:
 *
 *   1. **A webhook delivery is processed at most once.** Svix retries on any non-2xx and can
 *      redeliver on a slow response, so the same message arrives twice as a matter of course.
 *      The guard is `EmailMessage.providerMessageId @unique` — a losing INSERT, not a read —
 *      for the same reason the double-booking guard is an index and not a check.
 *
 *   2. **The agent cannot talk to itself.** Auto-replying to an inbox that auto-replies back is
 *      a mail loop that bills per message and reaches a real person dozens of times. `ignore()`
 *      below is the whole defence, and it is deliberately conservative: everything it rejects
 *      is still recorded and still visible, it just does not get answered.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Loop and noise protection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Addresses that must never receive an automated reply. These are the local-parts that send
 * bounces, vacation responders and delivery reports — answering one starts a loop with a robot
 * that will answer back forever.
 */
const UNANSWERABLE_LOCALPARTS = [
  "mailer-daemon",
  "postmaster",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "bounce",
  "bounces",
  "notifications",
];

/** Labels AgentMail puts on mail that failed authentication or looks like junk. */
const UNANSWERABLE_LABELS = ["spam", "trash", "blocked", "unauthenticated"];

/**
 * The most an agent may say in one conversation without a human. Past this every draft waits
 * for review no matter how confident it is — a thread that has gone four rounds is one where
 * something is not landing, and more autonomous replies is the wrong response to that.
 */
export const AUTO_SEND_BUDGET_PER_THREAD = 3;

/** `Display Name <a@b.com>` → `a@b.com`. AgentMail sends either spelling. */
export function bareAddress(raw: string): string {
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

/**
 * Why this message must not be answered automatically, or null if it may be. Recording is
 * unconditional — this only gates the agent.
 */
export function unanswerableReason(input: {
  from: string;
  labels: string[];
  eventType: string;
}): string | null {
  if (input.eventType !== "message.received") {
    // The `.spam` / `.blocked` / `.unauthenticated` variants of the event are exactly the mail
    // we should not be having a conversation with.
    return `Event type ${input.eventType}`;
  }

  const label = input.labels.map((l) => l.toLowerCase()).find((l) => UNANSWERABLE_LABELS.includes(l));
  if (label) return `Message is labelled ${label}`;

  const from = bareAddress(input.from);
  // The inbox writing to itself is the loop this check exists for.
  if (from === agentMailInbox().toLowerCase()) return "Message is from our own inbox";

  const localPart = from.split("@")[0] ?? "";
  if (UNANSWERABLE_LOCALPARTS.some((needle) => localPart === needle || localPart.startsWith(`${needle}+`))) {
    return `Sender ${from} is an automated address`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────────────────────────────────────

export interface InboundMessage {
  inboxId: string;
  providerThreadId: string;
  providerMessageId: string;
  from: string;
  to: string[];
  subject: string | null;
  /** Already collapsed to the new content — see `bodyOf` in the route. */
  text: string;
  receivedAt: Date;
}

export interface RecordResult {
  thread: EmailThread;
  message: EmailMessage;
  /** False when this delivery had already been recorded — a Svix retry, or a duplicate event. */
  isNew: boolean;
}

/**
 * Matches an inbound sender to the lead that produced it.
 *
 * Newest first, because a person who enquired about two homes and then replies is almost
 * certainly talking about the one they asked about most recently. This is a best guess and the
 * dashboard shows which enquiry it landed on so a curator can see when it guessed wrong; there
 * is no attempt to be clever about it, because a wrong confident match is worse than none.
 */
async function matchEnquiry(email: string): Promise<string | null> {
  const enquiry = await prisma.enquiry.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return enquiry?.id ?? null;
}

/**
 * Stores the message, creating the thread if this is the first we have seen of it.
 *
 * The INSERT is attempted first and P2002 is the "already handled" signal. Checking whether the
 * message exists and inserting afterwards would leave the window where two concurrent
 * deliveries of the same event both find nothing and both write.
 */
export async function recordInboundMessage(input: InboundMessage): Promise<RecordResult> {
  const participant = bareAddress(input.from);

  const thread = await prisma.emailThread.upsert({
    where: { providerThreadId: input.providerThreadId },
    create: {
      providerThreadId: input.providerThreadId,
      inboxId: input.inboxId,
      participantEmail: participant,
      subject: input.subject,
      lastMessageAt: input.receivedAt,
      enquiryId: await matchEnquiry(participant),
    },
    update: { lastMessageAt: input.receivedAt },
  });

  try {
    const message = await prisma.emailMessage.create({
      data: {
        providerMessageId: input.providerMessageId,
        threadId: thread.id,
        direction: "INBOUND",
        fromAddress: participant,
        toAddresses: input.to.map(bareAddress),
        subject: input.subject,
        text: input.text,
        receivedAt: input.receivedAt,
      },
    });
    return { thread, message, isNew: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Seen before. Return the stored row so the caller can still check whether the *drafting*
      // half of the previous attempt completed — a delivery that died between the two writes
      // has a message with no draft beside it, and this is how the retry finishes the job.
      const message = await prisma.emailMessage.findUniqueOrThrow({
        where: { providerMessageId: input.providerMessageId },
      });
      return { thread, message, isNew: false };
    }
    throw err;
  }
}

/** The draft already written for this inbound message, if the previous attempt got that far. */
export function existingDraftFor(messageId: string): Promise<AgentDraft | null> {
  return prisma.agentDraft.findUnique({ where: { inReplyToId: messageId } });
}

/** How many replies the agent has already sent unattended in this conversation. */
export function autoSentCount(threadId: string): Promise<number> {
  return prisma.agentDraft.count({ where: { threadId, status: "AUTO_SENT" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending a draft
// ─────────────────────────────────────────────────────────────────────────────

export interface SendDraftResult {
  ok: boolean;
  reason?: string;
}

/**
 * Delivers a draft and records what went out, whichever route approved it — the autosend path
 * and the curator's Send button both land here so there is exactly one place that can put a
 * message in front of a visitor.
 *
 * The draft id is the idempotency key, so a retried approval cannot send twice. Ordering is the
 * same as `notify()`'s and for the same reason: the provider call happens first and the local
 * rows are written from its result, because the failure we cannot tolerate is a message that
 * reached someone with no record of it.
 */
export async function sendDraft(input: {
  draft: AgentDraft;
  /** AgentMail's id for the message being answered. */
  inReplyToMessageId: string;
  status: "AUTO_SENT" | "SENT";
  reviewedBy?: string | null;
  subject?: string;
  body?: string;
}): Promise<SendDraftResult> {
  const { draft } = input;
  const subject = input.subject ?? draft.subject;
  const body = input.body ?? draft.body;

  const sent = await replyToEmail({
    inReplyToMessageId: input.inReplyToMessageId,
    text: body,
    idempotencyKey: draft.id,
  });

  if (!sent.ok) {
    await prisma.agentDraft.update({
      where: { id: draft.id },
      data: {
        status: "FAILED",
        error: sent.reason,
        subject,
        body,
        ...(input.reviewedBy ? { reviewedBy: input.reviewedBy } : {}),
      },
    });
    return { ok: false, reason: sent.reason };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Upsert, not create. AgentMail honours the idempotency key by replaying the original
    // response, so a retried approval whose first attempt sent successfully but died before
    // writing these rows comes back with a `messageId` we already hold. A `create` there would
    // hit P2002 inside the transaction and strand the draft in SENDING — the one state a
    // curator cannot act on — for a send that actually succeeded.
    const outbound = await tx.emailMessage.upsert({
      where: { providerMessageId: sent.messageId },
      create: {
        providerMessageId: sent.messageId,
        threadId: draft.threadId,
        direction: "OUTBOUND",
        fromAddress: agentMailInbox().toLowerCase(),
        toAddresses: [],
        subject,
        text: body,
        receivedAt: now,
      },
      update: { subject, text: body },
      select: { id: true },
    });

    await tx.agentDraft.update({
      where: { id: draft.id },
      data: {
        status: input.status,
        subject,
        body,
        sentAt: now,
        sentMessageId: outbound.id,
        error: null,
        ...(input.reviewedBy ? { reviewedBy: input.reviewedBy } : {}),
      },
    });

    await tx.emailThread.update({
      where: { id: draft.threadId },
      data: { lastMessageAt: now, status: "OPEN" },
    });
  });

  return { ok: true };
}
