/**
 * What an owner types into the intake form's "expected price", turned into paise.
 *
 * Accepts the spellings people actually use — `1,20,00,000`, `₹1.2 Cr`, `1.5 CR`, `95 lakh`,
 * `95L`, `Rs. 1.15 crore` — and returns null for anything else ("negotiable", "1.2-1.4 Cr").
 * A null is the honest answer there: a guessed price on a draft is one a curator might not notice.
 *
 * The arithmetic is on the digit string, never a float. `parseFloat("1.15") * 1e7` is
 * 11499999.999999998, and money in this codebase does not get rounded back into shape.
 */
const UNITS: Record<string, number> = {
  "": 0,
  cr: 7,
  crs: 7,
  crore: 7,
  crores: 7,
  l: 5,
  lac: 5,
  lacs: 5,
  lakh: 5,
  lakhs: 5,
};

export function parseInrToPaise(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .replace(/^\s*(₹|rs\.?|inr)/, "")
    .replace(/[,\s]/g, "")
    .replace(/\/-$/, "");

  const m = s.match(/^(\d+)(?:\.(\d+))?([a-z]*)$/);
  if (!m) return null;
  const [, whole, fraction = "", unit] = m;
  const zeros = UNITS[unit];
  if (zeros === undefined) return null;

  // Rupees to paise is two more places. More fractional digits than that would be a fraction
  // of a paisa, which nobody means.
  const places = zeros + 2;
  if (fraction.length > places) return null;

  const paise = BigInt(whole + fraction.padEnd(places, "0"));
  return paise > BigInt(0) ? paise : null;
}
