/**
 * "Add to calendar" for a confirmed viewing.
 *
 * Built from the instant the *server* confirmed, not from what the visitor picked — the two
 * differ whenever a slot was taken between the click and the write, and a calendar entry for an
 * appointment that was refused is worse than none.
 *
 * Client-safe by construction: no node: imports, so this file can be pulled into the bundle —
 * and now also server-safe, which is what lets the reminder mail attach the same event the
 * browser offers.
 */

const VIEWING_MINUTES = 45;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * UTC, with the `Z` that makes it absolute.
 *
 * This was previously a *floating* local time built from `getHours()`, which is only accidentally
 * right: correct in a Bangalore browser, five and a half hours wrong when the same function runs
 * on Vercel, and wrong for any visitor abroad even in the browser. A site visit is a physical
 * appointment at one instant, so the honest encoding is the instant — every calendar then renders
 * it in whatever zone the reader is actually in.
 */
function stamp(dt: Date): string {
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`
  );
}

function escapeIcs(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

/**
 * The calendar entry itself.
 *
 * Separate from `buildIcsHref` so the same event can be attached to an email as a file — a
 * `data:` URI is a browser affordance, not a document. `UID` is derived from the instant and the
 * listing rather than randomised, so the reminder's attachment and the one downloaded at booking
 * are the *same event*: a calendar that has seen both shows one appointment, not two.
 */
export function buildIcsContent(
  scheduledForIso: string,
  propertyName: string,
  kind: "SITE_VISIT" | "OWNER_CALL" | string,
): string | null {
  const start = new Date(scheduledForIso);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + VIEWING_MINUTES * 60_000);

  const title =
    kind === "OWNER_CALL"
      ? `Call with owner — ${propertyName}`
      : `Site visit — ${propertyName}`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nivasa//Enquiry//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${start.getTime()}-${Math.abs(hash(propertyName))}@nivasa.in`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeIcs(title)}`,
    "DESCRIPTION:Arranged through Nivasa. The owner will be in touch to confirm.",
    `LOCATION:${escapeIcs(`${propertyName}, Bangalore`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function buildIcsHref(
  scheduledForIso: string,
  propertyName: string,
  kind: "SITE_VISIT" | "OWNER_CALL" | string,
): string | null {
  const content = buildIcsContent(scheduledForIso, propertyName, kind);
  if (content === null) return null;
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(content);
}

/** Small, stable, and only ever used to make a UID unique per property. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h << 5) - h + value.charCodeAt(i);
  return h | 0;
}

export function icsFileName(propertyName: string): string {
  const slug = propertyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `nivasa-${slug || "viewing"}.ics`;
}
