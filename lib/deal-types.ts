import type {
  DealDocumentKind,
  DealPartyRole,
  DealPaymentKind,
  DealPlaybook,
  DealStatus,
  MilestoneStatus,
} from "@prisma/client";

import type { DealSheet, DerivedSheet, LedgerPayment, PartialDealSheet } from "@/lib/deal-sheet";

/**
 * Contracts between the Close modules, so each can be built and tested on its own:
 *
 *   lib/deal-consistency.ts  checkDealConsistency(input)      → ConsistencyIssue[]   (pure)
 *   lib/deal-documents.ts    renderDealDocument(kind, ctx)    → RenderedDocument     (pure)
 *   lib/deal-extract.ts      proposeSheetFromText(text, cur)  → ExtractionProposal   (model)
 *   lib/deals.ts             persistence, status, the cron
 *
 * And the DTOs the dashboard reads. Chosen field by field, like lib/dto.ts — nothing in this
 * file is ever served to the public site.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Consistency checker
// ─────────────────────────────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning";

export interface ConsistencyIssue {
  /** Handover §6 rule number, 1–11. */
  rule: number;
  severity: IssueSeverity;
  /** Stable machine code, e.g. "EXECUTION_BEFORE_PAYMENT". Tests assert on this. */
  code: string;
  message: string;
  /** Which document or sheet field, when it is about one place. */
  where?: string;
}

/** Plain text of a rendered document, as the checker scans it. */
export interface DocumentText {
  kind: DealDocumentKind;
  text: string;
}

export interface ConsistencyInput {
  sheet: DealSheet;
  payments: LedgerPayment[];
  /**
   * Rendered document texts to cross-check (rules 2, 4, 5, 7, 8, 9, 10). Optional: with none,
   * only the sheet-and-ledger rules run.
   */
  documents?: DocumentText[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Document rendering
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderContext {
  reference: string;
  sheet: DealSheet;
  payments: LedgerPayment[];
  derived: DerivedSheet;
  /**
   * Full PANs keyed by party name, supplied in the render request and never persisted. Absent
   * → masked as "XXXXXX1234F" from panLast4, or a blank.
   */
  fullPans?: Record<string, string>;
  /** Final renders carry no "draft for review" banner text other than the legal-review one. */
  final: boolean;
  /** IST calendar date the document is dated, YYYY-MM-DD. */
  generatedOn: string;
}

export interface RenderedDocument {
  kind: DealDocumentKind;
  title: string;
  /** Standalone printable HTML document, like lib/brochure.ts. */
  html: string;
  /** The same content as plain text — what the checker scans and an email body carries. */
  text: string;
  /** For the bank emails: the subject line. */
  subject?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction assist
// ─────────────────────────────────────────────────────────────────────────────

export interface UncertainField {
  /** Dotted path into the sheet, e.g. "sellers.1.email". */
  field: string;
  reason: string;
}

export interface ExtractionProposal {
  /** Only fields the text supports. Never written to a deal without a curator confirming. */
  proposed: PartialDealSheet;
  /** Payments the text mentions, proposed for the ledger. */
  payments: LedgerPayment[];
  uncertain: UncertainField[];
  /** One or two sentences for the curator. */
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface DealPartyDto {
  id: string;
  role: DealPartyRole;
  name: string;
  email: string | null;
  phone: string | null;
  shareBps: number | null;
  panLast4: string | null;
}

export interface DealMilestoneDto {
  id: string;
  key: string;
  label: string;
  ownerRole: DealPartyRole;
  status: MilestoneStatus;
  /** ISO instant. */
  dueAt: string | null;
  doneAt: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface DealPaymentDto {
  id: string;
  kind: DealPaymentKind;
  amountPaise: number;
  fromLabel: string;
  toLabel: string;
  /** ISO instant, or null when planned. */
  paidAt: string | null;
  txnRef: string | null;
}

export interface DealDocumentSummaryDto {
  id: string;
  kind: DealDocumentKind;
  version: number;
  final: boolean;
  /** The sheet has changed since this version was rendered. */
  stale: boolean;
  createdAt: string;
}

export interface LedgerSummaryDto {
  considerationPaise: number;
  paidPaise: number;
  plannedPaise: number;
  /** consideration − (paid + planned). Zero when the plan reconciles. */
  unplannedPaise: number;
  outstandingPaise: number;
  derived: DerivedSheet;
}

export interface DealListItemDto {
  id: string;
  reference: string;
  playbook: DealPlaybook;
  status: DealStatus;
  propertyLabel: string;
  considerationPaise: number;
  deadlineAt: string | null;
  /** Whole days until the deadline, negative when past. Null with no deadline. */
  daysLeft: number | null;
  openMilestones: number;
  overdueMilestones: number;
  updatedAt: string;
}

export interface DealDetailDto extends Omit<DealListItemDto, "openMilestones" | "overdueMilestones"> {
  enquiryId: string | null;
  propertyId: string | null;
  /** Null when the stored JSON does not parse — shown as "sheet needs attention". */
  sheet: DealSheet | null;
  /** The raw stored sheet, for a DRAFT deal whose sheet is still partial. */
  rawSheet: unknown;
  mouSignedAt: string | null;
  closedAt: string | null;
  parties: DealPartyDto[];
  milestones: DealMilestoneDto[];
  payments: DealPaymentDto[];
  documents: DealDocumentSummaryDto[];
  ledger: LedgerSummaryDto | null;
  issues: ConsistencyIssue[];
  createdAt: string;
}
