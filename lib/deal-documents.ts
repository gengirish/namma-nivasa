import type { DealDocumentKind } from "@prisma/client";

import {
  ISO_DATE,
  formatLongDate,
  formatRupees,
  type DealSheet,
  type LedgerPayment,
  type LedgerPaymentKind,
} from "@/lib/deal-sheet";
import type { RenderContext, RenderedDocument } from "@/lib/deal-types";

/**
 * Nivasa Close documents: the MOU, the LOU to the owners association, and three emails to the
 * seller's bank — rendered deterministically from the deal sheet and the payment ledger.
 *
 * Pure. No I/O, no clock (the date on a document is `ctx.generatedOn`), no server-only import, so
 * the dashboard, a route and a Playwright spec can all call it and get byte-identical output.
 *
 * Every A-1042 drafting error (handover §1) is made structural here rather than caught later:
 *
 *   - Each fact is stated by exactly one helper — `bookingAmount()`, `byDeadline()`,
 *     `pastDuesSentence()`, `association()` — so two clauses cannot disagree about it.
 *   - The instrument has one term per playbook (`INSTRUMENT`), never typed into a clause.
 *   - The deadline is `ctx.derived.deadlineDate`, never recomputed here.
 *   - Possession and the utility/maintenance hand-over are numbered clauses in the binding body,
 *     and there is no annexure for them to drift into.
 *   - A missing value renders as a visible blank, `______ [hint]`, which the consistency checker
 *     finds; "undefined", "null" and "NaN" cannot reach the page.
 *
 * Text and HTML are emitted from the same block structure, so the checker scans exactly what a
 * person reads. Every document carries the advocate-review banner whatever `ctx.final` says:
 * legal review of these templates has not happened yet (handover §9.1).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const DOCUMENT_KINDS: Record<DealDocumentKind, { label: string; bankEmail: boolean }> = {
  MOU: { label: "Memorandum of Understanding", bankEmail: false },
  LOU: { label: "Letter of Undertaking to the owners association", bankEmail: false },
  BANK_NOC_LOD_REQUEST: { label: "Bank email: conditional NOC and List of Documents", bankEmail: true },
  BANK_FORECLOSURE_REQUEST: { label: "Bank email: foreclosure request", bankEmail: true },
  BANK_FOLLOW_UP: { label: "Bank email: follow-up", bankEmail: true },
};

export const DRAFT_BANNER =
  "DRAFT FOR REVIEW — not to be signed until reviewed by a property advocate";

/** What a missing value looks like. Six underscores, then the hint in brackets. */
export const BLANK_MARK = "______";

/** One term per instrument. Every clause names it through this table, never by hand. */
export const INSTRUMENT: Record<DealSheet["playbook"], { term: string; article: string; act: string }> = {
  BUILDER_ASSIGNMENT: { term: "Assignment Agreement", article: "an", act: "assignment" },
  REGISTERED_RESALE: { term: "Sale Deed", article: "a", act: "sale" },
};

/** The builder's agreement being assigned. Only ever used for BUILDER_ASSIGNMENT. */
const BUILDER_AGREEMENT = "Agreement to Sell";

/** "XXXXXX234F": the last four characters of a PAN, the rest masked. */
export function maskPan(full: string): string {
  const clean = String(full ?? "").replace(/\s+/g, "").toUpperCase();
  return `XXXXXX${clean.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Segments: a run of text, a blank, or emphasis
// ─────────────────────────────────────────────────────────────────────────────

type Seg = string | { blank: string } | { strong: string };
type Segs = Seg[];

const NOT_A_VALUE = /^(?:undefined|null|NaN|Infinity|-Infinity)$/;

function blank(hint: string): Seg {
  return { blank: hint };
}

/** The guard: anything absent or nonsensical becomes a labelled blank, never a stray word. */
function val(v: string | number | null | undefined, hint: string): Seg {
  if (v === null || v === undefined) return blank(hint);
  if (typeof v === "number" && !Number.isFinite(v)) return blank(hint);
  const s = String(v).trim();
  if (!s || NOT_A_VALUE.test(s)) return blank(hint);
  return s;
}

/** Tagged template that builds a segment list; arrays are spliced in. */
function s(strings: TemplateStringsArray, ...vals: (Seg | Segs)[]): Segs {
  const out: Segs = [];
  strings.forEach((str, i) => {
    if (str) out.push(str);
    if (i < vals.length) {
      const v = vals[i];
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    }
  });
  return out;
}

function join(items: Segs[], sep = ", ", last = " and "): Segs {
  const out: Segs = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(i === items.length - 1 ? last : sep);
    out.push(...item);
  });
  return out;
}

const blankText = (hint: string) => `${BLANK_MARK} [${hint}]`;

/** Defence in depth: a stray literal can still never print as "undefined". */
function scrub(text: string): string {
  return text.replace(/\b(?:undefined|null|NaN)\b/g, blankText("missing value"));
}

function segText(seg: Seg | null | undefined): string {
  if (seg === null || seg === undefined) return blankText("missing value");
  if (typeof seg === "string") return scrub(seg);
  if ("blank" in seg) return blankText(seg.blank);
  return scrub(seg.strong);
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const escLines = (text: string) => esc(text).replace(/\n/g, "<br>");

function segHtml(seg: Seg | null | undefined): string {
  if (seg === null || seg === undefined) return `<span class="blank">${esc(blankText("missing value"))}</span>`;
  if (typeof seg === "string") return escLines(scrub(seg));
  if ("blank" in seg) return `<span class="blank">${esc(blankText(seg.blank))}</span>`;
  return `<strong>${escLines(scrub(seg.strong))}</strong>`;
}

const toText = (segs: Segs) => segs.map(segText).join("");
const toHtml = (segs: Segs) => segs.map(segHtml).join("");

// ─────────────────────────────────────────────────────────────────────────────
// Blocks: the document structure both renderers walk
// ─────────────────────────────────────────────────────────────────────────────

type ClausePart = Segs | { list: Segs[] };

type Block =
  | { type: "heading"; text: string }
  | { type: "p"; segs: Segs }
  | { type: "list"; items: Segs[] }
  | { type: "clause"; title: string; parts: ClausePart[] }
  | { type: "signatures"; signers: { name: Seg; role: string }[] };

interface DocSpec {
  kind: DealDocumentKind;
  title: string;
  subtitle?: Segs;
  /** Header lines shown in the HTML only (To / From / Subject on an email). */
  meta?: Segs[];
  subject?: string;
  blocks: Block[];
}

const letter = (i: number) => String.fromCharCode(97 + (i % 26));

function renderTextBlocks(blocks: Block[]): string[] {
  const out: string[] = [];
  let clauseNo = 0;
  for (const b of blocks) {
    if (b.type === "heading") out.push(b.text.toUpperCase());
    else if (b.type === "p") out.push(toText(b.segs));
    else if (b.type === "list") out.push(b.items.map((it, i) => `  (${letter(i)}) ${toText(it)}`).join("\n"));
    else if (b.type === "clause") {
      clauseNo += 1;
      const numbered = b.parts.filter((p) => Array.isArray(p)).length > 1;
      let sub = 0;
      const lines = [`${clauseNo}. ${b.title.toUpperCase()}`];
      for (const part of b.parts) {
        if (Array.isArray(part)) {
          sub += 1;
          lines.push(numbered ? `${clauseNo}.${sub} ${toText(part)}` : toText(part));
        } else {
          lines.push(part.list.map((it, i) => `    (${letter(i)}) ${toText(it)}`).join("\n"));
        }
      }
      out.push(lines.join("\n"));
    } else {
      out.push(
        b.signers
          // Dots, not underscores: a signature line is filled by hand, and the checker reads six
          // underscores as an unfilled value.
          .map((sg) => `Signed: ..............................\n${segText(sg.name)} (${sg.role})`)
          .join("\n\n"),
      );
    }
  }
  return out;
}

function renderHtmlBlocks(blocks: Block[]): string {
  const out: string[] = [];
  let clauseNo = 0;
  for (const b of blocks) {
    if (b.type === "heading") out.push(`<h2>${esc(b.text)}</h2>`);
    else if (b.type === "p") out.push(`<p>${toHtml(b.segs)}</p>`);
    else if (b.type === "list")
      out.push(`<ol type="a">${b.items.map((it) => `<li>${toHtml(it)}</li>`).join("")}</ol>`);
    else if (b.type === "clause") {
      clauseNo += 1;
      const numbered = b.parts.filter((p) => Array.isArray(p)).length > 1;
      let sub = 0;
      const inner = b.parts
        .map((part) => {
          if (!Array.isArray(part))
            return `<ol type="a">${part.list.map((it) => `<li>${toHtml(it)}</li>`).join("")}</ol>`;
          sub += 1;
          return `<p>${numbered ? `<span class="n">${clauseNo}.${sub}</span>` : ""}${toHtml(part)}</p>`;
        })
        .join("");
      out.push(
        `<section class="clause"><h3><span class="n">${clauseNo}.</span>${esc(b.title)}</h3>${inner}</section>`,
      );
    } else {
      out.push(
        `<div class="sigs">${b.signers
          .map((sg) => `<div class="sig"><div class="line"></div><p>${segHtml(sg.name)}<br><span class="role">${esc(sg.role)}</span></p></div>`)
          .join("")}</div>`,
      );
    }
  }
  return out.join("\n");
}

function footerLines(ctx: RenderContext): { line: Segs; status: Segs } {
  return {
    line: s`Deal reference ${val(ctx.reference, "deal reference")} · Generated ${longDate(ctx.generatedOn, "date generated")} · Prepared by Nivasa Close · zero brokerage`,
    status: ctx.final
      ? s`Final — checked ${val(ISO_DATE.test(ctx.generatedOn ?? "") ? ctx.generatedOn : null, "date checked")}`
      : ["Working draft"],
  };
}

const CSS = `@page{size:A4;margin:20mm 18mm;}*{box-sizing:border-box;}
body{margin:0;font-family:"Josefin Sans",system-ui,sans-serif;color:#1C1917;background:#fff;line-height:1.65;font-size:15px;}
.wrap{max-width:760px;margin:0 auto;padding:28px 24px 48px;}
.banner{border:2px solid #9A3412;color:#9A3412;background:#FFF7ED;padding:10px 14px;text-align:center;font-weight:600;letter-spacing:0.04em;font-size:0.85rem;margin:0 0 22px;}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #E4DCD0;padding-bottom:8px;margin-bottom:18px;}
.brand{font-family:"Cinzel",serif;letter-spacing:0.2em;font-weight:700;font-size:1rem;}.brand span{color:#A16207;}
.note{font-size:0.72rem;color:#8a8580;letter-spacing:0.06em;}
.meta{font-size:0.88rem;margin:0 0 18px;}.meta p{margin:2px 0;}
h1{font-family:"Cinzel",serif;font-weight:600;font-size:1.45rem;text-align:center;letter-spacing:0.06em;margin:10px 0 4px;}
.sub{text-align:center;color:#44403C;margin:0 0 22px;}
h2{font-family:"Cinzel",serif;font-weight:600;font-size:0.92rem;letter-spacing:0.14em;text-transform:uppercase;margin:28px 0 8px;border-bottom:1px solid #E4DCD0;padding-bottom:4px;break-after:avoid;}
h3{font-family:"Cinzel",serif;font-weight:600;font-size:0.9rem;letter-spacing:0.08em;text-transform:uppercase;margin:22px 0 6px;break-after:avoid;}
p{margin:6px 0;}ol{margin:6px 0 6px 6px;padding-left:28px;}li{margin:3px 0;}
.n{font-weight:600;margin-right:8px;}
.blank{background:#FEF3C7;border-bottom:1px solid #A16207;padding:0 2px;}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px 32px;margin:28px 0 8px;}
.sig .line{border-top:1px solid #1C1917;margin-top:48px;}.sig p{margin:6px 0 0;}.role{font-size:0.78rem;color:#6b6b6b;letter-spacing:0.06em;}
footer{margin-top:36px;border-top:1px solid #E4DCD0;padding-top:12px;font-size:0.72rem;color:#8a8580;}footer p{margin:2px 0;}
@media print{.banner,.blank{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.sigs{break-inside:avoid;}}`;

function emit(spec: DocSpec, ctx: RenderContext): RenderedDocument {
  const isEmail = DOCUMENT_KINDS[spec.kind].bankEmail;
  const footer = footerLines(ctx);

  const textParts = [DRAFT_BANNER];
  if (!isEmail) {
    textParts.push(spec.title.toUpperCase() + (spec.subtitle ? `\n${toText(spec.subtitle)}` : ""));
  }
  textParts.push(...renderTextBlocks(spec.blocks));
  textParts.push(`--\n${toText(footer.line)}\n${toText(footer.status)}`);
  const text = textParts.join("\n\n") + "\n";

  const meta = spec.meta?.length
    ? `<div class="meta">${spec.meta.map((m) => `<p>${toHtml(m)}</p>`).join("")}</div>`
    : "";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.title)} — ${esc(segText(val(ctx.reference, "deal reference")))}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Josefin+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="wrap">
<div class="banner" role="note">${esc(DRAFT_BANNER)}</div>
<div class="top"><span class="brand">NIVASA <span>CLOSE</span></span><span class="note">${esc(segText(val(ctx.reference, "deal reference")))}</span></div>
${meta}${isEmail ? "" : `<h1>${esc(spec.title)}</h1>${spec.subtitle ? `<p class="sub">${toHtml(spec.subtitle)}</p>` : ""}`}
${renderHtmlBlocks(spec.blocks)}
<footer><p>${toHtml(footer.line)}</p><p>${toHtml(footer.status)}</p></footer>
</div></body></html>`;

  return { kind: spec.kind, title: spec.title, html, text, ...(spec.subject ? { subject: spec.subject } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Facts: each stated by exactly one helper
// ─────────────────────────────────────────────────────────────────────────────

function longDate(date: string | null | undefined, hint: string): Seg {
  return date && ISO_DATE.test(date) ? formatLongDate(date) : blank(hint);
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** Indian numbering in words: crore, lakh, thousand, hundred. */
export function indianNumberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  n = Math.floor(n);
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const rest = n % 1_000;
  return [
    crore ? `${indianNumberToWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Rupees One Crore Sixteen Lakh only". */
export function rupeesInWords(paiseValue: number): string {
  const rupees = Math.floor(paiseValue / 100);
  const paise = Math.round(paiseValue % 100);
  return paise
    ? `Rupees ${indianNumberToWords(rupees)} and ${belowHundred(paise)} Paise only`
    : `Rupees ${indianNumberToWords(rupees)} only`;
}

/** "₹5,00,000 (Rupees Five Lakh only)" — figures and words, or a blank. */
function money(p: number | null | undefined, hint: string): Segs {
  if (p === null || p === undefined || !Number.isFinite(p) || p < 0) return [blank(hint)];
  return [{ strong: formatRupees(p) }, ` (${rupeesInWords(p)})`];
}

/** The ONLY place "booking amount" is written: always immediately followed by its figure. */
function bookingAmount(ctx: RenderContext): Segs {
  return s`booking amount of ${money(ctx.derived.bookingAmountPaise, "booking amount")}`;
}

/** The ONLY place "on or before" is written: always the derived deadline. */
function byDeadline(ctx: RenderContext): Segs {
  return s`on or before ${longDate(ctx.derived.deadlineDate, "deadline date")}`;
}

/** The association, exactly as the sheet spells it. */
function association(sheet: DealSheet): Segs {
  const name = sheet.associationName?.trim();
  if (!name) return ["the ", blank("owners association name")];
  return /^the\s/i.test(name) ? [name] : ["the ", name];
}

function payer(p: "BUYER" | "SELLER" | "SHARED"): string {
  if (p === "BUYER") return "the Buyer";
  if (p === "SELLER") return "the Seller(s)";
  return "the Seller(s) and the Buyer in equal shares";
}

/**
 * Pre-transfer dues — one sentence, used verbatim by the MOU and the LOU, so the two documents
 * cannot assign the same dues to different parties (rule 10).
 */
function pastDuesSentence(sheet: DealSheet): Segs {
  const head = s`All dues payable to ${association(sheet)}, to any utility provider or to any authority in respect of ${val(sheet.propertyLabel, "property")}, including maintenance charges, electricity and water charges and property tax, accrued prior to handover shall be borne by `;
  return sheet.pastDuesPayer === "BUYER"
    ? [...head, "the Buyer."]
    : [...head, "the Seller(s), and the Seller(s) shall indemnify the Buyer against them."];
}

function pan(ctx: RenderContext, party: { name: string; panLast4?: string | null }): Seg {
  const full = ctx.fullPans?.[party.name]?.replace(/\s+/g, "");
  if (full) return full.toUpperCase();
  if (party.panLast4?.trim()) return maskPan(party.panLast4);
  return blank(`PAN of ${party.name}`);
}

function sharePct(bps: number): string {
  return `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

function sellerNames(sheet: DealSheet): Segs {
  return join(sheet.sellers.map((x) => [val(x.name, "seller name")]));
}

function loanAccount(sheet: DealSheet): Segs {
  return s`loan account ending ${val(sheet.sellerBank?.loanLast4, "last 4 digits of loan account")}`;
}

function bankName(sheet: DealSheet): Seg {
  return val(sheet.sellerBank?.name, "seller's bank");
}

function bankWithBranch(sheet: DealSheet): Segs {
  const branch = sheet.sellerBank?.branch?.trim();
  return branch ? s`${bankName(sheet)}, ${branch}` : [bankName(sheet)];
}

/** Notices go by email: each party with its sheet email, or a blank the checker flags. */
function noticeLines(sheet: DealSheet): Segs[] {
  return [
    ...sheet.sellers.map((x) => s`${val(x.name, "seller name")} (Seller): ${val(x.email, `email of ${x.name}`)}`),
    s`${val(sheet.buyer.name, "buyer name")} (Buyer): ${val(sheet.buyer.email, `email of ${sheet.buyer.name}`)}`,
  ];
}

const PAYMENT_LABEL: Partial<Record<LedgerPaymentKind, string>> = {
  TOKEN: "token",
  BOOKING: "booking",
  SELF_FUNDING: "self-funding",
};

/** One ledger row, as a document states it — with its date when paid. */
function paymentLine(ctx: RenderContext, p: LedgerPayment, dueWhen: Segs): Segs {
  const from = val(p.fromLabel ?? ctx.sheet.buyer.name, "payer");
  const to = val(p.toLabel, "payee");
  const txn = val(p.txnRef, "transaction reference");
  const label = PAYMENT_LABEL[p.kind] ?? p.kind.toLowerCase();
  return p.paidAt
    ? s`${money(p.amountPaise, "amount")} (${label}) paid by ${from} to ${to} on ${longDate(p.paidAt, "payment date")} (received), transaction reference ${txn}`
    : s`${money(p.amountPaise, "amount")} (${label}) payable by ${from} to ${to} ${dueWhen}, transaction reference ${txn}`;
}

const of = (payments: LedgerPayment[], ...kinds: LedgerPaymentKind[]) =>
  payments.filter((p) => kinds.includes(p.kind));
const total = (payments: LedgerPayment[]) => payments.reduce((a, p) => a + p.amountPaise, 0);

function daysBetween(from: string, to: string): number | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOU
// ─────────────────────────────────────────────────────────────────────────────

function mou(ctx: RenderContext): DocSpec {
  const { sheet, derived, payments } = ctx;
  const assignment = sheet.playbook === "BUILDER_ASSIGNMENT";
  const inst = INSTRUMENT[sheet.playbook];
  const I = inst.term;
  const builder = val(sheet.builder, "builder name");
  const execution = longDate(sheet.executionDate, "execution date");
  const onExecution = s`on execution of this Memorandum on ${execution}`;
  const onInstrument = s`on the date of execution of the ${I}`;

  const parties: Block[] = [
    { type: "heading", text: "Parties" },
    { type: "p", segs: s`This Memorandum of Understanding (this "Memorandum") is made at Bengaluru on ${execution} between:` },
    {
      type: "list",
      items: sheet.sellers.map(
        (x) => s`${val(x.name, "seller name")}, PAN ${pan(ctx, x)}, holding a ${sharePct(x.shareBps)} share in the Schedule Property`,
      ),
    },
    { type: "p", segs: [`(each a "Seller" and together the "Seller(s)"), of the one part; and`] },
    { type: "p", segs: s`${val(sheet.buyer.name, "buyer name")}, PAN ${pan(ctx, sheet.buyer)} (the "Buyer"), of the other part.` },
    { type: "p", segs: [`The Seller(s) and the Buyer are each a "Party" and together the "Parties".`] },
  ];

  const recitals: Segs[] = assignment
    ? [
        s`By an ${BUILDER_AGREEMENT} dated ${longDate(sheet.builderAgreementDate, "builder agreement date")}, ${builder} (the "Builder") agreed to sell to the Seller(s) the apartment described in the Schedule (the "Schedule Property"), in the project whose owners association is ${association(sheet)}.`,
      ]
    : [
        s`The Seller(s) are the absolute owners of the apartment described in the Schedule (the "Schedule Property"), whose owners association is ${association(sheet)}.`,
      ];
  if (sheet.sellerBank) {
    recitals.push(
      s`The Seller(s) have availed a home loan from ${bankWithBranch(sheet)}, ${loanAccount(sheet)}, secured on the Schedule Property.`,
    );
  }
  recitals.push(
    assignment
      ? s`The Seller(s) have agreed to assign all their rights under the ${BUILDER_AGREEMENT} to the Buyer by ${inst.article} ${I}, with the consent of the Builder, and the Buyer has agreed to take that assignment, on the terms of this Memorandum.`
      : s`The Seller(s) have agreed to sell, and the Buyer has agreed to buy, the Schedule Property by ${inst.article} ${I} to be registered before the jurisdictional Sub-Registrar, on the terms of this Memorandum.`,
  );

  // Payments — every figure from the ledger or derived values.
  const bookingRows = of(payments, "TOKEN", "BOOKING");
  const selfRows = of(payments, "SELF_FUNDING");
  const selfFunding = total(selfRows);
  const anyReceived = bookingRows.some((p) => p.paidAt);

  const scheduleItems: Segs[] = [s`the ${bookingAmount(ctx)}, made up of the payments set out above;`];
  if (selfRows.length || selfFunding > 0) {
    scheduleItems.push(
      s`${money(selfFunding, "self-funding amount")} from the Buyer's own funds, payable to the Seller(s) ${onInstrument} (${join(
        selfRows.map((p) =>
          p.paidAt
            ? s`${formatRupees(p.amountPaise)} to ${val(p.toLabel, "payee")}, paid on ${longDate(p.paidAt, "payment date")}, transaction reference ${val(p.txnRef, "transaction reference")}`
            : s`${formatRupees(p.amountPaise)} to ${val(p.toLabel, "payee")}, transaction reference ${val(p.txnRef, "transaction reference")}`,
        ),
        "; ",
        "; ",
      )});`,
    );
  }
  if (derived.loanPaise > 0) {
    const toBank = sheet.sellerBank
      ? s`paid directly to ${bankName(sheet)} towards the Seller(s)'s ${loanAccount(sheet)} to the extent of the outstanding loan, with the balance paid to the Seller(s) in proportion to their shares`
      : ["paid to the Seller(s) in proportion to their shares"];
    scheduleItems.push(
      s`${money(derived.loanPaise, "loan amount")} from a home loan sanctioned to the Buyer by ${val(sheet.buyerBank?.name, "buyer's lending bank")}, ${toBank};`,
    );
  }
  if (derived.tdsPaise > 0) {
    scheduleItems.push(
      s`${money(derived.tdsPaise, "TDS amount")} deducted at source by the Buyer and deposited on behalf of the Seller(s), as set out under Tax deducted at source.`,
    );
  }

  const tdsParts: ClausePart[] =
    derived.tdsPaise > 0
      ? [
          s`The Buyer shall deduct tax at source of ${money(derived.tdsPaise, "TDS amount")}, being 1% of the consideration, under Section 194-IA of the Income-tax Act, 1961, split between the Seller(s) by share as follows:`,
          {
            list: derived.tdsBySeller.map((t) => {
              const seller = sheet.sellers.find((x) => x.name === t.name) ?? { name: t.name };
              return s`${money(t.tdsPaise, `TDS for ${t.name}`)} in respect of ${val(t.name, "seller name")} (${sharePct(t.shareBps)} share, PAN ${pan(ctx, seller)})`;
            }),
          },
          [
            "The Buyer shall deposit the tax within the time the Act allows and give each Seller the Form 16B issued in their name.",
          ],
        ]
      : [
          [
            "The consideration is below ₹50,00,000, so no tax is deducted at source under Section 194-IA of the Income-tax Act, 1961.",
          ],
        ];

  const completion: ClausePart[] = [
    assignment
      ? s`The Parties shall execute the ${I}, with the written consent of the Builder, ${byDeadline(ctx)}, being ${val(sheet.deadlineDays, "deadline days")} days from the date of this Memorandum (the "deadline").`
      : s`The Parties shall execute the ${I} and present it for registration before the jurisdictional Sub-Registrar ${byDeadline(ctx)}, being ${val(sheet.deadlineDays, "deadline days")} days from the date of this Memorandum (the "deadline").`,
  ];
  if (sheet.sellerBank) {
    completion.push(
      s`The Seller(s) shall obtain from ${bankName(sheet)} a conditional no-objection certificate and the List of Documents held against the ${loanAccount(sheet)}, and shall give copies of both to the Buyer as soon as they are received.`,
    );
  }
  if (assignment) {
    completion.push(
      s`The Seller(s) shall apply for and obtain the Builder's written consent to the assignment, and the Buyer shall provide every document the Builder reasonably asks of the assignee.`,
    );
  }

  const possession: ClausePart[] = [
    s`The Seller(s) shall hand over vacant and peaceful possession of the Schedule Property to the Buyer on the date of execution of the ${I}, against receipt of the full consideration.`,
    s`At handover, the electricity, water and piped-gas accounts and the maintenance account with ${association(sheet)} shall be transferred to the name of the Buyer, and the Seller(s) shall sign every application, letter and form needed for those transfers.`,
    ["At handover the Seller(s) shall also deliver to the Buyer:"],
    {
      list: [
        ["every key, access card and remote for the Schedule Property and its parking;"],
        sheet.sellerBank
          ? s`the original documents released by ${bankName(sheet)} on closure of the loan, or the bank's written undertaking to release them to the Buyer's lender;`
          : ["the original title documents for the Schedule Property;"],
        s`a no-dues certificate from ${association(sheet)};`,
        ["the latest paid electricity and water bills."],
      ],
    },
  ];
  if (sheet.possessionNotes?.trim()) possession.push([sheet.possessionNotes.trim()]);

  const extension: ClausePart[] = [];
  const delayers = assignment ? "a bank or the Builder" : "a bank";
  const extended = longDate(derived.extendedDeadlineDate, "extended deadline date");
  if (sheet.extensionDays <= 0) {
    extension.push(["The deadline shall not be extended except as the Parties agree in writing."]);
  } else if (sheet.bankDelayAutoExtension) {
    extension.push(
      s`If completion is delayed for a reason attributable to ${delayers}, and not to either Party, the deadline shall stand automatically extended by ${val(sheet.extensionDays, "extension days")} days, until ${extended}, and no penalty under this Memorandum shall apply for that period.`,
      ["Any further extension shall be agreed in writing by the Parties."],
    );
  } else {
    extension.push(
      s`The deadline may be extended by ${val(sheet.extensionDays, "extension days")} days, until ${extended}, by mutual written agreement of the Parties, including where completion is delayed by ${delayers}.`,
    );
  }

  const penalty: ClausePart[] = [];
  const perDay = sheet.lateSelfFundingPenaltyPerDayPaise;
  if (perDay !== 0) {
    penalty.push(
      s`If the Buyer delays payment of the self-funding amount beyond the date of execution of the ${I}, the Buyer shall pay the Seller(s) ${money(perDay, "late self-funding penalty per day")} for each day of delay.`,
    );
  }
  const pen = money(sheet.penaltyPaise, "penalty amount");
  if (sheet.penaltyPaise === 0) {
    penalty.push([
      "Neither Party shall pay a penalty for non-performance; if this Memorandum is terminated, the Seller(s) shall refund every amount received from the Buyer within 15 days.",
    ]);
  } else if (sheet.penaltyParty === "SELLER") {
    penalty.push(
      s`If the Seller(s) fail to complete the ${inst.act} ${byDeadline(ctx)}, or by the deadline as extended under this Memorandum, for a reason other than the Buyer's default, the Seller(s) shall refund every amount received from the Buyer and shall in addition pay the Buyer ${pen} as liquidated damages.`,
    );
  } else if (sheet.penaltyParty === "BUYER") {
    penalty.push(
      s`If the Buyer fails to complete the ${inst.act} ${byDeadline(ctx)}, or by the deadline as extended under this Memorandum, for a reason other than the Seller(s)'s default, the Seller(s) may retain ${pen} out of the amounts received as liquidated damages and shall refund the rest to the Buyer within 15 days.`,
    );
  } else {
    penalty.push(
      s`If either Party fails to complete the ${inst.act} ${byDeadline(ctx)}, or by the deadline as extended under this Memorandum, for a reason other than the other Party's default, the defaulting Party shall pay the other ${pen} as liquidated damages, and where the Seller(s) are in default they shall also refund every amount received from the Buyer.`,
    );
  }

  const blocks: Block[] = [
    ...parties,
    { type: "heading", text: "Recitals" },
    { type: "list", items: recitals },
    { type: "heading", text: "Terms" },
    {
      type: "clause",
      title: "Consideration",
      parts: [
        s`The total consideration for the ${inst.act} is ${money(sheet.considerationPaise, "consideration")}.`,
        s`After tax deducted at source, the net amount payable to the Seller(s) is ${money(derived.netToSellersPaise, "net to sellers")}.`,
      ],
    },
    {
      type: "clause",
      title: "Booking amount",
      parts: [
        s`The Buyer shall pay the Seller(s) a ${bookingAmount(ctx)}, made up of the following payments:`,
        {
          list: bookingRows.length
            ? bookingRows.map((p) => paymentLine(ctx, p, onExecution))
            : [[blank("token and booking payments")]],
        },
        anyReceived
          ? ["The Seller(s) acknowledge receipt of each payment above recorded as received. These payments form part of the consideration."]
          : ["These payments form part of the consideration."],
      ],
    },
    { type: "clause", title: "Payment of the consideration", parts: [["The consideration shall be paid as follows:"], { list: scheduleItems }] },
    { type: "clause", title: "Tax deducted at source", parts: tdsParts },
    { type: "clause", title: "Completion", parts: completion },
    { type: "clause", title: "Possession and handover", parts: possession },
    {
      type: "clause",
      title: "Dues and outgoings",
      parts: [pastDuesSentence(sheet), ["From handover, all such dues and outgoings shall be borne by the Buyer."]],
    },
    {
      type: "clause",
      title: "Stamp duty, registration and transfer fee",
      parts: [
        s`Stamp duty and registration charges on the ${I} shall be borne by ${payer(sheet.stampDutyPayer)}.`,
        assignment
          ? s`The transfer fee charged by the Builder for the assignment shall be borne by ${payer(sheet.transferFeePayer)}.`
          : s`Any transfer fee charged by ${association(sheet)} for recording the change of ownership shall be borne by ${payer(sheet.transferFeePayer)}.`,
      ],
    },
    { type: "clause", title: "Extension and delay", parts: extension },
    { type: "clause", title: "Default and penalty", parts: penalty },
    {
      type: "clause",
      title: "Notices",
      parts: [
        ["Every notice under this Memorandum shall be in writing and sent by email to the Party at the address below, and is received on the day it is sent unless a delivery failure is reported. A Party may change its address by notice to the others."],
        { list: noticeLines(sheet) },
      ],
    },
    {
      type: "clause",
      title: "Governing law and entire understanding",
      parts: [
        ["This Memorandum is governed by the laws of India, and the courts at Bengaluru shall have exclusive jurisdiction."],
        ["This Memorandum records the entire understanding of the Parties on its subject and may be changed only in writing signed by all of them."],
      ],
    },
    { type: "p", segs: ["IN WITNESS WHEREOF the Parties have signed this Memorandum on the date first written above."] },
    {
      type: "signatures",
      signers: [
        ...sheet.sellers.map((x) => ({ name: val(x.name, "seller name"), role: "Seller" })),
        { name: val(sheet.buyer.name, "buyer name"), role: "Buyer" },
        // Witnesses write their own name and address at signing; a blank would block "final".
        { name: "First witness", role: "name and address" },
        { name: "Second witness", role: "name and address" },
      ],
    },
    { type: "heading", text: "Schedule — the Schedule Property" },
    {
      type: "p",
      segs: s`${val(sheet.propertyLabel, "property")}, a residential apartment of ${val(
        sheet.superBuiltUpSqft?.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
        "super built-up area",
      )} sq ft super built-up area${
        assignment
          ? s`, being the apartment agreed to be sold under the ${BUILDER_AGREEMENT} dated ${longDate(sheet.builderAgreementDate, "builder agreement date")} with ${builder}`
          : []
      }, together with the undivided share in the land, the car parking and the common amenities attached to it.`,
    },
  ];

  return {
    kind: "MOU",
    title: "Memorandum of Understanding",
    subtitle: assignment
      ? s`for the assignment of an ${BUILDER_AGREEMENT} — ${val(sheet.propertyLabel, "property")}`
      : s`for the sale of ${val(sheet.propertyLabel, "property")}`,
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOU
// ─────────────────────────────────────────────────────────────────────────────

function lou(ctx: RenderContext): DocSpec {
  const { sheet } = ctx;
  const assignment = sheet.playbook === "BUILDER_ASSIGNMENT";
  const inst = INSTRUMENT[sheet.playbook];
  const property = val(sheet.propertyLabel, "property");
  const assoc = association(sheet);
  const settler = sheet.pastDuesPayer === "BUYER" ? "the Buyer" : "the Seller(s)";

  return {
    kind: "LOU",
    title: "Letter of Undertaking",
    subtitle: s`to ${assoc} — ${property}`,
    blocks: [
      { type: "p", segs: s`Date: ${longDate(sheet.executionDate, "date of letter")}` },
      { type: "p", segs: s`To\nThe Secretary and the Managing Committee\n${sheet.associationName?.trim() ? sheet.associationName.trim() : blank("owners association name")}` },
      { type: "p", segs: s`Subject: Undertaking on dues and the transfer of the maintenance account — ${property}` },
      { type: "p", segs: ["Dear Sir/Madam,"] },
      {
        type: "p",
        segs: s`We, ${sellerNames(sheet)} (the "Seller(s)"), and ${val(sheet.buyer.name, "buyer name")} (the "Buyer"), write about ${property}. The Seller(s) have agreed to ${assignment ? "assign their rights in it" : "sell it"} to the Buyer by ${inst.article} ${inst.term} to be executed ${byDeadline(ctx)}. We jointly undertake to ${assoc} as follows.`,
      },
      {
        type: "clause",
        title: "Undertakings",
        parts: [
          pastDuesSentence(sheet),
          s`We request ${assoc} to issue a statement of dues up to the date of handover, which ${settler} shall settle in full.`,
          s`From handover, maintenance charges and all other outgoings for ${property} shall be borne by the Buyer, and the maintenance account, access cards and records held by ${assoc} shall be transferred to the name of the Buyer.`,
          ["The electricity, water and piped-gas accounts shall be transferred to the name of the Buyer at handover, and the Seller(s) shall sign every application needed for those transfers."],
          s`We shall inform ${assoc} in writing of the date of handover.`,
        ],
      },
      {
        type: "clause",
        title: "Contact",
        parts: [["Correspondence about this undertaking may be sent by email to:"], { list: noticeLines(sheet) }],
      },
      { type: "p", segs: ["Yours faithfully,"] },
      {
        type: "signatures",
        signers: [
          ...sheet.sellers.map((x) => ({ name: val(x.name, "seller name"), role: "Seller" })),
          { name: val(sheet.buyer.name, "buyer name"), role: "Buyer" },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank emails — from the sellers to the seller's bank
// ─────────────────────────────────────────────────────────────────────────────

function bankEmail(
  ctx: RenderContext,
  kind: DealDocumentKind,
  title: string,
  subjectHead: string,
  body: Block[],
): DocSpec {
  const { sheet } = ctx;
  const subject = toText(
    s`${subjectHead} — home ${loanAccount(sheet)} — ${val(sheet.propertyLabel, "property")}`,
  );
  const signOff: Block[] = [
    { type: "p", segs: ["Yours faithfully,"] },
    ...sheet.sellers.map(
      (x): Block => ({
        type: "p",
        segs: s`${val(x.name, "seller name")}\n${val(x.email, `email of ${x.name}`)}${x.phone?.trim() ? `\n${x.phone.trim()}` : ""}`,
      }),
    ),
  ];
  return {
    kind,
    title,
    subject,
    meta: [
      s`To: The Branch Manager, ${bankWithBranch(sheet)} <${val(sheet.sellerBank?.email, "bank email")}>`,
      s`From: ${join(sheet.sellers.map((x) => s`${val(x.name, "seller name")} <${val(x.email, `email of ${x.name}`)}>`), ", ", ", ")}`,
      s`Subject: ${subject}`,
    ],
    blocks: [
      { type: "p", segs: s`To\nThe Branch Manager\n${bankWithBranch(sheet)}` },
      { type: "p", segs: ["Dear Sir/Madam,"] },
      ...body,
      ...signOff,
    ],
  };
}

function borrowers(ctx: RenderContext): Segs {
  const { sheet } = ctx;
  return s`We, ${sellerNames(sheet)}, are the borrowers on home ${loanAccount(sheet)} with ${bankWithBranch(sheet)}, secured on ${val(sheet.propertyLabel, "property")}.`;
}

function transactionSentence(ctx: RenderContext): Segs {
  const { sheet } = ctx;
  const inst = INSTRUMENT[sheet.playbook];
  return sheet.playbook === "BUILDER_ASSIGNMENT"
    ? s`We have agreed to assign our ${BUILDER_AGREEMENT} with ${val(sheet.builder, "builder name")} for this property to ${val(sheet.buyer.name, "buyer name")} for a total consideration of ${money(sheet.considerationPaise, "consideration")}, by ${inst.article} ${inst.term} to be executed ${byDeadline(ctx)}.`
    : s`We have agreed to sell this property to ${val(sheet.buyer.name, "buyer name")} for a total consideration of ${money(sheet.considerationPaise, "consideration")}, by ${inst.article} ${inst.term} to be registered ${byDeadline(ctx)}.`;
}

function nocLodRequest(ctx: RenderContext): DocSpec {
  const inst = INSTRUMENT[ctx.sheet.playbook];
  return bankEmail(ctx, "BANK_NOC_LOD_REQUEST", "Request for conditional NOC and List of Documents", "Request for conditional NOC and List of Documents", [
    { type: "p", segs: borrowers(ctx) },
    { type: "p", segs: [...transactionSentence(ctx), " The buyer's home loan will repay our outstanding loan with you directly."] },
    { type: "p", segs: ["To proceed, we request:"] },
    {
      type: "list",
      items: [
        s`a conditional no-objection certificate (NOC) for the ${inst.act}, subject to repayment of the outstanding loan in full;`,
        ["the List of Documents (LOD) you hold against this loan, which the buyer's bank needs before it can sanction the buyer's loan;"],
        ["the outstanding principal and interest as on date, with the interest per day, so that the loan can be closed in full."],
      ],
    },
    { type: "p", segs: ["The buyer has asked to see the List of Documents before the Memorandum of Understanding is signed, so we would be grateful to receive it at the earliest."] },
    { type: "p", segs: ["Thank you."] },
  ]);
}

function foreclosureRequest(ctx: RenderContext): DocSpec {
  const { sheet, derived } = ctx;
  const verb = sheet.playbook === "BUILDER_ASSIGNMENT" ? "assigning our rights in" : "selling";
  return bankEmail(ctx, "BANK_FORECLOSURE_REQUEST", "Request for foreclosure statement", "Request for foreclosure statement", [
    { type: "p", segs: borrowers(ctx) },
    {
      type: "p",
      segs: s`We are ${verb} the property to ${val(sheet.buyer.name, "buyer name")}, and the loan is to be repaid in full ${byDeadline(ctx)}. Of the consideration, ${money(derived.loanPaise, "loan amount")} will be paid by the buyer's bank, ${val(sheet.buyerBank?.name, "buyer's lending bank")}, directly to you towards this loan, to the extent of the outstanding amount; any balance will be paid to us.`,
    },
    { type: "p", segs: ["We request:"] },
    {
      type: "list",
      items: [
        s`a foreclosure statement showing the amount needed to close the loan, valid until ${longDate(derived.deadlineDate, "deadline date")};`,
        ["the account to which the buyer's bank should pay, with its IFSC;"],
        ["confirmation that, on receipt of that amount, you will close the loan, release your charge on the property and hand the original documents in the List of Documents to us or, on our written instruction, to the buyer's bank;"],
        ["the foreclosure charges, if any."],
      ],
    },
    { type: "p", segs: ["Thank you."] },
  ]);
}

function followUp(ctx: RenderContext): DocSpec {
  const { derived } = ctx;
  const left = derived.deadlineDate ? daysBetween(ctx.generatedOn, derived.deadlineDate) : null;
  const remaining: Segs =
    left === null
      ? [blank("days remaining")]
      : left > 0
        ? [`${left} day${left === 1 ? "" : "s"} remain`]
        : left === 0
          ? ["that is today"]
          : ["that date has passed"];
  return bankEmail(ctx, "BANK_FOLLOW_UP", "Follow-up: conditional NOC and List of Documents", "Follow-up: conditional NOC and List of Documents", [
    {
      type: "p",
      segs: s`We are following up on our request for a conditional no-objection certificate (NOC) and the List of Documents (LOD) for home ${loanAccount(ctx.sheet)}, secured on ${val(ctx.sheet.propertyLabel, "property")}.`,
    },
    {
      type: "p",
      segs: s`Our transaction must complete ${byDeadline(ctx)}; as of ${longDate(ctx.generatedOn, "today's date")}, ${remaining}. The buyer's bank cannot sanction the buyer's loan until it sees the List of Documents, so this is now holding up the whole transaction.`,
    },
    { type: "p", segs: ["We would be grateful for:"] },
    {
      type: "list",
      items: [
        ["the conditional NOC;"],
        ["the List of Documents;"],
        ["the outstanding loan amount as on date, with the interest per day;"],
        ["the name of someone at the branch we can follow up with."],
      ],
    },
    { type: "p", segs: ["If you need anything further from us, please tell us by reply and we will send it the same day."] },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

const BUILDERS: Record<DealDocumentKind, (ctx: RenderContext) => DocSpec> = {
  MOU: mou,
  LOU: lou,
  BANK_NOC_LOD_REQUEST: nocLodRequest,
  BANK_FORECLOSURE_REQUEST: foreclosureRequest,
  BANK_FOLLOW_UP: followUp,
};

/** Pure and deterministic: the same context always renders the same bytes. */
export function renderDealDocument(kind: DealDocumentKind, ctx: RenderContext): RenderedDocument {
  const build = BUILDERS[kind];
  if (!build) throw new Error(`Unknown document kind: ${String(kind)}`);
  return emit(build(ctx), ctx);
}
