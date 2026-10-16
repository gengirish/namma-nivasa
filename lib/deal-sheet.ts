import { z } from "zod";

import { IST_OFFSET_MINUTES } from "@/lib/slots";

/**
 * The deal sheet: the structured facts every Close document renders from.
 *
 * It lives in `Deal.sheet` as JSON because the two playbooks need different fields; this schema,
 * not a column list, is the contract. Everything a document states — a name, an amount, a date —
 * comes from here or from the payment ledger, never from a model and never typed into a template.
 *
 * Privacy (handover §7): no Aadhaar, no full PAN, no full loan account number. `panLast4` and
 * `loanLast4` are the only identifiers this shape can hold; a full PAN exists only inside one
 * render request.
 *
 * Money is paise as an integer JS number — exact well past any real price, same reasoning as
 * `Property.pricePaise` reading back as a number. Dates are IST calendar dates as `YYYY-MM-DD`,
 * because a deed is executed on a day, not at an instant.
 */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = z
  .string()
  .trim()
  .regex(ISO_DATE, "Use a YYYY-MM-DD date")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "That date does not exist");

const paise = z.coerce.number().int("Paise must be a whole number").nonnegative();
const last4 = z.string().trim().regex(/^[A-Za-z0-9]{4}$/, "Last four characters only");
const optionalEmail = z.email("That email address does not look right").max(200).optional().nullable();

export const sheetPartySchema = z.object({
  name: z.string().trim().min(2, "Add the party's name").max(160),
  email: optionalEmail,
  phone: z.string().trim().max(20).optional().nullable(),
  panLast4: last4.optional().nullable(),
});

export const sheetSellerSchema = sheetPartySchema.extend({
  /** Share of the property in basis points (5000 = 50%). Sellers must sum to 10000. */
  shareBps: z.coerce.number().int().min(1).max(10000),
});

export const sheetBankSchema = z.object({
  name: z.string().trim().min(2).max(120),
  branch: z.string().trim().max(160).optional().nullable(),
  email: optionalEmail,
  loanLast4: last4.optional().nullable(),
});

export const payerSchema = z.enum(["BUYER", "SELLER", "SHARED"]);

export const dealSheetSchema = z.object({
  playbook: z.enum(["BUILDER_ASSIGNMENT", "REGISTERED_RESALE"]),
  propertyLabel: z.string().trim().min(3).max(200),
  /** The builder whose Agreement to Sell is assigned. Required in practice for BUILDER_ASSIGNMENT. */
  builder: z.string().trim().max(160).optional().nullable(),
  builderAgreementDate: isoDate.optional().nullable(),
  associationName: z.string().trim().max(200).optional().nullable(),
  superBuiltUpSqft: z.coerce.number().positive().optional().nullable(),

  considerationPaise: paise.refine((v) => v > 0, "Add the sale consideration"),
  /**
   * Buyer's home-loan amount. Optional because it is usually only known after sanction; when
   * absent, `deriveSheet()` treats the loan as whatever closes the gap to consideration.
   */
  loanPaise: paise.optional().nullable(),

  /** The MOU's execution date. The deadline runs from here. */
  executionDate: isoDate.optional().nullable(),
  deadlineDays: z.coerce.number().int().min(1).max(365).default(60),
  extensionDays: z.coerce.number().int().min(0).max(180).default(15),

  sellers: z.array(sheetSellerSchema).min(1, "Add at least one seller").max(6),
  buyer: sheetPartySchema,
  sellerBank: sheetBankSchema.optional().nullable(),
  buyerBank: sheetBankSchema.optional().nullable(),

  stampDutyPayer: payerSchema.default("BUYER"),
  transferFeePayer: payerSchema.default("SELLER"),
  /** Who bears dues that accrued before transfer (maintenance, utilities, property tax). */
  pastDuesPayer: z.enum(["BUYER", "SELLER"]).default("SELLER"),

  /** Penalty on a party for non-performance, e.g. the ₹3 L seller-side penalty. */
  penaltyPaise: paise.optional().nullable(),
  penaltyParty: z.enum(["BUYER", "SELLER", "BOTH"]).default("SELLER"),
  lateSelfFundingPenaltyPerDayPaise: paise.optional().nullable(),
  /**
   * Whether the MOU extends the deadline automatically when a bank or builder causes the delay.
   * Without it a penalty can land on a party for someone else's delay (checker rule 11).
   */
  bankDelayAutoExtension: z.boolean().default(false),
  /** Free text for possession specifics; possession itself is always in the binding body. */
  possessionNotes: z.string().trim().max(1000).optional().nullable(),
});

export type DealSheet = z.infer<typeof dealSheetSchema>;
export type DealSheetInput = z.input<typeof dealSheetSchema>;
export type SheetParty = z.infer<typeof sheetPartySchema>;
export type SheetSeller = z.infer<typeof sheetSellerSchema>;

/** A partial sheet — what extraction proposes and what a DRAFT deal may hold. */
export const partialDealSheetSchema = dealSheetSchema.partial();
export type PartialDealSheet = z.infer<typeof partialDealSheetSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Ledger shape shared by the checker, the documents and the dashboard
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerPaymentKind =
  | "TOKEN"
  | "BOOKING"
  | "SELF_FUNDING"
  | "LOAN_DISBURSAL"
  | "SELLER_LOAN_PAYOFF"
  | "TDS"
  | "BALANCE"
  | "OTHER";

/** A `DealPayment` row as plain data. `paidAt` null = planned, not yet paid. */
export interface LedgerPayment {
  kind: LedgerPaymentKind;
  amountPaise: number;
  fromLabel?: string;
  toLabel: string;
  /** IST calendar date `YYYY-MM-DD`, or null when planned. */
  paidAt: string | null;
  txnRef?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived values — pure, no I/O
// ─────────────────────────────────────────────────────────────────────────────

/** Sec 194-IA: 1% TDS when consideration is ₹50 L or more. */
export const TDS_THRESHOLD_PAISE = 50_00_000 * 100;
export const TDS_RATE_BPS = 100;

export interface SellerTds {
  name: string;
  shareBps: number;
  tdsPaise: number;
}

export interface DerivedSheet {
  /** Token + booking: what the documents call "the booking amount". */
  bookingAmountPaise: number;
  /** Token + booking + self-funding: the buyer's own money before the loan. */
  ownFundsPaise: number;
  tdsPaise: number;
  tdsBySeller: SellerTds[];
  /** Explicit `loanPaise`, or consideration − own funds − TDS. */
  loanPaise: number;
  netToSellersPaise: number;
  /** executionDate + deadlineDays, or null with no execution date. */
  deadlineDate: string | null;
  /** deadline + extensionDays. */
  extendedDeadlineDate: string | null;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** TDS split across sellers by share; the rounding remainder goes to the first seller. */
export function tdsFor(considerationPaise: number, sellers: { name: string; shareBps: number }[]): {
  tdsPaise: number;
  tdsBySeller: SellerTds[];
} {
  const tdsPaise =
    considerationPaise >= TDS_THRESHOLD_PAISE
      ? Math.round((considerationPaise * TDS_RATE_BPS) / 10_000)
      : 0;
  const totalBps = sum(sellers.map((s) => s.shareBps)) || 1;
  const tdsBySeller = sellers.map((s) => ({
    name: s.name,
    shareBps: s.shareBps,
    tdsPaise: Math.floor((tdsPaise * s.shareBps) / totalBps),
  }));
  const remainder = tdsPaise - sum(tdsBySeller.map((s) => s.tdsPaise));
  if (tdsBySeller[0]) tdsBySeller[0].tdsPaise += remainder;
  return { tdsPaise, tdsBySeller };
}

/** Adds whole days to an IST calendar date. Pure calendar arithmetic, no zone involved. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last instant of an IST calendar day, as UTC — what a deadline "on or before" means. */
export function istEndOfDay(date: string): Date {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  return new Date(midnightUtc - IST_OFFSET_MINUTES * 60_000 + 24 * 3_600_000 - 1);
}

/** The IST calendar date an instant falls on. */
export function istDateOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export function deriveSheet(sheet: DealSheet, payments: LedgerPayment[]): DerivedSheet {
  const of = (kind: LedgerPaymentKind) =>
    sum(payments.filter((p) => p.kind === kind).map((p) => p.amountPaise));

  const bookingAmountPaise = of("TOKEN") + of("BOOKING");
  const ownFundsPaise = bookingAmountPaise + of("SELF_FUNDING");
  const { tdsPaise, tdsBySeller } = tdsFor(sheet.considerationPaise, sheet.sellers);
  const loanPaise = sheet.loanPaise ?? Math.max(0, sheet.considerationPaise - ownFundsPaise - tdsPaise);
  const deadlineDate = sheet.executionDate ? addDays(sheet.executionDate, sheet.deadlineDays) : null;

  return {
    bookingAmountPaise,
    ownFundsPaise,
    tdsPaise,
    tdsBySeller,
    loanPaise,
    netToSellersPaise: sheet.considerationPaise - tdsPaise,
    deadlineDate,
    extendedDeadlineDate: deadlineDate ? addDays(deadlineDate, sheet.extensionDays) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers — the documents and the dashboard must format identically
// ─────────────────────────────────────────────────────────────────────────────

/** "₹1,16,000" — en-IN grouping, rupees, paise shown only when non-zero. */
export function formatRupees(paiseValue: number): string {
  const rupees = paiseValue / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "15 December 2026" — the long form documents use. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "15/12/2026" — the house DD/MM/YYYY display. */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Stable hash input: keys sorted so a re-saved, unchanged sheet hashes the same. */
export function canonicalSheetJson(sheet: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(sheet));
}
