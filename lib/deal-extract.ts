
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  ISO_DATE,
  partialDealSheetSchema,
  sheetBankSchema,
  sheetPartySchema,
  sheetSellerSchema,
  type LedgerPayment,
  type PartialDealSheet,
} from "@/lib/deal-sheet";
import type { ExtractionProposal, UncertainField } from "@/lib/deal-types";

/**
 * Extraction assist: a curator pastes a WhatsApp export or their own notes, and the model
 * proposes deal-sheet fields from it.
 *
 * Same rule as `lib/reply-agent.ts`: **the model composes, it never decides.** What comes back
 * is a *proposal*. Nothing in this file writes to a deal; the dashboard shows the proposal as a
 * diff, a curator ticks what is right, and the ordinary sheet save is what persists it. A field
 * the model was unsure of arrives unticked.
 *
 * Three things here are load-bearing:
 *
 *   - **The pasted text is never stored or logged.** It goes into one model request and is
 *     dropped. No error thrown from this file carries it — not a slice of it, not the model's
 *     echo of it — because an error message is exactly what ends up in a server log.
 *   - **Privacy is enforced in code, not just asked for.** The system prompt tells the model not
 *     to return Aadhaar numbers, full PANs or full account numbers; `scrub()` then removes them
 *     anyway. A full PAN found in a party is reduced to `panLast4`, and every string value is
 *     swept for the PAN pattern, Aadhaar-shaped digit groups and long digit runs.
 *   - **A bad field costs that field, not the proposal.** Each field is validated against
 *     `partialDealSheetSchema` on its own; one that fails is dropped and listed as uncertain, so
 *     a mistyped email does not throw away the consideration the model read correctly.
 */

const MODEL = "claude-opus-5";

/** Enough for a long chat export; anything past it is cut rather than refused. */
const MAX_INPUT_CHARS = 60_000;

export function extractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy scrubbing — applied to everything the model returns
// ─────────────────────────────────────────────────────────────────────────────

const PAN = /[A-Z]{5}\d{4}[A-Z]/g;
const PAN_ONE = /[A-Z]{5}\d{4}[A-Z]/;
/** Aadhaar: twelve digits, usually printed in groups of four. */
const AADHAAR = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
/** Anything that looks like an account or card number: nine or more digits in a run. */
const LONG_DIGITS = /\d{9,}/g;

function scrubString(value: string): string {
  return value
    .replace(PAN, "[PAN removed]")
    .replace(AADHAAR, "[number removed]")
    .replace(LONG_DIGITS, "[number removed]");
}

/** A phone keeps its digits — but only if it is shaped like a phone and nothing else. */
function scrubPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+?[\d\s()-]{10,18}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  // Twelve bare digits without +91 is Aadhaar-shaped; refuse rather than guess.
  if (digits.length === 12 && !trimmed.startsWith("+") && !digits.startsWith("91")) return null;
  return trimmed;
}

/** Last four characters of whatever identifier the model returned, alphanumerics only. */
function lastFour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[^A-Za-z0-9]/g, "");
  return clean.length >= 4 ? clean.slice(-4).toUpperCase() : null;
}

/**
 * Pulls a full PAN out of a party before the sweep removes it, keeping only the last four.
 * The model was told not to return one; this is what happens if it does anyway.
 */
function reducePartyIdentifiers(party: Record<string, unknown>): void {
  if (typeof party.panLast4 === "string" && party.panLast4.length > 4) {
    party.panLast4 = lastFour(party.panLast4.match(PAN_ONE)?.[0] ?? party.panLast4);
  }
  if (party.panLast4 == null) {
    for (const v of Object.values(party)) {
      const found = typeof v === "string" ? v.match(PAN_ONE)?.[0] : undefined;
      if (found) {
        party.panLast4 = lastFour(found);
        break;
      }
    }
  }
  if (typeof party.loanLast4 === "string" && party.loanLast4.length > 4) {
    party.loanLast4 = lastFour(party.loanLast4);
  }
  // Fields the sheet has no place for, and which are the dangerous ones if invented.
  delete party.pan;
  delete party.aadhaar;
  delete party.accountNumber;
  delete party.loanAccount;
}

/** Deep sweep. Phones are handled by shape; everything else loses identifier-shaped runs. */
function scrub(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return key === "phone" ? scrubPhone(value) : scrubString(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v, k)]),
    );
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// The model call
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM = `You help a small property-curation team in Bangalore fill in a structured "deal
sheet" for a direct owner-to-buyer home sale. You are given text a curator pasted: a WhatsApp
chat export, an email, or their own notes. You propose sheet fields from it. A person reviews
every field you propose before anything is saved.

THE ONE RULE: propose only what the text actually states. Do not infer a value from what is
typical, do not fill gaps, do not compute a total the text does not give. If the text is
ambiguous, or two messages disagree (an amount revised mid-chat, say), propose the latest stated
value and list the field as uncertain with a short reason. Omitting a field is always better than
guessing one.

PRIVACY — these are absolute:
- Never output an Aadhaar number, in whole or in part.
- Never output a full PAN. If a PAN appears, give only its last four characters, as panLast4.
- Never output a full bank account or loan account number. Last four digits only, as loanLast4.
- Do not copy chat lines or quote the text back. Output the fields, not the conversation.

Conventions:
- Money is in paise: an integer, rupees x 100. "Rs 1.16 Cr" is 1160000000; "5 L" / "5 lakh" is
  50000000; "40k" is 400000.
- Dates are YYYY-MM-DD. Indian chats write dates day-first: 13/10/26 is 2026-10-13.
- shareBps is a seller's share in basis points: 50% is 5000. Shares across sellers sum to 10000.
- executionDate is the date the MOU was or will be signed, not the date of a token payment.
- playbook: BUILDER_ASSIGNMENT when a builder's Agreement to Sell is being assigned (builder
  approval, transfer fee); REGISTERED_RESALE when a sale deed is registered at the sub-registrar.
- payments: every payment the text mentions, made or planned. paidAt is null when not yet paid.
  kind is one of TOKEN, BOOKING, SELF_FUNDING, LOAN_DISBURSAL, SELLER_LOAN_PAYOFF, TDS, BALANCE,
  OTHER. toLabel names who receives it ("Seller One", "Seller bank (loan payoff)").
- Uncertain field paths are dotted, e.g. "considerationPaise" or "sellers.1.email".
- notes: one or two plain sentences for the curator about what you could and could not find.`;

const party = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    panLast4: { type: "string" },
  },
  additionalProperties: false,
} as const;

const bank = {
  type: "object",
  properties: {
    name: { type: "string" },
    branch: { type: "string" },
    email: { type: "string" },
    loanLast4: { type: "string" },
  },
  additionalProperties: false,
} as const;

const payer = { type: "string", enum: ["BUYER", "SELLER", "SHARED"] } as const;

/** What the model must return. Every sheet field is optional: absent means "the text did not say". */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    proposed: {
      type: "object",
      properties: {
        playbook: { type: "string", enum: ["BUILDER_ASSIGNMENT", "REGISTERED_RESALE"] },
        propertyLabel: { type: "string" },
        builder: { type: "string" },
        builderAgreementDate: { type: "string" },
        associationName: { type: "string" },
        superBuiltUpSqft: { type: "number" },
        considerationPaise: { type: "integer" },
        loanPaise: { type: "integer" },
        executionDate: { type: "string" },
        deadlineDays: { type: "integer" },
        extensionDays: { type: "integer" },
        sellers: {
          type: "array",
          items: {
            type: "object",
            properties: { ...party.properties, shareBps: { type: "integer" } },
            additionalProperties: false,
          },
        },
        buyer: party,
        sellerBank: bank,
        buyerBank: bank,
        stampDutyPayer: payer,
        transferFeePayer: payer,
        pastDuesPayer: { type: "string", enum: ["BUYER", "SELLER"] },
        penaltyPaise: { type: "integer" },
        penaltyParty: { type: "string", enum: ["BUYER", "SELLER", "BOTH"] },
        lateSelfFundingPenaltyPerDayPaise: { type: "integer" },
        bankDelayAutoExtension: { type: "boolean" },
        possessionNotes: { type: "string" },
      },
      additionalProperties: false,
    },
    payments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["TOKEN", "BOOKING", "SELF_FUNDING", "LOAN_DISBURSAL", "SELLER_LOAN_PAYOFF", "TDS", "BALANCE", "OTHER"],
          },
          amountPaise: { type: "integer" },
          fromLabel: { type: "string" },
          toLabel: { type: "string" },
          paidAt: { type: ["string", "null"] },
        },
        required: ["kind", "amountPaise", "toLabel", "paidAt"],
        additionalProperties: false,
      },
    },
    uncertain: {
      type: "array",
      items: {
        type: "object",
        properties: { field: { type: "string" }, reason: { type: "string" } },
        required: ["field", "reason"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["proposed", "payments", "uncertain", "notes"],
  additionalProperties: false,
} as const;

/**
 * One request. Every failure path throws a message of our own — never the SDK's, which could in
 * principle echo request content, and never anything derived from the pasted text.
 */
async function callModel(text: string, current: PartialDealSheet | undefined): Promise<unknown> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: SYSTEM,
      // `medium`: reading amounts and dates out of a chat rewards care, not exploration.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            "<current_sheet>",
            current ? JSON.stringify(current) : "(empty — a new deal)",
            "</current_sheet>",
            "",
            "<pasted_text>",
            text,
            "</pasted_text>",
            "",
            "Propose deal-sheet fields and payments from the pasted text. Propose a field only",
            "where the text supports it; where it agrees with the current sheet, you may omit it.",
          ].join("\n"),
        },
      ],
    });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? ` (${err.status ?? "no status"})` : "";
    throw new Error(`The model call failed${status}`);
  }

  if (response.stop_reason === "refusal") throw new Error("The model declined to read this text");

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("The model returned no proposal");

  return parseJsonLoosely(block.text);
}

/** Structured output should already be bare JSON; tolerate a fence or a preamble regardless. */
function parseJsonLoosely(raw: string): unknown {
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model's proposal was not readable");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error("The model's proposal was not readable");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation, field by field
// ─────────────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const firstMessage = (err: z.ZodError) => err.issues[0]?.message ?? "Did not validate";

/**
 * Validates one party-like object. A failing optional sub-field (a malformed email, say) is
 * dropped and flagged; a failing required one drops the whole object.
 */
function validateObject<T>(
  schema: z.ZodType<T>,
  value: Record<string, unknown>,
  path: string,
  uncertain: UncertainField[],
): T | null {
  const candidate = { ...value };
  for (let attempt = 0; attempt < 4; attempt++) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    const key = parsed.error.issues[0]?.path[0];
    if (typeof key !== "string" || key === "name" || key === "shareBps" || !(key in candidate)) {
      uncertain.push({ field: path, reason: `Dropped: ${firstMessage(parsed.error)}` });
      return null;
    }
    uncertain.push({ field: `${path}.${key}`, reason: `Dropped: ${firstMessage(parsed.error)}` });
    delete candidate[key];
  }
  uncertain.push({ field: path, reason: "Dropped: did not validate" });
  return null;
}

function validateProposed(raw: unknown, uncertain: UncertainField[]): PartialDealSheet {
  if (!isRecord(raw)) return {};
  const shape = partialDealSheetSchema.shape;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    // Null or absent means the text did not say. Never let a schema default stand in for it.
    if (value === null || value === undefined || value === "") continue;
    if (!(key in shape)) continue;

    if (key === "sellers") {
      if (!Array.isArray(value)) continue;
      const sellers = value
        .map((s, i) => (isRecord(s) ? validateObject(sheetSellerSchema, s, `sellers.${i}`, uncertain) : null))
        .filter((s): s is NonNullable<typeof s> => s !== null);
      // A dropped seller would renumber the rest; propose the list only if it survived whole.
      if (sellers.length === value.length && sellers.length > 0) out.sellers = sellers;
      else if (sellers.length !== value.length) {
        uncertain.push({ field: "sellers", reason: "Not every seller could be read; enter them by hand" });
      }
      continue;
    }
    if (key === "buyer" && isRecord(value)) {
      const buyer = validateObject(sheetPartySchema, value, "buyer", uncertain);
      if (buyer) out.buyer = buyer;
      continue;
    }
    if ((key === "sellerBank" || key === "buyerBank") && isRecord(value)) {
      const b = validateObject(sheetBankSchema, value, key, uncertain);
      if (b) out[key] = b;
      continue;
    }

    const parsed = shape[key as keyof typeof shape].safeParse(value);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
    else if (!parsed.success) uncertain.push({ field: key, reason: `Dropped: ${firstMessage(parsed.error)}` });
  }

  return out as PartialDealSheet;
}

const proposedPaymentSchema = z.object({
  kind: z.enum(["TOKEN", "BOOKING", "SELF_FUNDING", "LOAN_DISBURSAL", "SELLER_LOAN_PAYOFF", "TDS", "BALANCE", "OTHER"]),
  amountPaise: z.coerce.number().int().positive(),
  fromLabel: z.string().trim().max(120).optional(),
  toLabel: z.string().trim().min(1).max(120),
  paidAt: z
    .string()
    .trim()
    .regex(ISO_DATE)
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
    .nullable()
    .catch(null),
});

function validatePayments(raw: unknown, uncertain: UncertainField[]): LedgerPayment[] {
  if (!Array.isArray(raw)) return [];
  const out: LedgerPayment[] = [];
  raw.slice(0, 30).forEach((p, i) => {
    const parsed = proposedPaymentSchema.safeParse(p);
    if (parsed.success) out.push({ ...parsed.data, txnRef: null });
    else uncertain.push({ field: `payments.${i}`, reason: `Dropped: ${firstMessage(parsed.error)}` });
  });
  return out;
}

function validateUncertain(raw: unknown): UncertainField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .filter((u) => typeof u.field === "string" && /^[A-Za-z0-9_.]{1,80}$/.test(u.field))
    .slice(0, 40)
    .map((u) => ({
      field: u.field as string,
      reason: typeof u.reason === "string" ? u.reason.slice(0, 300) : "The model was unsure",
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proposes sheet fields and ledger payments from pasted text. Writes nothing.
 *
 * Throws "The model is not configured" without `ANTHROPIC_API_KEY` — the route maps that to a
 * 503. Every other throw carries a message of this file's own making, never the text.
 */
export async function proposeSheetFromText(
  text: string,
  current?: PartialDealSheet,
): Promise<ExtractionProposal> {
  if (!extractionConfigured()) throw new Error("The model is not configured");

  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste some text to read");

  const raw = await callModel(trimmed.slice(0, MAX_INPUT_CHARS), current);
  if (!isRecord(raw)) throw new Error("The model's proposal was not readable");

  // Identifiers first — a full PAN has to be reduced to its last four *before* the sweep blanks
  // it — then the sweep over everything, then validation of what is left.
  const proposedRaw = isRecord(raw.proposed) ? structuredClone(raw.proposed) : {};
  for (const key of ["buyer", "sellerBank", "buyerBank"]) {
    if (isRecord(proposedRaw[key])) reducePartyIdentifiers(proposedRaw[key]);
  }
  if (Array.isArray(proposedRaw.sellers)) {
    for (const s of proposedRaw.sellers) if (isRecord(s)) reducePartyIdentifiers(s);
  }

  const uncertain = validateUncertain(scrub(raw.uncertain));
  const proposed = validateProposed(scrub(proposedRaw), uncertain);
  const payments = validatePayments(scrub(raw.payments), uncertain);
  const notes = typeof raw.notes === "string" ? scrubString(raw.notes).slice(0, 600) : "";

  return { proposed, payments, uncertain, notes };
}
