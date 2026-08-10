import Anthropic from "@anthropic-ai/sdk";
import type { AgentDraft, EmailThread, ReplyIntent } from "@prisma/client";

import { AMENITY_LABEL, HOOD_LABEL } from "@/lib/content";
import { AUTO_SEND_BUDGET_PER_THREAD, autoSentCount, sendDraft } from "@/lib/email-threads";
import { prisma } from "@/lib/prisma";
import { friendlyDate, slotLabel } from "@/lib/slots";
import { propertyUrl, siteUrl, unusableBaseUrl } from "@/lib/site-url";

/**
 * Drafts a reply to an inbound message.
 *
 * The shape of this file is one decision repeated: **the model composes, it never decides.**
 * It is handed a block of facts assembled from our own tables and asked to answer using only
 * those; what it may then do with the answer is settled by `mayAutoSend()` below, in ordinary
 * code, from the intent it reported. A model that classifies its own message as safe to send
 * is not a safety control, so nothing here lets it choose.
 *
 * The default is PENDING_REVIEW. Autonomous sending requires all of:
 *   - NIVASA_AGENT_AUTOSEND=1
 *   - an intent on the whitelist, which is deliberately three entries long
 *   - confidence at or above the floor
 *   - the model asserting every claim came from the facts block
 *   - the thread's automatic-reply budget not yet spent
 *
 * Any of those failing costs a curator thirty seconds. Sending the wrong thing costs a lead.
 */

const MODEL = "claude-opus-5";

/**
 * Intents the agent may answer unattended.
 *
 * The test for membership is: can this be answered *completely* from a published listing and a
 * booking we already hold, such that being wrong is embarrassing rather than expensive? Price
 * negotiation, documents and rescheduling all fail it — a reschedule means an owner has to be
 * told, and no email should imply otherwise.
 */
const AUTO_SEND_INTENTS: ReplyIntent[] = ["PROPERTY_QUESTION", "LOGISTICS", "VIEWING_CONFIRM"];

const CONFIDENCE_FLOOR = 80;

export function replyAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Off unless explicitly turned on. An unset or misspelled value means "everything waits". */
export function autoSendEnabled(): boolean {
  return process.env.NIVASA_AGENT_AUTOSEND === "1";
}

// ─────────────────────────────────────────────────────────────────────────────
// The facts the model is allowed to use
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything known about the person who wrote in, rendered as plain text.
 *
 * Assembled from the same rows the dashboard reads, so what the agent believes and what a
 * curator sees cannot drift. Nothing that is not in here may appear in a reply.
 */
async function factsFor(thread: EmailThread): Promise<string> {
  const lines: string[] = [];

  const enquiry = thread.enquiryId
    ? await prisma.enquiry.findUnique({
        where: { id: thread.enquiryId },
        include: {
          viewing: { select: { scheduledFor: true, status: true } },
          property: {
            include: {
              hood: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      })
    : null;

  if (!enquiry) {
    lines.push(
      "NO MATCHING ENQUIRY. This address is not attached to any enquiry we hold, so we know",
      "nothing about this person beyond the email itself.",
    );
  } else {
    lines.push("## The enquiry");
    lines.push(`Reference: ${enquiry.reference}`);
    lines.push(`Name: ${enquiry.name}`);
    lines.push(`Kind: ${enquiry.kind}`);
    lines.push(`Status: ${enquiry.status}`);
    if (enquiry.message) lines.push(`What they originally wrote: ${enquiry.message}`);

    if (enquiry.viewing) {
      const { scheduledFor, status } = enquiry.viewing;
      lines.push("");
      lines.push("## Their booking");
      lines.push(
        `A ${enquiry.kind === "OWNER_CALL" ? "call with the owner" : "site visit"} is ${status} for ` +
          `${friendlyDate(scheduledFor)} at ${slotLabel(scheduledFor)} (India time).`,
      );
      lines.push(
        "You cannot move or cancel this. Changing a booked slot needs a person, because the " +
          "owner has already been told about it.",
      );
    } else {
      lines.push("");
      lines.push("## Their booking");
      lines.push("They have no viewing or call booked.");
    }

    const property = enquiry.property;
    if (property) {
      const price = Number(property.pricePaise) / 100;
      const crore = price >= 10_000_000 ? `₹${(price / 10_000_000).toFixed(2)} Cr` : `₹${price.toLocaleString("en-IN")}`;
      lines.push("");
      lines.push("## The home they enquired about");
      lines.push(`Name: ${property.name}`);
      lines.push(`Where: ${property.location}`);
      lines.push(`Configuration: ${property.bhk}`);
      lines.push(`${property.areaLabel}: ${property.area}`);
      lines.push(`Asking price: ${crore}`);
      lines.push(`Currently: ${property.status}`);
      lines.push(`Tagline: ${property.tagline}`);
      lines.push(`Story: ${property.story}`);
      if (property.description.length) lines.push(`More: ${property.description.join(" ")}`);
      if (property.amenities.length) {
        lines.push(`Amenities: ${property.amenities.map((a) => AMENITY_LABEL[a]).join(", ")}`);
      }
      if (property.hoodBlurb) lines.push(`Neighbourhood: ${property.hoodBlurb}`);
      for (const place of property.hood) {
        lines.push(`  - ${HOOD_LABEL[place.kind]}: ${place.name}, ${place.distance}`);
      }
      lines.push(
        `The owner honours ${property.weeklyViewingSlots} viewing slot(s) a week. ` +
          "You do not know which specific slots are free — never state availability.",
      );

      const base = siteUrl();
      if (!unusableBaseUrl(base)) {
        lines.push(`Listing page (safe to link): ${propertyUrl(property.slug)}`);
      }
    } else {
      lines.push("");
      lines.push("## The home they enquired about");
      lines.push(
        enquiry.propertyName
          ? `They enquired about "${enquiry.propertyName}", which is no longer on our books. ` +
              "We hold no current details for it."
          : "This was a general enquiry, not about a specific home.",
      );
    }
  }

  lines.push("");
  lines.push("## Things we do not have");
  lines.push(
    "- No exact street address, gate code, or directions.",
    "- No floor-by-floor availability, no other homes beyond the one above.",
    "- No authority over price. The asking price is the asking price.",
    "- No documents: no khata, no title deed, no floor plan file, no approvals.",
    "- No ability to book, move, or cancel a slot.",
  );

  return lines.join("\n");
}

/** The last few turns, oldest first, so the reply reads like part of a conversation. */
async function transcriptFor(threadId: string): Promise<string> {
  const messages = await prisma.emailMessage.findMany({
    where: { threadId },
    orderBy: { receivedAt: "desc" },
    take: 8,
    select: { direction: true, text: true, receivedAt: true },
  });

  return messages
    .reverse()
    .map((m) => `${m.direction === "INBOUND" ? "THEM" : "US"}: ${m.text.slice(0, 4000)}`)
    .join("\n\n");
}

const SYSTEM = `You write email replies on behalf of Nivasa, a small curation team that lists a
handful of premium homes in Bangalore. You are drafting a reply to someone who enquired about a
home and has written back.

THE ONE RULE: every factual claim in your reply must come from the FACTS block you are given.
If the facts do not cover what they asked, say plainly that you will check and come back — do
not guess, do not approximate, and do not soften a gap into something that reads like an answer.
Inventing a street address, a price concession, an available slot, or a document we hold is the
worst thing you can do here, and it is worse than an unhelpful reply.

Never state or imply that you have booked, moved, or cancelled anything. You have not.

Voice: a person on a small team, writing quickly and warmly. British-Indian English. No
corporate register, no "we appreciate your interest", no exclamation marks, no emoji. Two or
three short paragraphs at most. Sign off as "Nivasa" with no fake individual's name.

Do not restate their question back to them. Answer it.`;

/** What the model must return. Every field is used; nothing is decorative. */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "VIEWING_RESCHEDULE",
        "VIEWING_CANCEL",
        "VIEWING_CONFIRM",
        "LOGISTICS",
        "PROPERTY_QUESTION",
        "PRICE_NEGOTIATION",
        "DOCUMENTS",
        "OTHER",
        "UNCLEAR",
      ],
      description: "What the most recent inbound message is actually asking for.",
    },
    confidence: {
      type: "integer",
      description:
        "0-100, how sure you are that the intent is right AND the reply fully answers it.",
    },
    answeredFromFacts: {
      type: "boolean",
      description:
        "True only if every factual claim in the body is traceable to the FACTS block. False if you had to defer, hedge, or promise a follow-up.",
    },
    subject: { type: "string", description: "Subject line for the reply." },
    body: { type: "string", description: "The reply itself, plain text, ready to send." },
    rationale: {
      type: "string",
      description:
        "One sentence for the curator reviewing this: what you answered and what you deliberately did not.",
    },
  },
  required: ["intent", "confidence", "answeredFromFacts", "subject", "body", "rationale"],
  additionalProperties: false,
} as const;

interface Composed {
  intent: ReplyIntent;
  confidence: number;
  answeredFromFacts: boolean;
  subject: string;
  body: string;
  rationale: string;
}

async function compose(facts: string, transcript: string): Promise<Composed> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    // `medium` is the working setting here: the task is short, the facts are already assembled,
    // and the judgement being asked for is "does the FACTS block cover this" rather than
    // anything that rewards deep exploration.
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          "<facts>",
          facts,
          "</facts>",
          "",
          "<conversation_so_far>",
          transcript,
          "</conversation_so_far>",
          "",
          "Draft a reply to the most recent THEM message.",
        ].join("\n"),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to draft this reply");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("The model returned no text");

  return JSON.parse(text.text) as Composed;
}

// ─────────────────────────────────────────────────────────────────────────────
// The autonomy gate
// ─────────────────────────────────────────────────────────────────────────────

/** Why this draft must wait for a human, or null if it may go on its own. */
export function autoSendRefusal(draft: Composed, alreadyAutoSent: number): string | null {
  if (!autoSendEnabled()) return "Autonomous sending is off";
  if (!AUTO_SEND_INTENTS.includes(draft.intent)) return `${draft.intent} always goes to review`;
  if (draft.confidence < CONFIDENCE_FLOOR) {
    return `Confidence ${draft.confidence} is below the floor of ${CONFIDENCE_FLOOR}`;
  }
  if (!draft.answeredFromFacts) return "The reply does not answer entirely from what we hold";
  if (alreadyAutoSent >= AUTO_SEND_BUDGET_PER_THREAD) {
    return `This thread has already had ${alreadyAutoSent} automatic replies`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface DraftOutcome {
  draft: AgentDraft;
  autoSent: boolean;
  /** Why it was not auto-sent. Recorded on the draft and shown beside it in the dashboard. */
  heldBecause: string | null;
}

/**
 * Composes a reply to `messageId` and stores it. Sends it too, if the gate allows.
 *
 * Throws on model or database failure; the webhook route catches and returns 200 anyway, so a
 * bad drafting run costs a suggestion rather than a stuck Svix retry loop against a message we
 * have already stored.
 */
export async function draftReply(input: {
  thread: EmailThread;
  messageId: string;
  providerMessageId: string;
}): Promise<DraftOutcome> {
  const [facts, transcript, alreadyAutoSent] = await Promise.all([
    factsFor(input.thread),
    transcriptFor(input.thread.id),
    autoSentCount(input.thread.id),
  ]);

  const composed = await compose(facts, transcript);
  const heldBecause = autoSendRefusal(composed, alreadyAutoSent);

  const draft = await prisma.agentDraft.create({
    data: {
      threadId: input.thread.id,
      inReplyToId: input.messageId,
      intent: composed.intent,
      confidence: Math.max(0, Math.min(100, Math.round(composed.confidence))),
      subject: composed.subject,
      body: composed.body,
      rationale: heldBecause ? `${composed.rationale} — held: ${heldBecause}` : composed.rationale,
      status: "PENDING_REVIEW",
    },
  });

  if (heldBecause) {
    await prisma.emailThread.update({
      where: { id: input.thread.id },
      data: { status: "AWAITING_REVIEW" },
    });
    return { draft, autoSent: false, heldBecause };
  }

  const sent = await sendDraft({
    draft,
    inReplyToMessageId: input.providerMessageId,
    status: "AUTO_SENT",
  });

  if (!sent.ok) {
    await prisma.emailThread.update({
      where: { id: input.thread.id },
      data: { status: "AWAITING_REVIEW" },
    });
    return { draft, autoSent: false, heldBecause: sent.reason ?? "Sending failed" };
  }

  return { draft, autoSent: true, heldBecause: null };
}
