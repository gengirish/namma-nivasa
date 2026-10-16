import { parseInrToPaise } from "../../lib/price";
import { expect, test } from "../support/fixtures";

/**
 * Owner intake → a draft listing.
 *
 * The click itself is a signed-in flow and sits behind the same gate as `dashboard.spec.ts`. What
 * can be pinned without a session is the one piece of real logic in the conversion: the owner's
 * free-text asking price becoming paise. It is called directly, like `buildIcsContent()`, because
 * the property worth asserting is the exact integer — a float that lands a paisa short would
 * still render as the right crore figure on every screen.
 */

/** Rupees, as the integer paise the parser must produce. Exact well below 2^53. */
const rupees = (n: number) => BigInt(n * 100);

test.describe("parseInrToPaise", () => {
  test("reads the spellings owners use", () => {
    expect(parseInrToPaise("1,20,00,000")).toBe(rupees(1_20_00_000));
    expect(parseInrToPaise("1.5 CR")).toBe(rupees(1_50_00_000));
    expect(parseInrToPaise("₹1.2 Cr")).toBe(rupees(1_20_00_000));
    expect(parseInrToPaise("Rs. 2 crore")).toBe(rupees(2_00_00_000));
    expect(parseInrToPaise("95 lakh")).toBe(rupees(95_00_000));
    expect(parseInrToPaise("95L")).toBe(rupees(95_00_000));
    expect(parseInrToPaise("80 lacs")).toBe(rupees(80_00_000));
    expect(parseInrToPaise("INR 1,15,00,000/-")).toBe(rupees(1_15_00_000));
  });

  test("does the arithmetic on digits, not floats", () => {
    // parseFloat("1.15") * 1e7 * 100 is 1149999999.9999998.
    expect(parseInrToPaise("1.15 Cr")).toBe(BigInt(1_150_000_000));
    expect(parseInrToPaise("2.35 Cr")).toBe(BigInt(2_350_000_000));
  });

  test("refuses rather than guesses", () => {
    for (const raw of ["", "negotiable", "1.2-1.4 Cr", "1.5 million", "0", "1.2.3 Cr", null]) {
      expect(parseInrToPaise(raw), String(raw)).toBeNull();
    }
  });
});
