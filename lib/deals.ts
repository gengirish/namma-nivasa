import { createHash } from "node:crypto";

import {
  Prisma,
  type DealDocumentKind,
  type DealPartyRole,
  type DealPaymentKind,
  type DealPlaybook,
  type DealStatus,
  type MilestoneStatus,
} from "@prisma/client";

import { DomainError } from "@/lib/auth";
import { checkDealConsistency } from "@/lib/deal-consistency";
import { renderDealDocument } from "@/lib/deal-documents";
import { proposeSheetFromText } from "@/lib/deal-extract";
import { PLAYBOOKS, milestoneDueDate } from "@/lib/deal-playbooks";
import {
  addDays,
  canonicalSheetJson,
  dealSheetSchema,
  deriveSheet,
  formatRupees,
  formatShortDate,
  istDateOf,
  istEndOfDay,
  partialDealSheetSchema,
  type DealSheet,
  type LedgerPayment,
  type PartialDealSheet,
} from "@/lib/deal-sheet";
import type {
  ConsistencyIssue,
  DealDetailDto,
  DealDocumentSummaryDto,
  DealListItemDto,
  DealMilestoneDto,
  DealPartyDto,
  DealPaymentDto,
  DocumentText,
  ExtractionProposal,
  LedgerSummaryDto,
} from "@/lib/deal-types";
import { dashboardLink, notify, teamInbox } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { makeReference, normalizePhone } from "@/lib/validations";

/**
 * Nivasa Close — every write to a deal, and the rules that decide its status.
 *
 * Routes under `app/api/admin/deals` parse, authorise and call one function here; nothing in
 * this file knows about a request. The cron at `app/api/cron/deal-milestones` calls
 * `runDealMilestoneCron()` and nothing else.
 *
 * Conventions this file holds to, beyond CLAUDE.md's:
 *
 *   - **Dates the curator types are IST calendar dates** (`YYYY-MM-DD`). A milestone or the
 *     deadline falls due at the *end* of its IST day (`istEndOfDay`), because "on or before
 *     15 December" includes the evening of the 15th. The MOU's signing instant is the *start* of
 *     its IST day. A payment's `paidAt` is stored as **IST noon** of the day it was paid — the
 *     middle of the day, so reading it back through `istDateOf()` returns the same date however
 *     the instant is later rounded or compared. A payment is a day, not a moment.
 *   - **Parties are derived from the sheet.** `DealParty` rows are rewritten from the sheet on
 *     every sheet save; the sheet is the one place a name or an email is edited.
 *   - **No full PAN is ever written.** The sheet schema only knows `panLast4`, and
 *     `assertNoFullPan()` refuses a request that tries to smuggle one in under another key or in
 *     free text, rather than letting zod strip it silently and the curator believe it was saved.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants and small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** How close the deadline must be before an overdue milestone puts the deal AT_RISK. */
export const AT_RISK_WINDOW_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_MILESTONE: MilestoneStatus[] = ["DONE", "SKIPPED"];
const LIVE_DEAL: DealStatus[] = ["ACTIVE", "AT_RISK"];
const TERMINAL_DEAL: DealStatus[] = ["CLOSED", "CANCELLED"];

const ROLE_LABEL: Record<DealPartyRole, string> = {
  SELLER: "Seller",
  BUYER: "Buyer",
  SELLER_BANK: "Seller's bank",
  BUYER_BANK: "Buyer's bank",
  BUILDER: "Builder",
  ASSOCIATION: "Owners association",
  OTHER: "Other",
};

const PAYMENT_LABEL: Record<DealPaymentKind, string> = {
  TOKEN: "Token",
  BOOKING: "Booking",
  SELF_FUNDING: "Self-funding",
  LOAN_DISBURSAL: "Loan disbursal",
  SELLER_LOAN_PAYOFF: "Seller's loan payoff",
  TDS: "TDS",
  BALANCE: "Balance",
  OTHER: "Payment",
};

const DOCUMENT_LABEL: Record<DealDocumentKind, string> = {
  MOU: "MOU",
  LOU: "LOU",
  BANK_NOC_LOD_REQUEST: "NOC and LOD request",
  BANK_FORECLOSURE_REQUEST: "foreclosure request",
  BANK_FOLLOW_UP: "bank follow-up",
};

/** The first instant of an IST calendar day. */
function istStartOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

/** Where a payment date is stored — see the file header. */
function istNoon(date: string): Date {
  return new Date(`${date}T12:00:00+05:30`);
}

/** Whole calendar days between two IST dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    String(err.meta?.target ?? "").includes(field)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A full PAN as written: an uppercase token, so ordinary words and labels do not trip it. */
const PAN_IN_TEXT = /\b[A-Z]{5}\d{4}[A-Z]\b/;
/** A key that names a PAN: `pan`, `panNumber`, `sellerPan`, `fullPAN` — not `company`. */
const PAN_KEY = /^pan|pan$|pan[A-Z_\d]|Pan|PAN/;

/**
 * Refuses anything that would persist a full PAN. Handover §7: full PANs exist only inside one
 * render request. Zod would strip an unknown `pan` key without complaint, which is worse than a
 * refusal — the curator would believe it had been saved somewhere.
 */
export function assertNoFullPan(value: unknown, path = "sheet"): void {
  if (typeof value === "string") {
    if (PAN_IN_TEXT.test(value)) {
      throw new DomainError(
        `A full PAN appears in ${path}. Store only the last four characters; full PANs go in the render request.`,
        400,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoFullPan(item, `${path}.${i}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (
        PAN_KEY.test(key) &&
        typeof inner === "string" &&
        inner.replace(/[^A-Za-z0-9]/g, "").length > 4
      ) {
        throw new DomainError(
          `${path}.${key} holds more than the last four characters of a PAN. Store panLast4 only.`,
          400,
        );
      }
      assertNoFullPan(inner, `${path}.${key}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger and hashing
// ─────────────────────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string;
  kind: DealPaymentKind;
  amountPaise: bigint;
  fromLabel: string;
  toLabel: string;
  paidAt: Date | null;
  txnRef: string | null;
  createdAt: Date;
};

const paymentOrder: Prisma.DealPaymentOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

function toLedger(rows: PaymentRow[]): LedgerPayment[] {
  return rows.map((p) => ({
    kind: p.kind,
    amountPaise: Number(p.amountPaise),
    fromLabel: p.fromLabel,
    toLabel: p.toLabel,
    paidAt: p.paidAt ? istDateOf(p.paidAt) : null,
    txnRef: p.txnRef,
  }));
}

/**
 * What a document version was rendered from: the stored sheet plus the ledger. Hashed from the
 * stored JSON rather than a re-parse, so "stale" means "someone changed something", not "the
 * schema's defaults moved".
 */
function sheetHashOf(rawSheet: unknown, ledger: LedgerPayment[]): string {
  return createHash("sha256")
    .update(canonicalSheetJson({ sheet: rawSheet, payments: ledger }))
    .digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusInput {
  status: DealStatus;
  deadlineAt: Date | null;
  milestones: { status: MilestoneStatus; dueAt: Date | null }[];
}

/**
 * The status a deal should have now. Pure.
 *
 *   - CLOSED and CANCELLED are a curator's word and never change here.
 *   - DRAFT stays DRAFT: it leaves DRAFT only when the sheet is complete (`updateSheet`).
 *   - ACTIVE ↔ AT_RISK: AT_RISK when any milestone is BLOCKED, or when the deadline is within
 *     `AT_RISK_WINDOW_DAYS` (or past) and an open milestone is overdue. Otherwise ACTIVE — a
 *     deal recovers when the blocking milestone is cleared.
 */
export function computeStatus(deal: StatusInput, now: Date = new Date()): DealStatus {
  if (TERMINAL_DEAL.includes(deal.status) || deal.status === "DRAFT") return deal.status;

  if (deal.milestones.some((m) => m.status === "BLOCKED")) return "AT_RISK";

  const deadlineClose =
    deal.deadlineAt !== null &&
    deal.deadlineAt.getTime() - now.getTime() <= AT_RISK_WINDOW_DAYS * DAY_MS;
  const overdue = deal.milestones.some(
    (m) =>
      !CLOSED_MILESTONE.includes(m.status) && m.dueAt !== null && m.dueAt.getTime() < now.getTime(),
  );
  return deadlineClose && overdue ? "AT_RISK" : "ACTIVE";
}

/**
 * Recomputes and stores one deal's status. The write is conditional on the status it read, so
 * two concurrent callers cannot both observe the same transition — which is what lets the cron
 * send "newly at risk" once.
 */
export async function recomputeStatus(
  dealId: string,
  now: Date = new Date(),
): Promise<{ before: DealStatus; after: DealStatus; changed: boolean }> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      status: true,
      deadlineAt: true,
      milestones: { select: { status: true, dueAt: true } },
    },
  });
  if (!deal) throw new DomainError("Deal not found", 404);

  const after = computeStatus(deal, now);
  if (after === deal.status) return { before: deal.status, after, changed: false };

  const { count } = await prisma.deal.updateMany({
    where: { id: dealId, status: deal.status },
    data: { status: after },
  });
  return { before: deal.status, after, changed: count === 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet → rows
// ─────────────────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

function partiesFrom(sheet: PartialDealSheet): Omit<Prisma.DealPartyCreateManyInput, "dealId">[] {
  const rows: Omit<Prisma.DealPartyCreateManyInput, "dealId">[] = [];
  const phone = (raw: string | null | undefined) => (raw ? normalizePhone(raw) : null);

  (sheet.sellers ?? []).forEach((s, i) =>
    rows.push({
      role: "SELLER",
      name: s.name,
      email: s.email ?? null,
      phone: phone(s.phone),
      shareBps: s.shareBps,
      panLast4: s.panLast4 ?? null,
      sortOrder: i,
    }),
  );
  if (sheet.buyer) {
    rows.push({
      role: "BUYER",
      name: sheet.buyer.name,
      email: sheet.buyer.email ?? null,
      phone: phone(sheet.buyer.phone),
      panLast4: sheet.buyer.panLast4 ?? null,
      sortOrder: 0,
    });
  }
  if (sheet.sellerBank) {
    rows.push({ role: "SELLER_BANK", name: sheet.sellerBank.name, email: sheet.sellerBank.email ?? null, sortOrder: 0 });
  }
  if (sheet.buyerBank) {
    rows.push({ role: "BUYER_BANK", name: sheet.buyerBank.name, email: sheet.buyerBank.email ?? null, sortOrder: 0 });
  }
  if (sheet.builder) rows.push({ role: "BUILDER", name: sheet.builder, sortOrder: 0 });
  if (sheet.associationName) {
    rows.push({ role: "ASSOCIATION", name: sheet.associationName, sortOrder: 0 });
  }
  return rows;
}

async function syncParties(tx: Tx, dealId: string, sheet: PartialDealSheet): Promise<void> {
  await tx.dealParty.deleteMany({ where: { dealId } });
  const rows = partiesFrom(sheet);
  if (rows.length) await tx.dealParty.createMany({ data: rows.map((r) => ({ ...r, dealId })) });
}

/**
 * Re-dates every playbook milestone from the two anchors. Milestones whose key is not in the
 * playbook (none today) are left alone.
 */
async function redateMilestones(
  tx: Tx,
  dealId: string,
  playbook: DealPlaybook,
  anchors: { executionDate: string | null; deadlineDate: string | null },
): Promise<void> {
  const byKey = new Map(PLAYBOOKS[playbook].milestones.map((m) => [m.key, m]));
  const rows = await tx.dealMilestone.findMany({ where: { dealId }, select: { id: true, key: true } });
  for (const row of rows) {
    const spec = byKey.get(row.key);
    if (!spec) continue;
    const due = milestoneDueDate(spec, anchors);
    await tx.dealMilestone.update({
      where: { id: row.id },
      data: { dueAt: due ? istEndOfDay(due) : null },
    });
  }
}

/** Parses a raw sheet: the full result when complete, else the partial one, else a 400. */
function parseSheet(raw: Record<string, unknown>): {
  full: DealSheet | null;
  partial: PartialDealSheet;
} {
  const full = dealSheetSchema.safeParse(raw);
  if (full.success) return { full: full.data, partial: full.data };

  const partial = partialDealSheetSchema.safeParse(raw);
  if (!partial.success) {
    const issue = partial.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new DomainError(`${issue?.message ?? "The deal sheet is not valid"}${where}`, 400);
  }
  return { full: null, partial: partial.data };
}

function firstSheetIssue(raw: unknown): string {
  const result = dealSheetSchema.safeParse(raw);
  if (result.success) return "";
  const issue = result.error.issues[0];
  return `${issue?.message ?? "Incomplete"}${issue?.path.length ? ` (${issue.path.join(".")})` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateDealInput {
  playbook: DealPlaybook;
  propertyLabel?: string;
  considerationPaise?: number;
  propertyId?: string;
  enquiryId?: string;
  sheet?: Record<string, unknown>;
}

const REFERENCE_ATTEMPTS = 5;

/**
 * A new DRAFT deal: the playbook expanded into milestones (undated until the MOU date is known),
 * parties from whatever the sheet already names, and a `CLS-XXXXXX` reference.
 *
 * `propertyLabel` is a snapshot — from the caller, else the listing's name — for the same reason
 * `Enquiry.propertyName` is: the listing can be renamed or archived and the deal must still read.
 */
export async function createDeal(input: CreateDealInput, adminId: string | null): Promise<DealDetailDto> {
  const rawSheet = asRecord(input.sheet);
  assertNoFullPan(rawSheet);

  let property: { id: string; name: string; pricePaise: bigint } | null = null;
  if (input.propertyId) {
    property = await prisma.property.findUnique({
      where: { id: input.propertyId },
      select: { id: true, name: true, pricePaise: true },
    });
    if (!property) throw new DomainError("That listing does not exist", 404);
  }

  const propertyLabel =
    input.propertyLabel?.trim() ||
    (typeof rawSheet.propertyLabel === "string" ? rawSheet.propertyLabel.trim() : "") ||
    property?.name;
  if (!propertyLabel) throw new DomainError("Name the property", 400);

  const considerationPaise =
    input.considerationPaise ??
    (typeof rawSheet.considerationPaise === "number" ? rawSheet.considerationPaise : undefined) ??
    (property ? Number(property.pricePaise) : 0);

  // The deal's own facts win over whatever the sheet carried for them.
  const merged: Record<string, unknown> = {
    ...rawSheet,
    playbook: input.playbook,
    propertyLabel,
    ...(considerationPaise > 0 ? { considerationPaise } : {}),
  };
  const { full, partial } = parseSheet(merged);
  const storedSheet = (full ?? partial) as Prisma.InputJsonValue;

  const milestones = PLAYBOOKS[input.playbook].milestones.map((m, i) => ({
    key: m.key,
    label: m.label,
    ownerRole: m.ownerRole,
    sortOrder: i,
  }));

  for (let attempt = 1; ; attempt += 1) {
    try {
      const id = await prisma.$transaction(async (tx) => {
        const deal = await tx.deal.create({
          data: {
            reference: makeReference("CLS"),
            playbook: input.playbook,
            status: "DRAFT",
            propertyId: property?.id ?? null,
            enquiryId: input.enquiryId ?? null,
            propertyLabel,
            considerationPaise: BigInt(considerationPaise),
            sheet: storedSheet,
            handledBy: adminId,
            milestones: { create: milestones },
          },
          select: { id: true },
        });
        await syncParties(tx, deal.id, partial);
        return deal.id;
      });

      // A sheet complete at creation goes through the same path as a later edit, so dates,
      // deadline and ACTIVE are set by one piece of code.
      if (full) return updateSheet(id, full as unknown as Record<string, unknown>, adminId);
      return getDeal(id);
    } catch (err) {
      if (isUniqueViolation(err, "enquiryId")) {
        throw new DomainError("That enquiry already has a deal", 409);
      }
      if (isUniqueViolation(err, "reference") && attempt < REFERENCE_ATTEMPTS) continue;
      throw err;
    }
  }
}

/**
 * The handover's "Could" item: one click from a CLOSED enquiry. The enquiry's snapshotted
 * `propertyName` becomes the label and the visitor becomes the buyer on the sheet. A second
 * click meets `Deal.enquiryId @unique` and answers 409.
 */
export async function createDealFromEnquiry(
  enquiryId: string,
  adminId: string | null,
  playbook: DealPlaybook = "BUILDER_ASSIGNMENT",
): Promise<DealDetailDto> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: {
      id: true,
      status: true,
      name: true,
      phone: true,
      email: true,
      propertyId: true,
      propertyName: true,
      property: { select: { name: true, pricePaise: true } },
    },
  });
  if (!enquiry) throw new DomainError("Enquiry not found", 404);
  if (enquiry.status !== "CLOSED") {
    throw new DomainError("Only a CLOSED enquiry can become a deal", 409);
  }

  const propertyLabel = enquiry.propertyName ?? enquiry.property?.name;
  if (!propertyLabel) {
    throw new DomainError("This enquiry names no home — create the deal by hand", 409);
  }

  return createDeal(
    {
      playbook,
      propertyLabel,
      propertyId: enquiry.propertyId ?? undefined,
      enquiryId: enquiry.id,
      considerationPaise: enquiry.property ? Number(enquiry.property.pricePaise) : undefined,
      sheet: { buyer: { name: enquiry.name, phone: enquiry.phone, email: enquiry.email } },
    },
    adminId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves the sheet. The body is merged over the stored sheet at the top level (send `null` to
 * clear a nullable field; arrays such as `sellers` are replaced whole).
 *
 * A DRAFT deal may hold a partial sheet; any other deal must keep a complete one (422). When the
 * merged sheet is complete: parties are rewritten, `considerationPaise` / `mouSignedAt` /
 * `deadlineAt` follow it, and — if either anchor moved — every playbook milestone is re-dated.
 * Re-dating only when an anchor moves keeps a curator's hand-set due date through an unrelated
 * edit such as a corrected email address. DRAFT becomes ACTIVE once the sheet is complete and
 * carries an execution date.
 */
export async function updateSheet(
  dealId: string,
  rawSheet: Record<string, unknown>,
  adminId: string | null,
): Promise<DealDetailDto> {
  assertNoFullPan(rawSheet);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      playbook: true,
      status: true,
      sheet: true,
      propertyLabel: true,
      mouSignedAt: true,
      deadlineAt: true,
      payments: { orderBy: paymentOrder },
    },
  });
  if (!deal) throw new DomainError("Deal not found", 404);

  const merged: Record<string, unknown> = {
    ...asRecord(deal.sheet),
    ...rawSheet,
    playbook: deal.playbook,
  };
  if (!merged.propertyLabel) merged.propertyLabel = deal.propertyLabel;

  const { full, partial } = parseSheet(merged);
  if (!full && deal.status !== "DRAFT") {
    throw new DomainError(`The sheet must stay complete once a deal is live: ${firstSheetIssue(merged)}`, 422);
  }

  let mouSignedAt: Date | null = deal.mouSignedAt;
  let deadlineAt: Date | null = deal.deadlineAt;
  let anchors: { executionDate: string | null; deadlineDate: string | null } | null = null;
  if (full) {
    const derived = deriveSheet(full, toLedger(deal.payments));
    mouSignedAt = full.executionDate ? istStartOfDay(full.executionDate) : null;
    deadlineAt = derived.deadlineDate ? istEndOfDay(derived.deadlineDate) : null;
    anchors = { executionDate: full.executionDate ?? null, deadlineDate: derived.deadlineDate };
  }
  const anchorsMoved =
    anchors !== null &&
    (mouSignedAt?.getTime() !== deal.mouSignedAt?.getTime() ||
      deadlineAt?.getTime() !== deal.deadlineAt?.getTime());

  const nextStatus: DealStatus =
    deal.status === "DRAFT" && full?.executionDate ? "ACTIVE" : deal.status;

  await prisma.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: dealId },
      data: {
        sheet: (full ?? partial) as Prisma.InputJsonValue,
        ...(partial.propertyLabel ? { propertyLabel: partial.propertyLabel } : {}),
        ...(partial.considerationPaise
          ? { considerationPaise: BigInt(partial.considerationPaise) }
          : {}),
        ...(full ? { mouSignedAt, deadlineAt } : {}),
        status: nextStatus,
        handledBy: adminId ?? undefined,
      },
    });
    await syncParties(tx, dealId, partial);
    if (anchors && anchorsMoved) await redateMilestones(tx, dealId, deal.playbook, anchors);
  });

  await recomputeStatus(dealId);
  return getDeal(dealId);
}

/** A curator's closure. Terminal: a closed or cancelled deal is not reopened here. */
export async function setDealStatus(
  dealId: string,
  status: "CLOSED" | "CANCELLED",
  adminId: string | null,
): Promise<DealDetailDto> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { status: true } });
  if (!deal) throw new DomainError("Deal not found", 404);
  if (deal.status === status) return getDeal(dealId);
  if (TERMINAL_DEAL.includes(deal.status)) {
    throw new DomainError(`This deal is already ${deal.status.toLowerCase()}`, 409);
  }

  await prisma.deal.update({
    where: { id: dealId },
    data: { status, closedAt: new Date(), handledBy: adminId ?? undefined },
  });
  return getDeal(dealId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestones
// ─────────────────────────────────────────────────────────────────────────────

export interface MilestoneUpdate {
  status?: MilestoneStatus;
  /** IST calendar date; due at the end of that day. Null clears it. */
  dueAt?: string | null;
  notes?: string | null;
}

/** `doneAt` is stamped on DONE and cleared on any other status. */
export async function updateMilestone(
  dealId: string,
  milestoneId: string,
  update: MilestoneUpdate,
): Promise<DealDetailDto> {
  const data: Prisma.DealMilestoneUpdateManyMutationInput = {};
  if (update.status) {
    data.status = update.status;
    data.doneAt = update.status === "DONE" ? new Date() : null;
  }
  if (update.dueAt !== undefined) data.dueAt = update.dueAt ? istEndOfDay(update.dueAt) : null;
  if (update.notes !== undefined) data.notes = update.notes?.trim() ? update.notes.trim() : null;

  // Scoped by deal as well as id, so a milestone id from another deal is a 404 rather than an
  // edit to somebody else's plan.
  const { count } = await prisma.dealMilestone.updateMany({
    where: { id: milestoneId, dealId },
    data,
  });
  if (count === 0) throw new DomainError("Milestone not found", 404);

  await recomputeStatus(dealId);
  return getDeal(dealId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentInput {
  kind: DealPaymentKind;
  amountPaise: number;
  fromLabel: string;
  toLabel: string;
  /** IST calendar date; null = planned. Stored as IST noon — see the file header. */
  paidAt?: string | null;
  txnRef?: string | null;
}

async function assertDeal(dealId: string): Promise<void> {
  const exists = await prisma.deal.count({ where: { id: dealId } });
  if (!exists) throw new DomainError("Deal not found", 404);
}

export async function addPayment(dealId: string, input: PaymentInput): Promise<DealDetailDto> {
  await assertDeal(dealId);
  assertNoFullPan(input, "payment");
  await prisma.dealPayment.create({
    data: {
      dealId,
      kind: input.kind,
      amountPaise: BigInt(input.amountPaise),
      fromLabel: input.fromLabel,
      toLabel: input.toLabel,
      paidAt: input.paidAt ? istNoon(input.paidAt) : null,
      txnRef: input.txnRef?.trim() || null,
    },
  });
  await recomputeStatus(dealId);
  return getDeal(dealId);
}

export async function updatePayment(
  dealId: string,
  paymentId: string,
  input: Partial<PaymentInput>,
): Promise<DealDetailDto> {
  assertNoFullPan(input, "payment");
  const data: Prisma.DealPaymentUpdateManyMutationInput = {};
  if (input.kind) data.kind = input.kind;
  if (input.amountPaise !== undefined) data.amountPaise = BigInt(input.amountPaise);
  if (input.fromLabel !== undefined) data.fromLabel = input.fromLabel;
  if (input.toLabel !== undefined) data.toLabel = input.toLabel;
  if (input.paidAt !== undefined) data.paidAt = input.paidAt ? istNoon(input.paidAt) : null;
  if (input.txnRef !== undefined) data.txnRef = input.txnRef?.trim() || null;

  const { count } = await prisma.dealPayment.updateMany({ where: { id: paymentId, dealId }, data });
  if (count === 0) throw new DomainError("Payment not found", 404);
  await recomputeStatus(dealId);
  return getDeal(dealId);
}

export async function deletePayment(dealId: string, paymentId: string): Promise<DealDetailDto> {
  const { count } = await prisma.dealPayment.deleteMany({ where: { id: paymentId, dealId } });
  if (count === 0) throw new DomainError("Payment not found", 404);
  await recomputeStatus(dealId);
  return getDeal(dealId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderOptions {
  final: boolean;
  /** Keyed by party name. Rendered into the returned HTML only; never stored. */
  fullPans?: Record<string, string>;
}

export interface RenderResult {
  document: DealDocumentSummaryDto;
  /** With full PANs when they were supplied; otherwise exactly what was stored. */
  html: string;
  issues: ConsistencyIssue[];
}

const DOCUMENT_ATTEMPTS = 3;

function renderOrRefuse(
  kind: DealDocumentKind,
  ctx: Parameters<typeof renderDealDocument>[1],
) {
  try {
    return renderDealDocument(kind, ctx);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const reason = err instanceof Error ? err.message : "unknown error";
    throw new DomainError(`Could not render the ${DOCUMENT_LABEL[kind]}: ${reason}`, 422);
  }
}

/**
 * Renders one document version and stores it.
 *
 * The checker sees the requested document plus the MOU and LOU (rules 9 and 10 compare them),
 * rendered exactly as the curator will receive them — with full PANs when supplied, so a final
 * document is judged on what will actually be signed. A final version of *any* kind is refused
 * while the checker reports an error.
 *
 * What is stored is always the masked render (handover §7): full PANs reach the response once
 * and are never written. The stored version is what `GET …/documents/[docId]` serves.
 */
export async function renderDocument(
  dealId: string,
  kind: DealDocumentKind,
  options: RenderOptions,
  adminId: string | null,
): Promise<RenderResult> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, reference: true, sheet: true, payments: { orderBy: paymentOrder } },
  });
  if (!deal) throw new DomainError("Deal not found", 404);

  const parsed = dealSheetSchema.safeParse(deal.sheet);
  if (!parsed.success) {
    throw new DomainError(
      `Complete the deal sheet before rendering documents: ${firstSheetIssue(deal.sheet)}`,
      422,
    );
  }
  const sheet = parsed.data;
  const ledger = toLedger(deal.payments);
  const derived = deriveSheet(sheet, ledger);
  const base = {
    reference: deal.reference,
    sheet,
    payments: ledger,
    derived,
    final: options.final,
    generatedOn: istDateOf(new Date()),
  };
  const hasFullPans = Boolean(options.fullPans && Object.keys(options.fullPans).length);

  const asSigned = renderOrRefuse(kind, { ...base, fullPans: options.fullPans });
  const stored = hasFullPans ? renderOrRefuse(kind, base) : asSigned;

  const documents: DocumentText[] = [{ kind, text: asSigned.text }];
  for (const other of ["MOU", "LOU"] as const) {
    if (other === kind) continue;
    documents.push({
      kind: other,
      text: renderOrRefuse(other, { ...base, fullPans: options.fullPans }).text,
    });
  }

  const issues = checkDealConsistency({ sheet, payments: ledger, documents });
  const errors = issues.filter((i) => i.severity === "error").length;
  if (options.final && errors > 0) {
    throw new DomainError(
      `Fix ${errors} consistency error${errors === 1 ? "" : "s"} before marking the ${DOCUMENT_LABEL[kind]} final`,
      422,
    );
  }

  const sheetHash = sheetHashOf(deal.sheet, ledger);

  for (let attempt = 1; ; attempt += 1) {
    const latest = await prisma.dealDocument.findFirst({
      where: { dealId, kind },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    try {
      const doc = await prisma.dealDocument.create({
        data: {
          dealId,
          kind,
          version: (latest?.version ?? 0) + 1,
          html: stored.html,
          sheetHash,
          final: options.final,
          createdBy: adminId,
        },
        select: { id: true, kind: true, version: true, final: true, createdAt: true },
      });
      return {
        document: { ...doc, stale: false, createdAt: doc.createdAt.toISOString() },
        html: asSigned.html,
        issues,
      };
    } catch (err) {
      // Two renders of the same kind at once both read version N and both write N+1; the
      // unique index refuses one, which simply takes N+2.
      if (isUniqueViolation(err, "version") && attempt < DOCUMENT_ATTEMPTS) continue;
      throw err;
    }
  }
}

/** The stored (masked) HTML of one version. */
export async function getDocumentHtml(dealId: string, docId: string): Promise<string> {
  const doc = await prisma.dealDocument.findFirst({
    where: { id: docId, dealId },
    select: { html: true },
  });
  if (!doc) throw new DomainError("Document not found", 404);
  return doc.html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction assist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proposes sheet fields from pasted text, against the deal's current sheet. Writes nothing —
 * the curator confirms and saves through `updateSheet()`. The text is passed straight through
 * and never stored or logged here (handover §7).
 */
export async function proposeForDeal(dealId: string, text: string): Promise<ExtractionProposal> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new DomainError("Extraction is not configured", 503);
  }
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { sheet: true } });
  if (!deal) throw new DomainError("Deal not found", 404);

  const current = partialDealSheetSchema.safeParse(deal.sheet);
  try {
    return await proposeSheetFromText(text, current.success ? current.data : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/not configured/i.test(message)) throw new DomainError("Extraction is not configured", 503);
    // lib/deal-extract.ts promises its messages are its own and never carry the text.
    throw new DomainError(message || "The model could not read that text", 502);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads → DTOs
// ─────────────────────────────────────────────────────────────────────────────

function daysLeftUntil(deadlineAt: Date | null, now: Date): number | null {
  return deadlineAt ? daysBetween(istDateOf(now), istDateOf(deadlineAt)) : null;
}

function isOpen(m: { status: MilestoneStatus }): boolean {
  return !CLOSED_MILESTONE.includes(m.status);
}

function isOverdue(m: { status: MilestoneStatus; dueAt: Date | null }, now: Date): boolean {
  return isOpen(m) && m.dueAt !== null && m.dueAt.getTime() < now.getTime();
}

/** AT_RISK first, then by deadline (soonest first, undated last). */
export async function listDeals(now: Date = new Date()): Promise<DealListItemDto[]> {
  const deals = await prisma.deal.findMany({
    select: {
      id: true,
      reference: true,
      playbook: true,
      status: true,
      propertyLabel: true,
      considerationPaise: true,
      deadlineAt: true,
      updatedAt: true,
      milestones: { select: { status: true, dueAt: true } },
    },
  });

  return deals
    .map(
      (d): DealListItemDto => ({
        id: d.id,
        reference: d.reference,
        playbook: d.playbook,
        status: d.status,
        propertyLabel: d.propertyLabel,
        considerationPaise: Number(d.considerationPaise),
        deadlineAt: d.deadlineAt?.toISOString() ?? null,
        daysLeft: daysLeftUntil(d.deadlineAt, now),
        openMilestones: d.milestones.filter(isOpen).length,
        overdueMilestones: d.milestones.filter((m) => isOverdue(m, now)).length,
        updatedAt: d.updatedAt.toISOString(),
      }),
    )
    .sort((a, b) => {
      const risk = Number(b.status === "AT_RISK") - Number(a.status === "AT_RISK");
      if (risk) return risk;
      if (a.deadlineAt === b.deadlineAt) return 0;
      if (a.deadlineAt === null) return 1;
      if (b.deadlineAt === null) return -1;
      return a.deadlineAt < b.deadlineAt ? -1 : 1;
    });
}

export async function getDeal(dealId: string, now: Date = new Date()): Promise<DealDetailDto> {
  const d = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      parties: { orderBy: [{ role: "asc" }, { sortOrder: "asc" }] },
      milestones: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: paymentOrder },
      documents: {
        orderBy: [{ kind: "asc" }, { version: "desc" }],
        select: { id: true, kind: true, version: true, final: true, sheetHash: true, createdAt: true },
      },
    },
  });
  if (!d) throw new DomainError("Deal not found", 404);

  const ledger = toLedger(d.payments);
  const parsed = dealSheetSchema.safeParse(d.sheet);
  const sheet = parsed.success ? parsed.data : null;
  const currentHash = sheetHashOf(d.sheet, ledger);

  let ledgerSummary: LedgerSummaryDto | null = null;
  let issues: ConsistencyIssue[] = [];
  if (sheet) {
    const consideration = sheet.considerationPaise;
    // A loan disbursal and its two legs — the seller's loan payoff and the balance to the
    // sellers — are one sum of money recorded from both ends. Once either leg is on the ledger
    // the legs are the truer record, so the disbursal row stops counting toward consideration;
    // counting all three would show a deal as over-paid by the size of the loan.
    const hasLegs = ledger.some((p) => p.kind === "SELLER_LOAN_PAYOFF" || p.kind === "BALANCE");
    const counted = ledger.filter((p) => !(hasLegs && p.kind === "LOAN_DISBURSAL"));
    const paid = counted.filter((p) => p.paidAt !== null).reduce((s, p) => s + p.amountPaise, 0);
    const planned = counted.filter((p) => p.paidAt === null).reduce((s, p) => s + p.amountPaise, 0);
    ledgerSummary = {
      considerationPaise: consideration,
      paidPaise: paid,
      plannedPaise: planned,
      unplannedPaise: consideration - paid - planned,
      outstandingPaise: consideration - paid,
      derived: deriveSheet(sheet, ledger),
    };
    issues = checkDealConsistency({ sheet, payments: ledger });
  }

  const parties: DealPartyDto[] = d.parties.map((p) => ({
    id: p.id,
    role: p.role,
    name: p.name,
    email: p.email,
    phone: p.phone,
    shareBps: p.shareBps,
    panLast4: p.panLast4,
  }));
  const milestones: DealMilestoneDto[] = d.milestones.map((m) => ({
    id: m.id,
    key: m.key,
    label: m.label,
    ownerRole: m.ownerRole,
    status: m.status,
    dueAt: m.dueAt?.toISOString() ?? null,
    doneAt: m.doneAt?.toISOString() ?? null,
    notes: m.notes,
    sortOrder: m.sortOrder,
  }));
  const payments: DealPaymentDto[] = d.payments.map((p) => ({
    id: p.id,
    kind: p.kind,
    amountPaise: Number(p.amountPaise),
    fromLabel: p.fromLabel,
    toLabel: p.toLabel,
    paidAt: p.paidAt?.toISOString() ?? null,
    txnRef: p.txnRef,
  }));
  const documents: DealDocumentSummaryDto[] = d.documents.map((doc) => ({
    id: doc.id,
    kind: doc.kind,
    version: doc.version,
    final: doc.final,
    stale: doc.sheetHash !== currentHash,
    createdAt: doc.createdAt.toISOString(),
  }));

  return {
    id: d.id,
    reference: d.reference,
    playbook: d.playbook,
    status: d.status,
    propertyLabel: d.propertyLabel,
    considerationPaise: Number(d.considerationPaise),
    deadlineAt: d.deadlineAt?.toISOString() ?? null,
    daysLeft: daysLeftUntil(d.deadlineAt, now),
    updatedAt: d.updatedAt.toISOString(),
    enquiryId: d.enquiryId,
    propertyId: d.propertyId,
    sheet,
    rawSheet: d.sheet,
    mouSignedAt: d.mouSignedAt?.toISOString() ?? null,
    closedAt: d.closedAt?.toISOString() ?? null,
    parties,
    milestones,
    payments,
    documents,
    ledger: ledgerSummary,
    issues,
    createdAt: d.createdAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Party update — "where your deal stands"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emails every seller and buyer who has an address, one message each (no party sees another's
 * address). Money stays out of it except the next planned payment, which is the one figure a
 * party needs to act on. `notify()` never throws, so a delivery problem is a FAILED row in the
 * outbox, not an error here.
 */
export async function sendPartyUpdate(
  dealId: string,
  adminId: string | null,
  now: Date = new Date(),
): Promise<{ notified: number; recipients: string[] }> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      reference: true,
      propertyLabel: true,
      deadlineAt: true,
      parties: { where: { role: { in: ["SELLER", "BUYER"] } }, select: { name: true, email: true } },
      milestones: { orderBy: { sortOrder: "asc" }, select: { label: true, status: true, dueAt: true } },
      payments: { where: { paidAt: null }, orderBy: paymentOrder, take: 1 },
    },
  });
  if (!deal) throw new DomainError("Deal not found", 404);

  const recipients = deal.parties.filter((p): p is { name: string; email: string } => Boolean(p.email));
  if (!recipients.length) {
    throw new DomainError("No seller or buyer has an email address on the sheet", 422);
  }

  const done = deal.milestones.filter((m) => m.status === "DONE");
  const open = deal.milestones
    .filter(isOpen)
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))
    .slice(0, 3);
  const nextPayment = deal.payments[0];
  const daysLeft = daysLeftUntil(deal.deadlineAt, now);
  const shortDate = (at: Date) => formatShortDate(istDateOf(at));

  const lines = [
    `Deal reference: ${deal.reference}`,
    `Home: ${deal.propertyLabel}`,
    deal.deadlineAt
      ? `Deadline: ${shortDate(deal.deadlineAt)}${daysLeft !== null && daysLeft >= 0 ? ` (${daysLeft} days from today)` : ""}`
      : "Deadline: set once the MOU is signed",
    "",
    `Done so far (${done.length} of ${deal.milestones.length}):`,
    ...(done.length ? done.map((m) => `  ✓ ${m.label}`) : ["  Nothing yet."]),
    "",
    "Next:",
    ...(open.length
      ? open.map((m) => `  • ${m.label}${m.dueAt ? ` — by ${shortDate(m.dueAt)}` : ""}`)
      : ["  Nothing open."]),
    nextPayment
      ? `\nNext payment: ${PAYMENT_LABEL[nextPayment.kind]} of ${formatRupees(Number(nextPayment.amountPaise))}, ${nextPayment.fromLabel} to ${nextPayment.toLabel}.`
      : null,
    "",
    "Reply to this email with any question and the Nivasa team will come back to you.",
  ].filter((line): line is string => line !== null);

  for (const party of recipients) {
    await notify({
      type: "DEAL_PARTY_UPDATE",
      recipient: party.email,
      subject: `Where your deal stands — ${deal.propertyLabel} (${deal.reference})`,
      body: [`Hello ${party.name},`, "", ...lines].join("\n"),
      subjectId: deal.id,
    });
  }

  if (adminId) {
    await prisma.deal.update({ where: { id: dealId }, data: { handledBy: adminId } });
  }
  return { notified: recipients.length, recipients: recipients.map((r) => r.email) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The daily cron
// ─────────────────────────────────────────────────────────────────────────────

export interface DealCronRun {
  /** Live deals whose status was recomputed. */
  dealsChecked: number;
  /** Deals that became AT_RISK on this run (one DEAL_AT_RISK email each). */
  newlyAtRisk: number;
  /** Milestones claimed and included in the digest. */
  milestonesNotified: number;
  /** 0 or 1 — the run sends at most one digest. */
  digests: number;
}

/**
 * The 09:00 IST team digest.
 *
 * 1. Recompute every live deal's status; a deal that *became* AT_RISK on this run gets one
 *    DEAL_AT_RISK email. The status write is conditional (`recomputeStatus`), so two overlapping
 *    runs cannot both see the transition.
 * 2. Collect open milestones on live deals due by the end of tomorrow (IST) that have not been in
 *    a digest today, and **claim** each one by stamping `lastNotifiedAt` with an `updateMany`
 *    conditional on the value just read. A concurrent run that read the same row finds the
 *    stamp moved and claims nothing — the claim-then-send ordering `lib/reminders.ts` describes,
 *    tightened so the stamp is the lock.
 * 3. One digest to the team covering exactly the claimed milestones, grouped by deal with
 *    overdue first. The stamp stands even if delivery fails: a FAILED row in /dashboard/outbox
 *    beats a second copy of the same digest, the same trade `Viewing.reminderSentAt` makes.
 */
export async function runDealMilestoneCron(now: Date = new Date()): Promise<DealCronRun> {
  const live = await prisma.deal.findMany({
    where: { status: { in: LIVE_DEAL } },
    select: { id: true },
  });

  let newlyAtRisk = 0;
  for (const { id } of live) {
    const result = await recomputeStatus(id, now);
    if (result.changed && result.after === "AT_RISK") {
      newlyAtRisk += 1;
      await sendAtRiskAlert(id, now);
    }
  }

  const today = istDateOf(now);
  const startOfToday = istStartOfDay(today);
  const endOfTomorrow = istEndOfDay(addDays(today, 1));

  const candidates = await prisma.dealMilestone.findMany({
    where: {
      status: { notIn: CLOSED_MILESTONE },
      dueAt: { not: null, lte: endOfTomorrow },
      OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: startOfToday } }],
      deal: { status: { in: LIVE_DEAL } },
    },
    select: {
      id: true,
      label: true,
      ownerRole: true,
      dueAt: true,
      lastNotifiedAt: true,
      deal: { select: { id: true, reference: true, propertyLabel: true, deadlineAt: true } },
    },
  });

  const claimed: typeof candidates = [];
  for (const m of candidates) {
    const { count } = await prisma.dealMilestone.updateMany({
      where: { id: m.id, lastNotifiedAt: m.lastNotifiedAt },
      data: { lastNotifiedAt: now },
    });
    if (count === 1) claimed.push(m);
  }

  if (claimed.length) await sendMilestoneDigest(claimed, now);

  return {
    dealsChecked: live.length,
    newlyAtRisk,
    milestonesNotified: claimed.length,
    digests: claimed.length ? 1 : 0,
  };
}

type DigestMilestone = {
  label: string;
  ownerRole: DealPartyRole;
  dueAt: Date | null;
  deal: { id: string; reference: string; propertyLabel: string; deadlineAt: Date | null };
};

async function sendMilestoneDigest(milestones: DigestMilestone[], now: Date): Promise<void> {
  const byDeal = new Map<string, DigestMilestone[]>();
  for (const m of milestones) {
    const list = byDeal.get(m.deal.id) ?? [];
    list.push(m);
    byDeal.set(m.deal.id, list);
  }

  const groups = [...byDeal.values()].map((list) => {
    list.sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
    return { deal: list[0].deal, list, overdue: list.filter((m) => isOverdue({ status: "PENDING", dueAt: m.dueAt }, now)).length };
  });
  // Deals with something overdue first, then the nearest deadline.
  groups.sort(
    (a, b) =>
      Number(b.overdue > 0) - Number(a.overdue > 0) ||
      (a.deal.deadlineAt?.getTime() ?? Infinity) - (b.deal.deadlineAt?.getTime() ?? Infinity),
  );

  const overdueTotal = groups.reduce((s, g) => s + g.overdue, 0);
  const shortDate = (at: Date) => formatShortDate(istDateOf(at));

  const body: string[] = [
    `Close milestones due by tomorrow or overdue — ${formatShortDate(istDateOf(now))}`,
    "",
  ];
  for (const { deal, list } of groups) {
    const left = daysLeftUntil(deal.deadlineAt, now);
    body.push(
      `${deal.reference} · ${deal.propertyLabel}` +
        (deal.deadlineAt ? ` — deadline ${shortDate(deal.deadlineAt)}${left !== null ? ` (${left} days)` : ""}` : ""),
    );
    for (const m of list) {
      const overdue = m.dueAt !== null && m.dueAt.getTime() < now.getTime();
      const when = m.dueAt ? shortDate(m.dueAt) : "";
      body.push(
        `  ${overdue ? `OVERDUE (was due ${when})` : `Due ${when}`} — ${m.label} [${ROLE_LABEL[m.ownerRole]}]`,
      );
    }
    body.push(`  ${dashboardLink(`/dashboard/deals/${deal.id}`)}`, "");
  }

  await notify({
    type: "DEAL_MILESTONE_DUE",
    recipient: teamInbox(),
    subject:
      `Close: ${milestones.length} milestone${milestones.length === 1 ? "" : "s"} due` +
      (overdueTotal ? `, ${overdueTotal} overdue` : ""),
    body: body.join("\n").trimEnd(),
    // One digest can span deals; a single-deal digest still links back to its deal.
    subjectId: groups.length === 1 ? groups[0].deal.id : null,
  });
}

async function sendAtRiskAlert(dealId: string, now: Date): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      reference: true,
      propertyLabel: true,
      deadlineAt: true,
      milestones: {
        where: { status: { notIn: CLOSED_MILESTONE } },
        orderBy: { sortOrder: "asc" },
        select: { label: true, status: true, dueAt: true, ownerRole: true },
      },
    },
  });
  if (!deal) return;

  const blocked = deal.milestones.filter((m) => m.status === "BLOCKED");
  const overdue = deal.milestones.filter((m) => isOverdue(m, now) && m.status !== "BLOCKED");
  const left = daysLeftUntil(deal.deadlineAt, now);
  const shortDate = (at: Date) => formatShortDate(istDateOf(at));

  await notify({
    type: "DEAL_AT_RISK",
    recipient: teamInbox(),
    subject: `At risk: ${deal.propertyLabel} (${deal.reference})`,
    body: [
      `${deal.reference} · ${deal.propertyLabel} is now at risk.`,
      deal.deadlineAt
        ? `Deadline: ${shortDate(deal.deadlineAt)}${left !== null ? ` (${left} days)` : ""}`
        : null,
      "",
      ...blocked.map((m) => `  BLOCKED — ${m.label} [${ROLE_LABEL[m.ownerRole]}]`),
      ...overdue.map(
        (m) => `  OVERDUE (was due ${m.dueAt ? shortDate(m.dueAt) : "?"}) — ${m.label} [${ROLE_LABEL[m.ownerRole]}]`,
      ),
      "",
      dashboardLink(`/dashboard/deals/${deal.id}`),
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    subjectId: deal.id,
  });
}
