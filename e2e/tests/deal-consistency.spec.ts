import { expect, test } from "@playwright/test";

import { checkDealConsistency, parseRupees } from "../../lib/deal-consistency";
import { dealSheetSchema, deriveSheet, formatRupees } from "../../lib/deal-sheet";
import type { DealSheet, DealSheetInput, LedgerPayment } from "../../lib/deal-sheet";
import type { ConsistencyIssue, DocumentText } from "../../lib/deal-types";

/**
 * The Close consistency checker — the code that decides whether an MOU may be marked final.
 *
 * Every case here is a mistake that reached a real draft of the A-1042 MOU (handover §6) and was
 * caught by a party rather than by the drafter. The fixture is the sanitised deal from §10; the
 * documents are written by hand rather than rendered, so a renderer bug cannot make a checker
 * test pass by agreeing with itself — the same reason `e2e/support/ist.ts` does not import
 * `lib/slots.ts`.
 *
 * `checkDealConsistency()` is pure, so these tests call it directly, like `autoSendRefusal()` in
 * `autosend-gate.spec.ts`. They use neither the server nor the database, which is also why they
 * import `test` from Playwright itself rather than from `../support/fixtures`.
 */

const SHEET: DealSheetInput = {
  playbook: "BUILDER_ASSIGNMENT",
  propertyLabel: "Sobha Dream Gardens, Wing 1, A-1042",
  builder: "Sobha Limited",
  builderAgreementDate: "2023-11-21",
  associationName: "Sobha Dream Gardens owners association",
  superBuiltUpSqft: 1009.97,
  considerationPaise: 1160000000,
  executionDate: "2026-10-16",
  deadlineDays: 60,
  extensionDays: 15,
  sellers: [
    { name: "Seller One", shareBps: 5000, email: "seller1@example.com" },
    { name: "Seller Two", shareBps: 5000, email: "seller2@example.com" },
  ],
  buyer: { name: "Buyer One", email: "buyer@example.com" },
  sellerBank: { name: "SBI", branch: "RACPC", loanLast4: "0000" },
  stampDutyPayer: "BUYER",
  transferFeePayer: "SELLER",
  penaltyPaise: 30000000,
  lateSelfFundingPenaltyPerDayPaise: 500000,
};

const PAYMENTS: LedgerPayment[] = [
  { kind: "TOKEN", amountPaise: 10000000, toLabel: "Seller One", paidAt: "2026-10-13" },
  { kind: "BOOKING", amountPaise: 15000000, toLabel: "Seller One", paidAt: null },
  { kind: "BOOKING", amountPaise: 25000000, toLabel: "Seller Two", paidAt: null },
  { kind: "SELF_FUNDING", amountPaise: 110000000, toLabel: "Sellers", paidAt: null },
];

const MOU = `MEMORANDUM OF UNDERSTANDING

This Memorandum of Understanding ("MOU") is executed at Bengaluru on 16 October 2026 between Seller One and Seller Two (together, the "Sellers") and Buyer One (the "Buyer"), for the assignment of Sobha Dream Gardens, Wing 1, A-1042 under the Agreement to Sell dated 21 November 2023 with Sobha Limited.

1. Consideration. The total consideration is ₹1,16,00,000. The Buyer paid a token of ₹1,00,000 on 13 October 2026. The booking amount of ₹5,00,000 (inclusive of the token) is payable on execution of this MOU.

2. Completion. The Assignment Agreement shall be executed on or before 15 December 2026, extendable once by mutual written consent to on or before 30 December 2026.

3. TDS. The Buyer shall deduct TDS of ₹1,16,000 under Sec 194-IA, being ₹58,000 against each Seller's PAN.

4. Possession. The Sellers shall hand over vacant possession of the flat to the Buyer on execution of the Assignment Agreement.

5. Utilities. At handover, the electricity, water and maintenance accounts shall be transferred to the name of the Buyer.

6. Dues. All maintenance, utility and property tax dues accrued prior to handover shall be borne by the Seller(s).

7. Association. The Sellers shall obtain a no-dues certificate from the Sobha Dream Gardens owners association.

8. Notices. Notices under this MOU shall be served by email to seller1@example.com, seller2@example.com and buyer@example.com.

Annexure A — Payment schedule
Token of ₹1,00,000 paid on 13 October 2026.
`;

const LOU = `LETTER OF UNDERTAKING

To: The Secretary, Sobha Dream Gardens owners association
Re: Sobha Dream Gardens, Wing 1, A-1042

We, Seller One and Seller Two, undertake that all maintenance dues accrued prior to handover to Buyer One shall be borne by the Seller(s). The booking amount of ₹5 L has been agreed under the MOU dated 16 October 2026, and the Assignment Agreement is to be executed on or before 15 Dec 2026.
`;

function sheet(overrides: Partial<DealSheetInput> = {}): DealSheet {
  return dealSheetSchema.parse({ ...SHEET, ...overrides });
}

function docs(mou = MOU, lou = LOU): DocumentText[] {
  return [
    { kind: "MOU", text: mou },
    { kind: "LOU", text: lou },
  ];
}

const errors = (issues: ConsistencyIssue[]) => issues.filter((i) => i.severity === "error");
const warnings = (issues: ConsistencyIssue[]) => issues.filter((i) => i.severity === "warning");
const codes = (issues: ConsistencyIssue[]) => issues.map((i) => i.code);

test.describe("the clean fixture", () => {
  test("derives the figures the documents must state", () => {
    const d = deriveSheet(sheet(), PAYMENTS);

    expect(formatRupees(d.bookingAmountPaise)).toBe("₹5,00,000");
    expect(formatRupees(d.ownFundsPaise)).toBe("₹16,00,000");
    expect(formatRupees(d.tdsPaise)).toBe("₹1,16,000");
    expect(d.tdsBySeller.map((s) => formatRupees(s.tdsPaise))).toEqual(["₹58,000", "₹58,000"]);
    expect(formatRupees(d.netToSellersPaise)).toBe("₹1,14,84,000");
    expect(d.deadlineDate).toBe("2026-12-15");
    expect(d.extendedDeadlineDate).toBe("2026-12-30");
  });

  test("has no errors, sheet alone or with its documents", () => {
    expect(errors(checkDealConsistency({ sheet: sheet(), payments: PAYMENTS }))).toEqual([]);
    expect(errors(checkDealConsistency({ sheet: sheet(), payments: PAYMENTS, documents: docs() }))).toEqual([]);
  });

  /**
   * The fixture carries a seller-side ₹3 L penalty and leaves `bankDelayAutoExtension` at its
   * default of false — which is the A-1042 deal exactly, and exactly what rule 11 warns about.
   */
  test("carries the bank-delay warning and nothing else", () => {
    const issues = checkDealConsistency({ sheet: sheet(), payments: PAYMENTS, documents: docs() });
    expect(codes(warnings(issues))).toEqual(["PENALTY_WITHOUT_BANK_DELAY_EXTENSION"]);
    expect(issues[0]).toMatchObject({ rule: 11, severity: "warning" });
  });
});

/** The five checker cases from handover §10. Each must be exactly one error, and the right one. */
test.describe("the §10 cases", () => {
  test("execution 11 Oct against a token paid 13 Oct (rule 1)", () => {
    // Sheet and ledger only: the hand-written documents say 16 October, and moving the execution
    // date also moves the deadline those documents state — a second, genuine, rule-2 error.
    const issues = checkDealConsistency({ sheet: sheet({ executionDate: "2026-10-11" }), payments: PAYMENTS });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 1, code: "EXECUTION_BEFORE_PAYMENT" });
  });

  test("the deadline rendered as 10 December (rule 2)", () => {
    // Wrong in both documents and in both spellings: still one date to fix, so one issue.
    const issues = checkDealConsistency({
      sheet: sheet(),
      payments: PAYMENTS,
      documents: docs(
        MOU.replace("on or before 15 December 2026", "on or before 10 December 2026"),
        LOU.replace("on or before 15 Dec 2026", "on or before 10/12/2026"),
      ),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 2, code: "DEADLINE_DATE_MISMATCH" });
  });

  test("one seller's email removed (rule 3)", () => {
    const s = sheet();
    s.sellers[1].email = null;
    const issues = checkDealConsistency({ sheet: s, payments: PAYMENTS, documents: docs() });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 3, code: "NOTICE_PARTY_WITHOUT_EMAIL", where: "sellers.1.email" });
  });

  test("the booking amount ₹4 L in one place and ₹5 L in another (rule 5)", () => {
    const issues = checkDealConsistency({
      sheet: sheet(),
      payments: PAYMENTS,
      documents: docs(MOU, LOU.replace("booking amount of ₹5 L", "booking amount of ₹4,00,000")),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 5, code: "BOOKING_AMOUNT_MISMATCH", where: "LOU" });
  });

  test("the association renamed to another project's (rule 9)", () => {
    const issues = checkDealConsistency({
      sheet: sheet(),
      payments: PAYMENTS,
      documents: docs(MOU, LOU.replace("Sobha Dream Gardens owners association", "Prestige Lakeside Habitat owners association")),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 9, code: "ASSOCIATION_NAME_MISMATCH", where: "LOU" });
  });
});

test.describe("the other rules", () => {
  test("possession only in the annexure is an error (rule 4)", () => {
    const mou = MOU.replace(
      "4. Possession. The Sellers shall hand over vacant possession of the flat to the Buyer on execution of the Assignment Agreement.\n\n",
      "",
    ).replace("Annexure A — Payment schedule\n", "Annexure A — Payment schedule\nVacant possession on execution.\n");
    const issues = checkDealConsistency({ sheet: sheet(), payments: PAYMENTS, documents: docs(mou) });
    expect(codes(errors(issues))).toEqual(["POSSESSION_NOT_IN_BODY"]);
  });

  test("utilities that never move to the buyer are an error (rule 4)", () => {
    const mou = MOU.replace(
      "5. Utilities. At handover, the electricity, water and maintenance accounts shall be transferred to the name of the Buyer.\n\n",
      "",
    );
    const issues = checkDealConsistency({ sheet: sheet(), payments: PAYMENTS, documents: docs(mou) });
    expect(codes(errors(issues))).toEqual(["UTILITIES_NOT_TRANSFERRED"]);
  });

  test("an explicit loan must close the gap to consideration (rule 5)", () => {
    // ₹1,16,00,000 − ₹16,00,000 own funds − ₹1,16,000 TDS.
    const fits = checkDealConsistency({ sheet: sheet({ loanPaise: 98_84_000_00 }), payments: PAYMENTS });
    expect(errors(fits)).toEqual([]);

    const short = checkDealConsistency({ sheet: sheet({ loanPaise: 90_00_000_00 }), payments: PAYMENTS });
    expect(codes(errors(short))).toEqual(["LEDGER_DOES_NOT_RECONCILE"]);
  });

  test("rupee amounts parse in every spelling the documents use", () => {
    for (const written of ["₹5,00,000", "Rs. 5,00,000", "Rs 500000", "INR 5,00,000", "₹5 L", "₹5 lakh", "₹5 Lakhs"]) {
      expect(parseRupees(written), written).toBe(5_00_000_00);
    }
    expect(parseRupees("₹1.16 Cr")).toBe(1_16_00_000_00);
  });

  test("shares that do not make a whole property are an error (rule 6)", () => {
    const issues = checkDealConsistency({
      sheet: sheet({
        sellers: [
          { name: "Seller One", shareBps: 6000, email: "seller1@example.com" },
          { name: "Seller Two", shareBps: 5000, email: "seller2@example.com" },
        ],
      }),
      payments: PAYMENTS,
    });
    expect(codes(errors(issues))).toEqual(["SELLER_SHARES_NOT_WHOLE"]);
  });

  test("TDS in the ledger must be 1% of consideration (rule 6)", () => {
    const tds = (amountPaise: number, toLabel: string): LedgerPayment => ({
      kind: "TDS",
      amountPaise,
      toLabel,
      paidAt: null,
    });

    const right = checkDealConsistency({
      sheet: sheet(),
      payments: [...PAYMENTS, tds(58_000_00, "Seller One PAN"), tds(58_000_00, "Seller Two PAN")],
    });
    expect(errors(right)).toEqual([]);

    const wrong = checkDealConsistency({
      sheet: sheet(),
      payments: [...PAYMENTS, tds(58_000_00, "Seller One PAN"), tds(50_000_00, "Seller Two PAN")],
    });
    expect(codes(errors(wrong))).toEqual(["TDS_LEDGER_MISMATCH"]);
  });

  test("two names for the assignment are one error; MOU is not a second name (rule 7)", () => {
    const issues = checkDealConsistency({
      sheet: sheet(),
      payments: PAYMENTS,
      documents: docs(MOU.replace("on execution of the Assignment Agreement", "on execution of the Assignment Deed")),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 7, code: "INCONSISTENT_TERMINOLOGY" });
  });

  test("a blank is an error, a blank transaction reference only a warning (rule 8)", () => {
    const withTxnBlank = MOU.replace(
      "paid on 13 October 2026.",
      "paid on 13 October 2026, reference ______ [transaction reference].",
    );
    const flagged = checkDealConsistency({ sheet: sheet(), payments: PAYMENTS, documents: docs(withTxnBlank) });
    expect(errors(flagged)).toEqual([]);
    expect(codes(warnings(flagged))).toContain("BLANK_TRANSACTION_REFERENCE");

    const withDateBlank = withTxnBlank.replace("executed at Bengaluru on 16 October 2026", "executed at Bengaluru on ________ [execution date]");
    const blocked = checkDealConsistency({ sheet: sheet(), payments: PAYMENTS, documents: docs(withDateBlank) });
    expect(errors(blocked)).toHaveLength(1);
    expect(errors(blocked)[0]).toMatchObject({ rule: 8, code: "BLANK_IN_DOCUMENT", where: "MOU" });
  });

  test("the LOU putting past dues on the buyer contradicts the MOU (rule 10)", () => {
    const issues = checkDealConsistency({
      sheet: sheet(),
      payments: PAYMENTS,
      documents: docs(MOU, LOU.replace("shall be borne by the Seller(s)", "shall be borne by the Buyer")),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toMatchObject({ rule: 10, code: "DUES_LIABILITY_CONTRADICTION" });
  });

  test("an automatic bank-delay extension clears the penalty warning (rule 11)", () => {
    const issues = checkDealConsistency({ sheet: sheet({ bankDelayAutoExtension: true }), payments: PAYMENTS });
    expect(issues).toEqual([]);

    const noPenalty = checkDealConsistency({ sheet: sheet({ penaltyPaise: null }), payments: PAYMENTS });
    expect(noPenalty).toEqual([]);
  });
});
