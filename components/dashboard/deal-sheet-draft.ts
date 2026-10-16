import type { PartialDealSheet } from "@/lib/deal-sheet";
import { formatRupees } from "@/lib/deal-sheet";

import { bpsToPercent, paiseToRupees, percentToBps, rupeesToPaise } from "@/components/dashboard/deal-shared";

/**
 * The deal-sheet editor's form state, and the conversions either side of it.
 *
 * The form holds strings — what a curator types — and converts to the sheet's units (paise,
 * basis points) only on save. That is also where the extraction assist lands: a proposed
 * `considerationPaise` is written into `considerationRupees` here, never saved directly, so the
 * curator's Save is the only thing that persists a model's proposal.
 */

export interface PartyDraft {
  name: string;
  email: string;
  phone: string;
  panLast4: string;
}

export interface SellerDraft extends PartyDraft {
  /** Share as a percentage string, "50" or "33.33". Stored as basis points. */
  sharePct: string;
}

export interface BankDraft {
  name: string;
  branch: string;
  email: string;
  loanLast4: string;
}

export interface SheetDraft {
  playbook: string;
  propertyLabel: string;
  builder: string;
  builderAgreementDate: string;
  associationName: string;
  superBuiltUpSqft: string;
  considerationRupees: string;
  loanRupees: string;
  executionDate: string;
  deadlineDays: string;
  extensionDays: string;
  sellers: SellerDraft[];
  buyer: PartyDraft;
  sellerBank: BankDraft;
  buyerBank: BankDraft;
  stampDutyPayer: string;
  transferFeePayer: string;
  pastDuesPayer: string;
  penaltyRupees: string;
  penaltyParty: string;
  lateSelfFundingPenaltyPerDayRupees: string;
  bankDelayAutoExtension: boolean;
  possessionNotes: string;
}

export const blankParty = (): PartyDraft => ({ name: "", email: "", phone: "", panLast4: "" });
export const blankSeller = (): SellerDraft => ({ ...blankParty(), sharePct: "" });
export const blankBank = (): BankDraft => ({ name: "", branch: "", email: "", loanLast4: "" });

/** Sheet keys held in paise, and the rupee field each is edited through. */
const MONEY: Record<string, keyof SheetDraft> = {
  considerationPaise: "considerationRupees",
  loanPaise: "loanRupees",
  penaltyPaise: "penaltyRupees",
  lateSelfFundingPenaltyPerDayPaise: "lateSelfFundingPenaltyPerDayRupees",
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const money = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? paiseToRupees(v) : "");

function partyDraft(v: unknown): PartyDraft {
  const r = rec(v);
  return { name: str(r.name), email: str(r.email), phone: str(r.phone), panLast4: str(r.panLast4) };
}

function bankDraft(v: unknown): BankDraft {
  const r = rec(v);
  return { name: str(r.name), branch: str(r.branch), email: str(r.email), loanLast4: str(r.loanLast4) };
}

/**
 * Reads a stored sheet loosely — a DRAFT deal's sheet may be partial, and a sheet that no longer
 * parses must still open in the editor so it can be fixed.
 */
export function toDraft(
  raw: unknown,
  fallback: { playbook: string; propertyLabel: string; considerationPaise: number },
): SheetDraft {
  const s = rec(raw);
  const sellers = Array.isArray(s.sellers) ? s.sellers : [];
  return {
    playbook: str(s.playbook) || fallback.playbook,
    propertyLabel: str(s.propertyLabel) || fallback.propertyLabel,
    builder: str(s.builder),
    builderAgreementDate: str(s.builderAgreementDate),
    associationName: str(s.associationName),
    superBuiltUpSqft: str(s.superBuiltUpSqft),
    considerationRupees: money(s.considerationPaise) || paiseToRupees(fallback.considerationPaise),
    loanRupees: money(s.loanPaise),
    executionDate: str(s.executionDate),
    deadlineDays: str(s.deadlineDays ?? 60),
    extensionDays: str(s.extensionDays ?? 15),
    sellers: sellers.length
      ? sellers.map((x) => {
          const r = rec(x);
          return {
            ...partyDraft(r),
            sharePct: typeof r.shareBps === "number" ? bpsToPercent(r.shareBps) : "",
          };
        })
      : [blankSeller()],
    buyer: partyDraft(s.buyer),
    sellerBank: bankDraft(s.sellerBank),
    buyerBank: bankDraft(s.buyerBank),
    stampDutyPayer: str(s.stampDutyPayer) || "BUYER",
    transferFeePayer: str(s.transferFeePayer) || "SELLER",
    pastDuesPayer: str(s.pastDuesPayer) || "SELLER",
    penaltyRupees: money(s.penaltyPaise),
    penaltyParty: str(s.penaltyParty) || "SELLER",
    lateSelfFundingPenaltyPerDayRupees: money(s.lateSelfFundingPenaltyPerDayPaise),
    bankDelayAutoExtension: s.bankDelayAutoExtension === true,
    possessionNotes: str(s.possessionNotes),
  };
}

const opt = (v: string): string | null => (v.trim() ? v.trim() : null);

function partyOut(p: PartyDraft) {
  return { name: p.name.trim(), email: opt(p.email), phone: opt(p.phone), panLast4: opt(p.panLast4) };
}

function bankOut(b: BankDraft) {
  if (!b.name.trim() && !b.branch.trim() && !b.email.trim() && !b.loanLast4.trim()) return null;
  return { name: b.name.trim(), branch: opt(b.branch), email: opt(b.email), loanLast4: opt(b.loanLast4) };
}

/**
 * Form state → the sheet JSON the PATCH sends. Unit conversions that fail are reported here,
 * by field, rather than sent as NaN; everything else is the server's `dealSheetSchema` to judge.
 */
export function fromDraft(d: SheetDraft): { sheet: Record<string, unknown> } | { error: string } {
  const paiseOf = (label: string, v: string, required = false): number | null | string => {
    if (!v.trim()) return required ? `${label}: required` : null;
    const p = rupeesToPaise(v);
    return p === null ? `${label}: “${v}” is not an amount in rupees` : p;
  };
  const intOf = (label: string, v: string): number | string =>
    /^\d+$/.test(v.trim()) ? Number(v.trim()) : `${label}: enter a whole number`;

  const consideration = paiseOf("Consideration", d.considerationRupees, true);
  const loan = paiseOf("Loan amount", d.loanRupees);
  const penalty = paiseOf("Penalty", d.penaltyRupees);
  const lateFee = paiseOf("Late self-funding penalty", d.lateSelfFundingPenaltyPerDayRupees);
  const deadlineDays = intOf("Deadline days", d.deadlineDays);
  const extensionDays = intOf("Extension days", d.extensionDays);
  for (const v of [consideration, loan, penalty, lateFee, deadlineDays, extensionDays]) {
    if (typeof v === "string") return { error: v };
  }

  // A blank row is an unfilled form, not a seller: a DRAFT deal must be savable before anyone
  // knows who is selling. Omitted keys are left as stored (the server merges at the top level).
  const isBlank = (p: PartyDraft & { sharePct?: string }) =>
    ![p.name, p.email, p.phone, p.panLast4, p.sharePct ?? ""].some((v) => v.trim());
  const sellers = [];
  for (const [i, s] of d.sellers.entries()) {
    if (isBlank(s)) continue;
    const shareBps = percentToBps(s.sharePct);
    if (shareBps === null) return { error: `Seller ${i + 1}: share must be a percentage, e.g. 50` };
    sellers.push({ ...partyOut(s), shareBps });
  }

  let sqft: number | null = null;
  if (d.superBuiltUpSqft.trim()) {
    sqft = Number(d.superBuiltUpSqft.trim());
    if (!Number.isFinite(sqft)) return { error: "Super built-up area: enter a number" };
  }

  return {
    sheet: {
      playbook: d.playbook,
      propertyLabel: d.propertyLabel.trim(),
      builder: opt(d.builder),
      builderAgreementDate: opt(d.builderAgreementDate),
      associationName: opt(d.associationName),
      superBuiltUpSqft: sqft,
      considerationPaise: consideration,
      loanPaise: loan,
      executionDate: opt(d.executionDate),
      deadlineDays,
      extensionDays,
      ...(sellers.length ? { sellers } : {}),
      ...(isBlank(d.buyer) ? {} : { buyer: partyOut(d.buyer) }),
      sellerBank: bankOut(d.sellerBank),
      buyerBank: bankOut(d.buyerBank),
      stampDutyPayer: d.stampDutyPayer,
      transferFeePayer: d.transferFeePayer,
      pastDuesPayer: d.pastDuesPayer,
      penaltyPaise: penalty,
      penaltyParty: d.penaltyParty,
      lateSelfFundingPenaltyPerDayPaise: lateFee,
      bankDelayAutoExtension: d.bankDelayAutoExtension,
      possessionNotes: opt(d.possessionNotes),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction: proposal leaves ↔ form fields
// ─────────────────────────────────────────────────────────────────────────────

export type LeafKind = "money" | "bps" | "bool" | "plain";

export interface ProposalLeaf {
  /** Dotted sheet path, the same spelling `UncertainField.field` uses: "sellers.1.email". */
  path: string;
  value: unknown;
}

/** Flattens a proposed partial sheet into its leaves, so each can be ticked on its own. */
export function flattenProposal(proposed: PartialDealSheet): ProposalLeaf[] {
  const out: ProposalLeaf[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k);
    } else out.push({ path, value: v });
  };
  walk(proposed, "");
  return out;
}

/** Where a sheet path lives in the form, and in what unit. */
export function draftLocation(path: string): { segs: string[]; kind: LeafKind } {
  const segs = path.split(".");
  const last = segs[segs.length - 1];
  if (segs.length === 1 && MONEY[last]) return { segs: [MONEY[last]], kind: "money" };
  if (last === "shareBps") return { segs: [...segs.slice(0, -1), "sharePct"], kind: "bps" };
  if (last === "bankDelayAutoExtension") return { segs, kind: "bool" };
  return { segs, kind: "plain" };
}

/** The proposed value as the form would hold it. */
export function toFormValue(kind: LeafKind, value: unknown): string | boolean {
  if (kind === "bool") return value === true;
  if (kind === "money") return typeof value === "number" ? paiseToRupees(value) : str(value);
  if (kind === "bps") return typeof value === "number" ? bpsToPercent(value) : str(value);
  return str(value);
}

export function getAt(draft: SheetDraft, segs: string[]): unknown {
  let cur: unknown = draft;
  for (const s of segs) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

/** Immutable set. Writing `sellers.2.*` past the end grows the list with blank sellers. */
export function setAt(draft: SheetDraft, segs: string[], value: unknown): SheetDraft {
  const write = (node: unknown, i: number): unknown => {
    const key = segs[i];
    if (i === segs.length - 1) {
      if (Array.isArray(node)) {
        const next = [...node];
        next[Number(key)] = value;
        return next;
      }
      return { ...(node as object), [key]: value };
    }
    if (Array.isArray(node)) {
      const idx = Number(key);
      const next = [...node];
      while (next.length <= idx) next.push(blankSeller());
      next[idx] = write(next[idx], i + 1);
      return next;
    }
    const obj = (node ?? {}) as Record<string, unknown>;
    return { ...obj, [key]: write(obj[key] ?? (segs[i + 1] && /^\d+$/.test(segs[i + 1]) ? [] : {}), i + 1) };
  };
  return write(draft, 0) as SheetDraft;
}

/** How a leaf reads to a curator: rupees for money, percent for shares. */
export function displayLeaf(kind: LeafKind, formValue: unknown): string {
  if (formValue === undefined || formValue === "" || formValue === null) return "—";
  if (kind === "bool") return formValue === true ? "Yes" : "No";
  if (kind === "money") {
    const p = rupeesToPaise(String(formValue));
    return p === null ? String(formValue) : formatRupees(p);
  }
  if (kind === "bps") return `${formValue}%`;
  return String(formValue);
}

/** Whether applying a leaf would change anything. Money compares as paise, not as text. */
export function sameValue(kind: LeafKind, a: unknown, b: unknown): boolean {
  if (kind === "money" || kind === "bps") {
    const pa = rupeesToPaise(str(a));
    const pb = rupeesToPaise(str(b));
    return pa !== null && pa === pb;
  }
  if (kind === "bool") return Boolean(a) === Boolean(b);
  return str(a).trim().toLowerCase() === str(b).trim().toLowerCase();
}
