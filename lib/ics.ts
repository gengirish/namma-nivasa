/**
 * "Add to calendar" for a confirmed viewing.
 *
 * Built in the browser from the instant the *server* confirmed, not from what the visitor
 * picked — the two differ whenever a slot was taken between the click and the write, and a
 * calendar entry for an appointment that was refused is worse than none.
 *
 * Client-safe by construction: no node: imports, so this file can be pulled into the bundle.
 */

const VIEWING_MINUTES = 45;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Floating local time — the recipient's calendar shows the hour they were told. */
function stamp(dt: Date): string {
  return (
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
  );
}

function escapeIcs(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

export function buildIcsHref(
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

  const lines = [
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
  ];
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
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
