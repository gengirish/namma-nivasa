/**
 * Asia/Kolkata date helpers for the specs.
 *
 * Deliberately NOT imported from `lib/slots.ts`. That file hardcodes `IST_OFFSET_MINUTES = 330`
 * and the whole booking flow rests on it, so a test that reuses the same constant to predict the
 * answer would agree with a wrong one. Everything here goes through `Intl` and the real tz
 * database instead, which makes "10:00 AM on this date in Bangalore" an independent check on the
 * instant the server actually stored.
 */

/** `YYYY-MM-DD` as it reads in Bangalore right now. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** Civil-date arithmetic on a `YYYY-MM-DD`. No zones involved — a calendar day is a calendar day. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function istDateIn(days: number, now: Date = new Date()): string {
  return addDays(istToday(now), days);
}

/** The Monday of the Mon–Sun week a `YYYY-MM-DD` falls in — the window availability counts over. */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const daysSinceMonday = (probe.getUTCDay() + 6) % 7;
  return addDays(dateStr, -daysSinceMonday);
}

export function sameIstWeek(a: string, b: string): boolean {
  return mondayOf(a) === mondayOf(b);
}

/**
 * What a stored UTC instant reads as on a Bangalore wall clock, via tzdata rather than a fixed
 * offset. `{ date: "2026-08-14", time: "10:00 AM" }`.
 */
export function istFieldsOf(instant: Date): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(instant);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(instant)
    // Newer ICU separates the meridiem with a narrow no-break space while the app's slot
    // labels use a plain one — an invisible mismatch nobody would spot in a diff.
    .replace(/\s+(AM|PM)$/, " $1");
  return { date, time };
}

function parseTwelveHour(label: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!match) throw new Error(`not a slot label: ${label}`);
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (/pm/i.test(match[3]) && hour !== 12) hour += 12;
  if (/am/i.test(match[3]) && hour === 12) hour = 0;
  return { hour, minute };
}

/** Asia/Kolkata's offset at a given instant, read off tzdata rather than assumed. */
function istOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  );
  return (asIfUtc - at.getTime()) / 60_000;
}

/**
 * The UTC instant a `YYYY-MM-DD` + `10:00 AM` pair names in Bangalore — the value the specs
 * expect to find in `Viewing.scheduledFor`. Resolved against tzdata, so it would disagree with
 * `lib/slots.ts` if India ever moved off UTC+05:30, which is exactly the disagreement worth
 * hearing about.
 */
export function istInstant(dateStr: string, time: string): Date {
  const { hour, minute } = parseTwelveHour(time);
  const [y, m, d] = dateStr.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  // Two passes: the first uses the offset at the wrong instant, the second at the right one.
  const first = naive - istOffsetMinutes(new Date(naive)) * 60_000;
  return new Date(naive - istOffsetMinutes(new Date(first)) * 60_000);
}

/**
 * The grid the picker offers. Mirrored rather than imported for the same reason as above — if
 * `SLOT_TIMES` changes, the contract test that pins this list is the intended place to notice.
 */
export const CANONICAL_SLOT_TIMES = [
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
] as const;

/** How far ahead `lib/slots.ts` will book. */
export const BOOKING_HORIZON_DAYS = 60;
