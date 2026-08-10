/**
 * Viewing slots, in Asia/Kolkata.
 *
 * India is UTC+05:30 with no daylight saving — it has had none since 1945 — so the offset is a
 * constant rather than a tz-database lookup. That is the one shortcut taken here, and it is
 * stated rather than assumed: if this ever serves a second country, every function below needs
 * a real zone argument, not a different constant.
 *
 * Everything crossing the wire or the schema is a UTC instant. IST appears only where a human
 * reads or picks a time.
 */

export const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** The grid offered to visitors. Owners honour a slot for 45 minutes. */
export const SLOT_TIMES = [
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
] as const;

export type SlotTime = (typeof SLOT_TIMES)[number];

export const SLOT_DURATION_MINUTES = 45;

/** How far ahead the picker will book. Beyond this an owner's plans are guesswork. */
export const BOOKING_HORIZON_DAYS = 60;

export function isSlotTime(value: string): value is SlotTime {
  return (SLOT_TIMES as readonly string[]).includes(value);
}

function parseSlotTime(label: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (/pm/i.test(match[3]) && hour !== 12) hour += 12;
  if (/am/i.test(match[3]) && hour === 12) hour = 0;
  return { hour, minute };
}

/** The civil date/time in IST for a UTC instant, read off a shifted Date's UTC fields. */
function istParts(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}

function istCivilToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** `YYYY-MM-DD` as it reads in Bangalore. */
export function istDateString(at: Date = new Date()): string {
  const { year, month, day } = istParts(at);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The UTC instant a `YYYY-MM-DD` + `10:00 AM` pair names in Bangalore, or null if malformed. */
export function slotInstant(dateStr: string, timeLabel: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const time = parseSlotTime(timeLabel);
  if (!dateMatch || !time) return null;
  return istCivilToUtc(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    time.hour,
    time.minute,
  );
}

/** The label a stored instant maps back to, for display in listings and emails. */
export function slotLabel(at: Date): string {
  const { hour, minute } = istParts(at);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "Monday, 11 August" — the confirmation copy. */
export function friendlyDate(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(at);
}

export interface WeekWindow {
  /** Inclusive. Monday 00:00 IST, as a UTC instant. */
  start: Date;
  /** Exclusive. The following Monday 00:00 IST. */
  end: Date;
  /** `YYYY-MM-DD` of the Monday, used as a stable key. */
  key: string;
}

/**
 * The Monday-to-Sunday window, in IST, containing `at`. Scarcity copy says "this week", and a
 * week that rolls over at a different instant for the badge than for the booking check is how
 * an availability count and a booking refusal end up disagreeing on a Sunday night.
 */
export function weekOf(at: Date = new Date()): WeekWindow {
  const { year, month, day, weekday } = istParts(at);
  const daysSinceMonday = (weekday + 6) % 7;
  const start = istCivilToUtc(year, month, day - daysSinceMonday);
  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { start, end, key: istDateString(start) };
}

/** Whether a date string is inside the window the picker will accept. */
export function isBookableDate(dateStr: string, now: Date = new Date()): boolean {
  const instant = slotInstant(dateStr, "11:59 PM");
  if (!instant) return false;
  const today = slotInstant(istDateString(now), "12:00 AM");
  if (!today) return false;
  const horizon = today.getTime() + BOOKING_HORIZON_DAYS * MS_PER_DAY;
  return instant.getTime() >= now.getTime() - MS_PER_DAY && instant.getTime() <= horizon;
}
