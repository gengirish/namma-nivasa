import { addDays, deriveSheet, formatLongDate, formatRupees, tdsFor } from "@/lib/deal-sheet";
import type { DealSheet, LedgerPayment } from "@/lib/deal-sheet";
import type { ConsistencyInput, ConsistencyIssue, DocumentText } from "@/lib/deal-types";

/**
 * The consistency checker: the code that decides whether a Close document may be marked final.
 *
 * Every rule here is a mistake that reached a real MOU (handover §6, seeded from the A-1042
 * drafts) and was caught by a party rather than by whoever drafted it. Five drafts went round
 * before the dates, the amounts and the association name all agreed with one another; this file
 * exists so the sixth deal does not need five.
 *
 * **The checker decides, not the model.** Same rule as `autoSendRefusal()` in
 * `lib/reply-agent.ts`: extraction may *propose* a sheet, but whether a document is consistent
 * enough to sign is settled here, in ordinary code that reads the same way every time. A model
 * asked "does this MOU contradict itself" answers differently on a re-run, and a signed
 * contradiction costs someone a penalty clause.
 *
 * **It is pure** — no prisma, no clock, no `server-only` — so the Playwright spec can import it
 * directly and pin each rule against a hand-written document, and so the dashboard, the render
 * route and a future cron all get the same answer from the same input.
 *
 * Errors block a final MOU; warnings are shown and allowed. Each issue carries a stable `code`
 * that tests assert on — rename a message freely, never a code.
 *
 * The text rules scan rendered *plain text*, deliberately loosely: they look for the phrases the
 * renderer writes, plus the obvious hand-typed variants, rather than parsing legal prose. A rule
 * that cannot find what it scans for stays silent rather than guessing, except rule 4, where
 * absence is the error.
 */

export function checkDealConsistency(input: ConsistencyInput): ConsistencyIssue[] {
  const { sheet, payments } = input;
  const documents = input.documents ?? [];

  return [
    ...executionAfterPayments(sheet, payments),
    ...deadlineDates(sheet, documents),
    ...noticeEmails(sheet),
    ...possessionInBody(documents),
    ...amountsReconcile(sheet, payments, documents),
    ...tdsSplit(sheet, payments),
    ...terminology(documents),
    ...noBlanks(documents),
    ...associationName(sheet, documents),
    ...duesAgree(documents),
    ...bankDelayPenalty(sheet),
  ];
}

/** True when there is nothing in the list that blocks a final render. */
export function hasBlockingIssues(issues: ConsistencyIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — execution date vs the payments it acknowledges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The MOU recites the token and booking as already received, so it cannot be dated before they
 * were paid. Only TOKEN and BOOKING count: self-funding, the loan and the balance are paid *after*
 * signing by design, and recording them as paid must not turn a correct MOU into an error.
 */
const ACKNOWLEDGED_KINDS = new Set<LedgerPayment["kind"]>(["TOKEN", "BOOKING"]);

function executionAfterPayments(sheet: DealSheet, payments: LedgerPayment[]): ConsistencyIssue[] {
  if (!sheet.executionDate) return [];
  const execution = sheet.executionDate;

  // ISO dates compare correctly as strings.
  const late = payments
    .filter((p) => ACKNOWLEDGED_KINDS.has(p.kind) && p.paidAt && p.paidAt > execution)
    .sort((a, b) => (a.paidAt! < b.paidAt! ? 1 : -1));
  if (late.length === 0) return [];

  const latest = late[0];
  return [
    {
      rule: 1,
      severity: "error",
      code: "EXECUTION_BEFORE_PAYMENT",
      message: `The MOU is dated ${formatLongDate(execution)}, but it acknowledges a ${latest.kind.toLowerCase()} payment of ${formatRupees(latest.amountPaise)} made on ${formatLongDate(latest.paidAt!)}. Date it on or after the last payment it recites.`,
      where: "executionDate",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — every "on or before" date is the deadline or the extended deadline
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const LONG_DATE =
  "(\\d{1,2})(?:st|nd|rd|th)?\\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?,?\\s+(\\d{4})";
const SHORT_DATE = "(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})";

/** "on or before 15 December 2026" / "on or before 15/12/2026" / "on or before 15 Dec 2026". */
const ON_OR_BEFORE = new RegExp(`on\\s+or\\s+before\\s+(?:the\\s+)?(?:${LONG_DATE}|${SHORT_DATE})`, "gi");

function isoOf(day: string, month: number, year: string): string | null {
  const d = Number(day);
  if (!month || month > 12 || d < 1 || d > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function deadlineDates(sheet: DealSheet, documents: DocumentText[]): ConsistencyIssue[] {
  if (!sheet.executionDate || documents.length === 0) return [];
  const deadline = addDays(sheet.executionDate, sheet.deadlineDays);
  const extended = addDays(deadline, sheet.extensionDays);

  // One issue per wrong *date*, not per sentence: a date copied into three clauses is one
  // mistake to fix, and three identical errors read like three.
  const wrong = new Map<string, string>(); // iso → first document it appeared in
  for (const doc of documents) {
    for (const m of doc.text.matchAll(ON_OR_BEFORE)) {
      const iso = m[1]
        ? isoOf(m[1], MONTH_INDEX[m[2].slice(0, 3).toLowerCase()], m[3])
        : isoOf(m[4], Number(m[5]), m[6]);
      if (!iso || iso === deadline || iso === extended) continue;
      if (!wrong.has(iso)) wrong.set(iso, doc.kind);
    }
  }

  return [...wrong].map(([iso, kind]) => ({
    rule: 2,
    severity: "error" as const,
    code: "DEADLINE_DATE_MISMATCH",
    message: `"On or before ${formatLongDate(iso)}" does not match the deadline: ${formatLongDate(sheet.executionDate!)} + ${sheet.deadlineDays} days is ${formatLongDate(deadline)} (${formatLongDate(extended)} with the ${sheet.extensionDays}-day extension).`,
    where: kind,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 — the notices clause relies on email, so every party has one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checked against the sheet whether or not documents are supplied. The notices clause is a fixed
 * part of the MOU template and it names every seller and the buyer by email, so a party without
 * one is a notices clause pointing at nobody — the A-1042 draft shipped exactly that. Searching
 * the text for a notices heading would only make the rule easier to miss on a draft that has not
 * been rendered yet. Banks are not parties to the MOU's notices, so they are not checked here.
 */
function noticeEmails(sheet: DealSheet): ConsistencyIssue[] {
  const parties = [
    ...sheet.sellers.map((s, i) => ({ party: s, where: `sellers.${i}.email`, role: "Seller" })),
    { party: sheet.buyer, where: "buyer.email", role: "Buyer" },
  ];

  return parties
    .filter(({ party }) => !party.email?.trim())
    .map(({ party, where, role }) => ({
      rule: 3,
      severity: "error" as const,
      code: "NOTICE_PARTY_WITHOUT_EMAIL",
      message: `${role} ${party.name} has no email address, but the notices clause serves notice by email.`,
      where,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 4 — possession and utilities in the binding body
// ─────────────────────────────────────────────────────────────────────────────

/** Everything after the first Annexure/Schedule heading is not the binding body. */
function bindingBody(text: string): string {
  const cut = text.search(/^\s*(?:annexure|annex|schedule)\b/im);
  return cut === -1 ? text : text.slice(0, cut);
}

function sentences(text: string): string[] {
  // A full stop followed by whitespace ends a sentence; "Rs." and "No." mid-sentence are
  // tolerated because the rules only ever look for words co-occurring in one.
  return text.split(/(?:\.\s+|\n\s*\n|;\s+)/);
}

function possessionInBody(documents: DocumentText[]): ConsistencyIssue[] {
  const mou = documents.find((d) => d.kind === "MOU");
  if (!mou) return [];
  const body = bindingBody(mou.text);
  const issues: ConsistencyIssue[] = [];

  // The A-1042 draft had possession only in the annexure, which is where it is unenforceable.
  // A bare "at handover" does not count: the utilities clause says that much without ever
  // obliging anyone to hand anything over.
  if (!/\bpossession\b|\bhand(?:ed)?\s*over\s+(?:of\s+)?(?:the\s+)?(?:property|flat|apartment|premises|keys)\b/i.test(body)) {
    issues.push({
      rule: 4,
      severity: "error",
      code: "POSSESSION_NOT_IN_BODY",
      message: "The MOU's binding clauses never mention possession or handover — an annexure does not bind.",
      where: "MOU",
    });
  }

  const utilitiesMove = sentences(body).some(
    (s) =>
      /\b(?:utilit(?:y|ies)|maintenance|electricity|water|BESCOM|BWSSB)\b/i.test(s) &&
      /\b(?:accounts?|connections?|meters?)\b/i.test(s) &&
      /\b(?:buyer|purchaser|assignee)\b/i.test(s),
  );
  if (!utilitiesMove) {
    issues.push({
      rule: 4,
      severity: "error",
      code: "UTILITIES_NOT_TRANSFERRED",
      message: "The MOU's binding clauses do not move the utility and maintenance accounts to the buyer at handover.",
      where: "MOU",
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 5 — amounts reconcile, in the ledger and in the text
// ─────────────────────────────────────────────────────────────────────────────

/** ₹5,00,000 · Rs. 5,00,000 · INR 500000 · ₹5 L · ₹5 lakh · ₹1.16 Cr. */
const RUPEES = /(?:₹|\bRs\.?|\bINR)\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|L|crores?|Cr)?\b/i;

/** Paise for a rupee amount as written, or null if it does not parse. */
export function parseRupees(text: string): number | null {
  const m = text.match(RUPEES);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const multiplier = unit.startsWith("l") ? 1_00_000 : unit.startsWith("c") ? 1_00_00_000 : 1;
  return Math.round(n * multiplier * 100);
}

function amountsReconcile(
  sheet: DealSheet,
  payments: LedgerPayment[],
  documents: DocumentText[],
): ConsistencyIssue[] {
  const derived = deriveSheet(sheet, payments);
  const issues: ConsistencyIssue[] = [];

  if (sheet.loanPaise != null) {
    // An explicit loan is a claim the ledger can be held to.
    const total = derived.ownFundsPaise + sheet.loanPaise + derived.tdsPaise;
    if (total !== sheet.considerationPaise) {
      issues.push({
        rule: 5,
        severity: "error",
        code: "LEDGER_DOES_NOT_RECONCILE",
        message: `Booking + self-funding + loan + TDS comes to ${formatRupees(total)}, but the consideration is ${formatRupees(sheet.considerationPaise)} (off by ${formatRupees(Math.abs(total - sheet.considerationPaise))}).`,
        where: "loanPaise",
      });
    }
  } else if (derived.ownFundsPaise + derived.tdsPaise > sheet.considerationPaise) {
    // With no loan on the sheet `deriveSheet()` closes the gap with one — unless the buyer's own
    // money already overshoots, which it floors to zero and would otherwise hide.
    issues.push({
      rule: 5,
      severity: "error",
      code: "OWN_FUNDS_EXCEED_CONSIDERATION",
      message: `The buyer's own funds (${formatRupees(derived.ownFundsPaise)}) plus TDS (${formatRupees(derived.tdsPaise)}) exceed the consideration of ${formatRupees(sheet.considerationPaise)}.`,
      where: "payments",
    });
  }

  // "Booking amount" is token + booking wherever it is stated. One issue per wrong figure, so
  // ₹4 L in one clause against ₹5 L everywhere else is one thing to fix.
  const wrong = new Map<number, string>();
  for (const doc of documents) {
    for (const m of doc.text.matchAll(/booking\s+amount/gi)) {
      // Only a figure stated *as* the booking amount — the words, a connective, then the amount.
      // "the booking amount and the self-funding of ₹11,00,000" names a different sum.
      const after = m.index! + m[0].length;
      const window = doc.text.slice(after, after + 40);
      if (!/^\s*(?:of|is|was|being|amounting\s+to|[:=(—–-])?\s*(?:₹|Rs\.?|INR)/i.test(window)) continue;
      const stated = parseRupees(window);
      if (stated == null || stated === derived.bookingAmountPaise) continue;
      if (!wrong.has(stated)) wrong.set(stated, doc.kind);
    }
  }
  for (const [stated, kind] of wrong) {
    issues.push({
      rule: 5,
      severity: "error",
      code: "BOOKING_AMOUNT_MISMATCH",
      message: `The booking amount is stated as ${formatRupees(stated)}, but token + booking in the ledger is ${formatRupees(derived.bookingAmountPaise)}.`,
      where: kind,
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 6 — TDS and the sellers' shares
// ─────────────────────────────────────────────────────────────────────────────

function tdsSplit(sheet: DealSheet, payments: LedgerPayment[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  // Shares drive the TDS split per PAN; shares that do not make a whole property split it wrong.
  const totalBps = sheet.sellers.reduce((a, s) => a + s.shareBps, 0);
  if (totalBps !== 10_000) {
    issues.push({
      rule: 6,
      severity: "error",
      code: "SELLER_SHARES_NOT_WHOLE",
      message: `The sellers' shares add up to ${totalBps / 100}%, not 100%, so TDS cannot be split between their PANs.`,
      where: "sellers",
    });
  }

  // Only once TDS is in the ledger is there a recorded figure to disagree with; a plan that has
  // not got that far is not wrong yet.
  const tdsPayments = payments.filter((p) => p.kind === "TDS");
  if (tdsPayments.length > 0) {
    const expected = tdsFor(sheet.considerationPaise, sheet.sellers).tdsPaise;
    const recorded = tdsPayments.reduce((a, p) => a + p.amountPaise, 0);
    if (recorded !== expected) {
      issues.push({
        rule: 6,
        severity: "error",
        code: "TDS_LEDGER_MISMATCH",
        message:
          expected === 0
            ? `The ledger records ${formatRupees(recorded)} of TDS, but a consideration under ₹50 lakh attracts none under Sec 194-IA.`
            : `The ledger records ${formatRupees(recorded)} of TDS; 1% of ${formatRupees(sheet.considerationPaise)} is ${formatRupees(expected)}.`,
        where: "payments",
      });
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 7 — one name per instrument
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Names that mean the same instrument. "MOU" for "Memorandum of Understanding" is a defined
 * abbreviation, not a second name, so it is deliberately absent.
 */
const SYNONYM_GROUPS: { instrument: string; names: string[] }[] = [
  {
    instrument: "the assignment",
    names: ["Assignment Agreement", "Assignment Deed", "Deed of Assignment", "Agreement of Assignment"],
  },
  { instrument: "the sale deed", names: ["Sale Deed", "Conveyance Deed", "Deed of Sale", "Deed of Conveyance"] },
  { instrument: "the builder agreement", names: ["Agreement to Sell", "Agreement for Sale"] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function terminology(documents: DocumentText[]): ConsistencyIssue[] {
  if (documents.length === 0) return [];
  const all = documents.map((d) => d.text).join("\n");

  return SYNONYM_GROUPS.flatMap(({ instrument, names }) => {
    const used = names.filter((n) => new RegExp(`\\b${escapeRegExp(n).replace(/ /g, "\\s+")}\\b`, "i").test(all));
    if (used.length < 2) return [];
    return [
      {
        rule: 7,
        severity: "error" as const,
        code: "INCONSISTENT_TERMINOLOGY",
        message: `${instrument[0].toUpperCase()}${instrument.slice(1)} is called ${used.map((n) => `"${n}"`).join(" and ")}. Use one name throughout.`,
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 8 — no blanks in a document someone will sign
// ─────────────────────────────────────────────────────────────────────────────

/** The renderer writes a missing value as six or more underscores, then an optional hint. */
const BLANK = /_{6,}(?:\s*\[([^\]\n]{1,80})\])?/g;

/** A transaction reference may stay blank until signing day — it does not exist before then. */
const TXN_HINT = /\b(?:transaction|txn|utr)\b/i;

function noBlanks(documents: DocumentText[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const doc of documents) {
    if (doc.kind !== "MOU" && doc.kind !== "LOU") continue;

    const blocking: string[] = [];
    let txnBlanks = 0;
    for (const m of doc.text.matchAll(BLANK)) {
      const hint = m[1]?.trim();
      if (hint && TXN_HINT.test(hint)) txnBlanks += 1;
      else blocking.push(hint || "unlabelled");
    }

    // One issue per document and severity: the list of what is missing is the useful part, and
    // a dozen identical "blank found" lines would bury it.
    if (blocking.length > 0) {
      issues.push({
        rule: 8,
        severity: "error",
        code: "BLANK_IN_DOCUMENT",
        message: `The ${doc.kind} has ${blocking.length} blank${blocking.length === 1 ? "" : "s"} to fill: ${[...new Set(blocking)].join(", ")}.`,
        where: doc.kind,
      });
    }
    if (txnBlanks > 0) {
      issues.push({
        rule: 8,
        severity: "warning",
        code: "BLANK_TRANSACTION_REFERENCE",
        message: `The ${doc.kind} leaves ${txnBlanks} transaction reference${txnBlanks === 1 ? "" : "s"} blank — fine until signing day, not after.`,
        where: doc.kind,
      });
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 9 — the association is this project's
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capitalised words immediately before "owners association" and its variants. Case matters on
 * the name half — it is what separates "Sobha Dream Gardens" from "the" — so the suffix spells
 * out both cases instead of using a flag that would apply to the whole pattern. Words are joined
 * by spaces only, and a full stop ends a word, so a heading or the previous sentence is never
 * read as part of the name.
 */
const ASSOCIATION =
  /((?:[A-Z][\w&'-]*[ \t]+)+)(?:[Aa]partment\s+|[Ff]lat\s+)?(?:[Oo]wners'?|[Rr]esidents'?)\s+(?:[Ww]elfare\s+)?[Aa]ssociation\b/g;

function projectPart(name: string): string {
  return name
    .replace(/^\s*the\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function associationName(sheet: DealSheet, documents: DocumentText[]): ConsistencyIssue[] {
  if (!sheet.associationName || documents.length === 0) return [];
  ASSOCIATION.lastIndex = 0;
  const own = ASSOCIATION.exec(sheet.associationName);
  ASSOCIATION.lastIndex = 0;
  const expected = projectPart(own ? own[1] : sheet.associationName);

  // The A-1042 LOU named another project's association — a copy-paste from the last deal. One
  // issue per foreign name, however many times it was pasted.
  const wrong = new Map<string, string>();
  for (const doc of documents) {
    for (const m of doc.text.matchAll(ASSOCIATION)) {
      const found = projectPart(m[1]);
      if (found === expected || wrong.has(found)) continue;
      wrong.set(found, `${m[0].trim()}|${doc.kind}`);
    }
  }

  return [...wrong.values()].map((v) => {
    const [mention, kind] = v.split("|");
    return {
      rule: 9,
      severity: "error" as const,
      code: "ASSOCIATION_NAME_MISMATCH",
      message: `The ${kind} names "${mention}", but this deal's association is "${sheet.associationName}".`,
      where: kind,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 10 — the MOU and the LOU agree on who bears past dues
// ─────────────────────────────────────────────────────────────────────────────

type Side = "SELLER" | "BUYER";

const PARTY = "(seller(?:s|\\(s\\))?|vendors?|assignors?|buyer|purchaser|assignee)";
const BORNE_BY = new RegExp(`borne\\s+by\\s+the\\s+${PARTY}`, "i");
const SHALL_BEAR = new RegExp(`${PARTY}\\s+shall\\s+(?:indemnify|bear|pay|clear|settle)`, "i");

function sideOf(word: string): Side {
  return /^(?:buyer|purchaser|assignee)/i.test(word) ? "BUYER" : "SELLER";
}

/** Who a document makes liable for dues that accrued before transfer, if it says. */
function duesBearer(text: string): Side | null {
  for (const s of sentences(text)) {
    if (!/\bdues\b/i.test(s) || !/\b(?:prior\s+to|before)\b/i.test(s)) continue;
    const m = s.match(BORNE_BY) ?? s.match(SHALL_BEAR);
    if (m) return sideOf(m[1]);
  }
  return null;
}

function duesAgree(documents: DocumentText[]): ConsistencyIssue[] {
  const mou = documents.find((d) => d.kind === "MOU");
  const lou = documents.find((d) => d.kind === "LOU");
  if (!mou || !lou) return [];

  const mouSide = duesBearer(mou.text);
  const louSide = duesBearer(lou.text);
  // Silence in one document is not a contradiction; it takes both saying different things.
  if (!mouSide || !louSide || mouSide === louSide) return [];

  const label = (s: Side) => (s === "SELLER" ? "the seller(s)" : "the buyer");
  return [
    {
      rule: 10,
      severity: "error",
      code: "DUES_LIABILITY_CONTRADICTION",
      message: `The MOU puts pre-transfer dues on ${label(mouSide)}, but the LOU puts them on ${label(louSide)}.`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 11 — a penalty without a bank-delay extension (warning)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A warning, not an error: the parties may knowingly accept the risk. But the A-1042 seller
 * carried a ₹3 L penalty for a deadline the seller's bank controlled, with the extension left to
 * "mutual agreement" — which is to say, to the other side's goodwill.
 */
function bankDelayPenalty(sheet: DealSheet): ConsistencyIssue[] {
  if (!sheet.penaltyPaise || sheet.bankDelayAutoExtension) return [];
  const on =
    sheet.penaltyParty === "BOTH" ? "either party" : sheet.penaltyParty === "SELLER" ? "the seller(s)" : "the buyer";
  return [
    {
      rule: 11,
      severity: "warning",
      code: "PENALTY_WITHOUT_BANK_DELAY_EXTENSION",
      message: `A ${formatRupees(sheet.penaltyPaise)} penalty falls on ${on}, with no automatic extension when a bank or the builder causes the delay.`,
      where: "bankDelayAutoExtension",
    },
  ];
}
