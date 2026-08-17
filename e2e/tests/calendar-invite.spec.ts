import { buildIcsContent, buildIcsHref, icsFileName } from "../../lib/ics";
import { notificationsFor, publishedProperties, seedViewing } from "../support/db";
import { E2E_CRON_SECRET } from "../support/env";
import { expect, test } from "../support/fixtures";
import { istDateIn, istInstant } from "../support/ist";

/**
 * The calendar invite, on both paths it travels.
 *
 * `booking.spec.ts` already pins the browser half — the confirmation panel offers an
 * `Add to calendar` link whose href is a `data:text/calendar` URI. What was never asserted is the
 * *content*, and the content is where the bug was: `lib/ics.ts` used to emit a floating local time
 * built from `getHours()`, which is right in a Bangalore browser and five and a half hours wrong
 * on Vercel, where the reminder mail is composed. A visitor abroad got a third answer again.
 *
 * These call `buildIcsContent()` directly rather than through a route, because the fix is a
 * property of the string and nothing downstream records it: `NotificationLog` has columns for
 * recipients, subject and body, and none for an attachment. The reminder test below asserts the
 * only trace the database keeps — that the run said an invite was attached.
 *
 * The expected stamp is computed through `Intl` (`e2e/support/ist.ts`), never through
 * `IST_OFFSET_MINUTES`. A test that reused the app's own constant would agree with it even if the
 * constant were wrong, which is the whole reason that support file exists.
 */

const NAME = "Verdant House";

/** `20260817T063000Z` — what a correct DTSTART looks like for a 12:00 IST appointment. */
function utcStamp(instant: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${instant.getUTCFullYear()}${p(instant.getUTCMonth() + 1)}${p(instant.getUTCDate())}` +
    `T${p(instant.getUTCHours())}${p(instant.getUTCMinutes())}00Z`
  );
}

function fieldOf(ics: string, field: string): string {
  const line = ics.split("\r\n").find((l) => l.startsWith(`${field}:`));
  if (!line) throw new Error(`no ${field} in:\n${ics}`);
  return line.slice(field.length + 1);
}

test.describe("the .ics a viewing produces", () => {
  test("encodes an absolute instant, not a floating local time", async () => {
    // Noon in Bangalore, resolved against tzdata.
    const start = istInstant(istDateIn(3), "12:00 PM");
    const ics = buildIcsContent(start.toISOString(), NAME, "SITE_VISIT");
    expect(ics).not.toBeNull();

    const dtstart = fieldOf(ics!, "DTSTART");
    const dtend = fieldOf(ics!, "DTEND");

    // The `Z` is the whole point: it is what makes the same file render as 12:00 for a reader in
    // Bangalore and 07:30 for one in London, rather than as noon for everybody.
    expect(dtstart).toMatch(/Z$/);
    expect(dtend).toMatch(/Z$/);
    expect(dtstart).toBe(utcStamp(start));
    // A site visit is 45 minutes.
    expect(dtend).toBe(utcStamp(new Date(start.getTime() + 45 * 60_000)));

    expect(fieldOf(ics!, "SUMMARY")).toBe(`Site visit — ${NAME}`);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  test("is the same event whether it is downloaded or attached", async () => {
    const start = istInstant(istDateIn(4), "11:00 AM");
    const content = buildIcsContent(start.toISOString(), NAME, "SITE_VISIT")!;
    const href = buildIcsHref(start.toISOString(), NAME, "SITE_VISIT")!;

    expect(href.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);

    /**
     * The UID is derived from the instant and the listing rather than randomised, so a calendar
     * that receives both the booking download and the reminder attachment shows one appointment
     * instead of two. Randomising it would look harmless and double-book every visitor's diary.
     */
    const uid = fieldOf(content, "UID");
    const second = buildIcsContent(start.toISOString(), NAME, "SITE_VISIT")!;
    expect(fieldOf(second, "UID")).toBe(uid);
    expect(decodeURIComponent(href.split(",").slice(1).join(","))).toContain(`UID:${uid}`);
  });

  test("titles an owner call differently, and names the file after the home", async () => {
    const start = istInstant(istDateIn(5), "3:00 PM");
    const call = buildIcsContent(start.toISOString(), NAME, "OWNER_CALL")!;
    expect(fieldOf(call, "SUMMARY")).toBe(`Call with owner — ${NAME}`);

    expect(icsFileName(NAME)).toBe("nivasa-verdant-house.ics");
    expect(icsFileName("!!!")).toBe("nivasa-viewing.ics");
  });

  test("refuses an instant it cannot parse rather than emitting a broken event", async () => {
    expect(buildIcsContent("not a date", NAME, "SITE_VISIT")).toBeNull();
    expect(buildIcsHref("not a date", NAME, "SITE_VISIT")).toBeNull();
  });
});

test.describe("the reminder mail", () => {
  test("tells the visitor an invite is attached", async ({ page, identity }) => {
    const [home] = await publishedProperties();
    const { enquiryId } = await seedViewing({
      property: home,
      scheduledFor: istInstant(istDateIn(1), "4:00 PM"),
      marker: identity.marker,
      suffix: "ics",
      email: `${identity.marker.toLowerCase()}@nivasa.invalid`,
    });

    const response = await page.request.get("/api/cron/viewing-reminders", {
      headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
    });
    expect(response.status()).toBe(200);

    const [log] = await notificationsFor(enquiryId);
    expect(log.type).toBe("VIEWING_REMINDER");
    // The only trace the schema keeps of the attachment — `NotificationLog` has no column for it.
    // If `buildIcsContent()` ever returns null for a real viewing, this line disappears and the
    // mail quietly promises nothing.
    expect(log.body).toContain("A calendar invite is attached.");
  });
});
