/**
 * The evening-before reminder run, and the slot housekeeping beside it.
 *
 * Same trick as `notifications.spec.ts`: the server under test has no AgentMail inbox, so every
 * send is refused before the SDK is touched — but `notify()` records recipients on the log row
 * *before* attempting delivery, so what a run would have sent is readable without anything
 * leaving the machine.
 *
 * `CRON_SECRET` is pinned in `E2E_SERVER_ENV` rather than read from `.env.local`: the real one is
 * a production credential, and the endpoint it unlocks mails every visitor with a booking.
 */
import type { APIRequestContext } from "@playwright/test";

import {
  notificationsFor,
  publishedProperties,
  seedViewing,
  setOwnerEmail,
  viewingExists,
} from "../support/db";
import { E2E_CRON_SECRET, E2E_TEAM_INBOX } from "../support/env";
import { expect, test } from "../support/fixtures";
import { istDateIn, istInstant } from "../support/ist";

const CRON_PATH = "/api/cron/viewing-reminders";
const HOUR = 60 * 60 * 1000;

async function aPublishedHome() {
  const [home] = await publishedProperties();
  if (!home) throw new Error("no published listing — run npm run db:seed");
  return home;
}

function runCron(request: APIRequestContext) {
  return request.get(CRON_PATH, { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
}

test.describe("the reminder cron", () => {
  test("refuses a caller without the secret, and mails nobody", async ({
    page,
    identity,
    prisma,
  }) => {
    const home = await aPublishedHome();
    const { enquiryId } = await seedViewing({
      property: home,
      // Tomorrow in Bangalore, resolved through Intl rather than the app's own constant.
      scheduledFor: istInstant(istDateIn(1), "11:00 AM"),
      marker: identity.marker,
      suffix: "a",
      email: `${identity.marker.toLowerCase()}@nivasa.invalid`,
    });

    const noHeader = await page.request.get(CRON_PATH);
    expect(noHeader.status()).toBe(401);

    const wrongSecret = await page.request.get(CRON_PATH, {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrongSecret.status()).toBe(401);

    // The refusal has to be total: a 401 that had already sent the mail would be worthless.
    expect(await notificationsFor(enquiryId)).toEqual([]);
    const viewing = await prisma.viewing.findFirst({ where: { enquiryId } });
    expect(viewing?.reminderSentAt, "a refused run must not stamp anything").toBeNull();
  });

  test("reminds the visitor about tomorrow, and copies the owner", async ({ page, identity }) => {
    const home = await aPublishedHome();
    const owner = `${identity.marker.toLowerCase()}-owner@nivasa.invalid`;
    const visitor = `${identity.marker.toLowerCase()}-visitor@nivasa.invalid`;
    const restore = await setOwnerEmail(home.slug, owner);

    try {
      const { enquiryId } = await seedViewing({
        property: home,
        scheduledFor: istInstant(istDateIn(1), "12:00 PM"),
        marker: identity.marker,
        suffix: "b",
        email: visitor,
      });

      const response = await runCron(page.request);
      expect(response.status()).toBe(200);

      const logs = await notificationsFor(enquiryId);
      expect(logs).toHaveLength(1);
      expect(logs[0].type).toBe("VIEWING_REMINDER");
      // The visitor is the one being reminded; the owner has to open the door and the team wants
      // the audit, so both are copied.
      expect(logs[0].recipient).toBe(visitor);
      expect([...logs[0].cc].sort()).toEqual([E2E_TEAM_INBOX, owner].sort());
    } finally {
      await restore();
    }
  });

  test("a second run the same evening sends nothing more", async ({ page, identity, prisma }) => {
    const home = await aPublishedHome();
    const { enquiryId } = await seedViewing({
      property: home,
      scheduledFor: istInstant(istDateIn(1), "2:00 PM"),
      marker: identity.marker,
      suffix: "c",
      email: `${identity.marker.toLowerCase()}@nivasa.invalid`,
    });

    expect((await runCron(page.request)).status()).toBe(200);
    expect((await runCron(page.request)).status()).toBe(200);

    // `reminderSentAt` is the whole guard. Without it a retried cron — or two overlapping
    // invocations — would tell the same visitor twice about the same appointment.
    expect(await notificationsFor(enquiryId)).toHaveLength(1);
    const viewing = await prisma.viewing.findFirst({ where: { enquiryId } });
    expect(viewing?.reminderSentAt).not.toBeNull();
  });

  test("a viewing with no visitor address still reaches the team", async ({ page, identity }) => {
    const home = await aPublishedHome();
    const { enquiryId } = await seedViewing({
      property: home,
      scheduledFor: istInstant(istDateIn(1), "3:00 PM"),
      marker: identity.marker,
      suffix: "d",
      email: null, // Enquiry.email is nullable — a phone-only lead is ordinary.
    });

    expect((await runCron(page.request)).status()).toBe(200);

    const logs = await notificationsFor(enquiryId);
    expect(logs).toHaveLength(1);
    // Addressed to the team rather than dropped, so somebody can pick up the phone.
    expect(logs[0].recipient).toBe(E2E_TEAM_INBOX);
  });

  test("leaves viewings that are not tomorrow alone", async ({ page, identity }) => {
    const home = await aPublishedHome();
    const { enquiryId } = await seedViewing({
      property: home,
      scheduledFor: istInstant(istDateIn(5), "11:00 AM"),
      marker: identity.marker,
      suffix: "e",
      email: `${identity.marker.toLowerCase()}@nivasa.invalid`,
    });

    expect((await runCron(page.request)).status()).toBe(200);
    expect(await notificationsFor(enquiryId)).toEqual([]);
  });
});

test.describe("releasing cancelled slots", () => {
  test("gives back an hour cancelled well ahead, and keeps one cancelled at short notice", async ({
    page,
    identity,
  }) => {
    const home = await aPublishedHome();
    const now = Date.now();

    // Exact instants rather than picker slots: the rule is about the clock, and writing straight
    // to the database is the only way to arrange a CANCELLED viewing at all.
    const faraway = await seedViewing({
      property: home,
      scheduledFor: new Date(now + 48 * HOUR),
      marker: identity.marker,
      suffix: "f",
      status: "CANCELLED",
    });
    const imminent = await seedViewing({
      property: home,
      scheduledFor: new Date(now + 2 * HOUR),
      marker: identity.marker,
      suffix: "g",
      status: "CANCELLED",
    });

    expect((await runCron(page.request)).status()).toBe(200);

    expect(await viewingExists(faraway.viewingId), "48h out — back on sale").toBe(false);
    // Inside the floor an owner may already have arranged their day around the original booking,
    // so the hour stays blocked rather than being resold under them.
    expect(await viewingExists(imminent.viewingId), "2h out — still held").toBe(true);
  });

  test("keeps the lead even when its slot is released", async ({ page, identity, prisma }) => {
    const home = await aPublishedHome();
    const { enquiryId, viewingId } = await seedViewing({
      property: home,
      scheduledFor: new Date(Date.now() + 72 * HOUR),
      marker: identity.marker,
      suffix: "h",
      status: "CANCELLED",
    });

    expect((await runCron(page.request)).status()).toBe(200);

    expect(await viewingExists(viewingId)).toBe(false);
    // The viewing goes; the enquiry is history, and its snapshotted propertyName is what makes it
    // readable a year later.
    const enquiry = await prisma.enquiry.findUnique({ where: { id: enquiryId } });
    expect(enquiry, "releasing a slot must not delete the lead").not.toBeNull();
    expect(enquiry?.propertyName).toBe(home.name);
  });
});
