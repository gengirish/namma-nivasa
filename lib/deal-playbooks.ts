import type { DealPartyRole, DealPlaybook } from "@prisma/client";

/**
 * The two Close playbooks, as data. A deal expands its playbook into `DealMilestone` rows once,
 * at creation; after that the rows are the deal's own and a curator may skip or re-date them.
 *
 * Each milestone is anchored to the MOU's execution date or to the deadline, never to "today",
 * so the whole plan moves when the MOU date is set or corrected. With no execution date yet,
 * `dueAt` stays null — a countdown from a guessed date is worse than none.
 *
 * Keys are stable identifiers (the `@@unique([dealId, key])` index rests on them). Rename a
 * label freely; never rename a key.
 */

export type MilestoneAnchor = "MOU" | "DEADLINE";

export interface PlaybookMilestone {
  key: string;
  label: string;
  ownerRole: DealPartyRole;
  anchor: MilestoneAnchor;
  /** Days from the anchor; negative means before it. */
  offsetDays: number;
}

export interface Playbook {
  key: DealPlaybook;
  label: string;
  summary: string;
  milestones: PlaybookMilestone[];
}

const BUILDER_ASSIGNMENT: Playbook = {
  key: "BUILDER_ASSIGNMENT",
  label: "Builder assignment",
  summary:
    "Assign the seller's builder Agreement to Sell to the buyer. Builder approval and a transfer fee; the seller's bank releases the original agreement on payoff.",
  milestones: [
    { key: "token_received", label: "Token received by seller", ownerRole: "BUYER", anchor: "MOU", offsetDays: 0 },
    { key: "mou_signed", label: "MOU signed by all parties", ownerRole: "SELLER", anchor: "MOU", offsetDays: 0 },
    { key: "booking_paid", label: "Booking amount paid", ownerRole: "BUYER", anchor: "MOU", offsetDays: 0 },
    { key: "seller_bank_noc_request", label: "Conditional NOC + List of Documents requested from seller's bank", ownerRole: "SELLER", anchor: "MOU", offsetDays: 1 },
    { key: "seller_bank_lod", label: "List of Documents received from seller's bank", ownerRole: "SELLER_BANK", anchor: "MOU", offsetDays: 7 },
    { key: "seller_bank_noc", label: "Conditional NOC received from seller's bank", ownerRole: "SELLER_BANK", anchor: "MOU", offsetDays: 10 },
    { key: "buyer_loan_sanction", label: "Buyer's home loan sanctioned", ownerRole: "BUYER_BANK", anchor: "MOU", offsetDays: 21 },
    { key: "builder_approval", label: "Builder approves the assignment; transfer fee quoted", ownerRole: "BUILDER", anchor: "MOU", offsetDays: 30 },
    { key: "association_dues_noc", label: "Owners association confirms dues and issues NOC", ownerRole: "ASSOCIATION", anchor: "DEADLINE", offsetDays: -21 },
    { key: "foreclosure_letter", label: "Foreclosure letter from seller's bank", ownerRole: "SELLER_BANK", anchor: "DEADLINE", offsetDays: -14 },
    { key: "self_funding_paid", label: "Buyer's self-funding paid", ownerRole: "BUYER", anchor: "DEADLINE", offsetDays: -3 },
    { key: "loan_disbursal_payoff", label: "Buyer's bank disburses; seller's loan paid off", ownerRole: "BUYER_BANK", anchor: "DEADLINE", offsetDays: -1 },
    { key: "tds_deposited", label: "TDS deposited (Form 26QB) and certificates shared", ownerRole: "BUYER", anchor: "DEADLINE", offsetDays: 0 },
    { key: "assignment_executed", label: "Assignment Agreement executed with the builder", ownerRole: "SELLER", anchor: "DEADLINE", offsetDays: 0 },
    { key: "handover", label: "Possession, keys and utility accounts handed over", ownerRole: "SELLER", anchor: "DEADLINE", offsetDays: 0 },
    { key: "original_documents_released", label: "Seller's bank releases original documents", ownerRole: "SELLER_BANK", anchor: "DEADLINE", offsetDays: 7 },
  ],
};

const REGISTERED_RESALE: Playbook = {
  key: "REGISTERED_RESALE",
  label: "Registered resale",
  summary:
    "A registered sale deed at the sub-registrar. Title and encumbrance checks first; stamp duty and registration on the deed day; khata transfer after.",
  milestones: [
    { key: "token_received", label: "Token received by seller", ownerRole: "BUYER", anchor: "MOU", offsetDays: 0 },
    { key: "mou_signed", label: "MOU / agreement of sale signed", ownerRole: "SELLER", anchor: "MOU", offsetDays: 0 },
    { key: "booking_paid", label: "Booking amount paid", ownerRole: "BUYER", anchor: "MOU", offsetDays: 0 },
    { key: "title_ec_check", label: "Title documents and encumbrance certificate reviewed", ownerRole: "BUYER", anchor: "MOU", offsetDays: 7 },
    { key: "seller_bank_noc_request", label: "NOC + List of Documents requested from seller's bank", ownerRole: "SELLER", anchor: "MOU", offsetDays: 1 },
    { key: "seller_bank_lod", label: "List of Documents received from seller's bank", ownerRole: "SELLER_BANK", anchor: "MOU", offsetDays: 7 },
    { key: "buyer_loan_sanction", label: "Buyer's home loan sanctioned", ownerRole: "BUYER_BANK", anchor: "MOU", offsetDays: 21 },
    { key: "khata_tax_check", label: "Khata and property tax paid up to date", ownerRole: "SELLER", anchor: "DEADLINE", offsetDays: -21 },
    { key: "association_dues_noc", label: "Owners association confirms dues and issues NOC", ownerRole: "ASSOCIATION", anchor: "DEADLINE", offsetDays: -14 },
    { key: "foreclosure_letter", label: "Foreclosure letter from seller's bank", ownerRole: "SELLER_BANK", anchor: "DEADLINE", offsetDays: -14 },
    { key: "stamp_duty_paid", label: "Stamp duty and registration fee paid", ownerRole: "BUYER", anchor: "DEADLINE", offsetDays: -2 },
    { key: "loan_disbursal_payoff", label: "Buyer's bank disburses; seller's loan paid off", ownerRole: "BUYER_BANK", anchor: "DEADLINE", offsetDays: -1 },
    { key: "sale_deed_registered", label: "Sale deed registered at the sub-registrar", ownerRole: "SELLER", anchor: "DEADLINE", offsetDays: 0 },
    { key: "tds_deposited", label: "TDS deposited (Form 26QB) and certificates shared", ownerRole: "BUYER", anchor: "DEADLINE", offsetDays: 0 },
    { key: "handover", label: "Possession, keys and utility accounts handed over", ownerRole: "SELLER", anchor: "DEADLINE", offsetDays: 0 },
    { key: "original_documents_released", label: "Seller's bank releases original documents", ownerRole: "SELLER_BANK", anchor: "DEADLINE", offsetDays: 7 },
    { key: "khata_transfer", label: "Khata transferred to the buyer", ownerRole: "BUYER", anchor: "DEADLINE", offsetDays: 45 },
  ],
};

export const PLAYBOOKS: Record<DealPlaybook, Playbook> = { BUILDER_ASSIGNMENT, REGISTERED_RESALE };

/** The IST calendar date a milestone falls due, or null while its anchor is unknown. */
export function milestoneDueDate(
  m: Pick<PlaybookMilestone, "anchor" | "offsetDays">,
  anchors: { executionDate: string | null; deadlineDate: string | null },
): string | null {
  const base = m.anchor === "MOU" ? anchors.executionDate : anchors.deadlineDate;
  if (!base) return null;
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + m.offsetDays);
  return d.toISOString().slice(0, 10);
}
