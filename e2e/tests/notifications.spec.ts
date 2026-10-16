/**
 * What the app decides to send when a lead arrives, and who it decides to send it to.
 *
 * This suite can never put a message on the wire: `E2E_SERVER_ENV` blanks `AGENTMAIL_INBOX_ID`,
 * and `agentMailConfigured()` needs both halves of the credential, so every send is refused
 * before the SDK is touched. That is precisely what makes the routing assertable — `notify()`
 * writes the recipient and the CC to the log row *before* attempting delivery, so a row records
 * who a message would have reached whether or not a provider exists. The specs read that row.
 *
 * The addresses are all `.invalid`, which RFC 2606 reserves and no resolver will ever answer, so
 * a run on a machine with a fully populated `.env.local` is no more dangerous than one without.
 */
import type { APIRequestContext } from "@playwright/test";

import {
  enquiryByReference,
  notificationsFor,
  publishedProperties,
  setOwnerEmail,
} from "../support/db";
import { E2E_TEAM_INBOX } from "../support/env";
import type { Identity } from "../support/fixtures";
import { expect, test } from "../support/fixtures";
import { istDateIn } from "../support/ist";

/** The listing the specs in this file borrow. Any published home will do. */
async function aPublishedHome() {
  const [home] = await publishedProperties();
  if (!home) throw new Error("no published listing — run npm run db:seed");
  return home;
}

/** Submits a message about a home and returns the notification rows it produced. */
async function messageAbout(request: APIRequestContext, slug: string, identity: Identity) {
  const response = await request.post("/api/enquiries", {
    data: {
      kind: "MESSAGE",
      propertySlug: slug,
      name: identity.name,
      phone: identity.phone,
      email: identity.email,
      message: `${identity.marker} asking about this home.`,
    },
  });
  expect(response.status()).toBe(201);

  const { reference } = (await response.json()).data;
  const enquiry = await enquiryByReference(reference);
  expect(enquiry, "the enquiry the notification is about").not.toBeNull();

  return { reference, logs: await notificationsFor(enquiry!.id) };
}

test.describe("who a lead is sent to", () => {
  test("an enquiry about a home copies that home's owner", async ({ page, identity }) => {
    const home = await aPublishedHome();
    const owner = `${identity.marker.toLowerCase()}-owner@nivasa.invalid`;
    const restore = await setOwnerEmail(home.slug, owner);

    try {
      const { logs } = await messageAbout(page.request, home.slug, identity);

      expect(logs).toHaveLength(1);
      expect(logs[0].recipient).toBe(E2E_TEAM_INBOX);
      // The promise the listing page makes — "your enquiry reaches them, no middlemen" — is this
      // line, and nothing else in the app asserts it.
      expect(logs[0].cc).toEqual([owner]);
      expect(logs[0].type).toBe("ENQUIRY_RECEIVED");
    } finally {
      await restore();
    }
  });

  test("a home with no owner address on file copies nobody", async ({ page, identity }) => {
    const home = await aPublishedHome();
    const restore = await setOwnerEmail(home.slug, null);

    try {
      const { logs } = await messageAbout(page.request, home.slug, identity);

      expect(logs).toHaveLength(1);
      expect(logs[0].recipient).toBe(E2E_TEAM_INBOX);
      // A home the curation team sourced itself has no owner mailbox. The team still hears about
      // it; the CC is simply dropped rather than becoming an empty-string recipient.
      expect(logs[0].cc).toEqual([]);
    } finally {
      await restore();
    }
  });

  test("a general enquiry names no home, so it copies nobody", async ({ page, identity }) => {
    const home = await aPublishedHome();
    // Deliberately with an owner on file: a GENERAL enquiry must copy nobody *because it has no
    // property*, not because no owner happened to be set.
    const restore = await setOwnerEmail(home.slug, `${identity.marker.toLowerCase()}@nivasa.invalid`);

    try {
      const response = await page.request.post("/api/enquiries", {
        data: {
          kind: "GENERAL",
          name: identity.name,
          phone: identity.phone,
          email: identity.email,
          message: `${identity.marker} general question.`,
        },
      });
      expect(response.status()).toBe(201);

      const enquiry = await enquiryByReference((await response.json()).data.reference);
      expect(enquiry!.propertyId).toBeNull();

      const logs = await notificationsFor(enquiry!.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].cc).toEqual([]);
    } finally {
      await restore();
    }
  });

  test("an owner who is also the team inbox is not copied on their own message", async ({
    page,
    identity,
  }) => {
    const home = await aPublishedHome();
    // Upper-cased on purpose: addresses are case-insensitive in the part that matters here, and a
    // team inbox doubling as the owner's is ordinary configuration rather than a mistake — this
    // project's own NIVASA_TEAM_EMAIL and AGENTMAIL_INBOX_ID are already the same value.
    const restore = await setOwnerEmail(home.slug, E2E_TEAM_INBOX.toUpperCase());

    try {
      const { logs } = await messageAbout(page.request, home.slug, identity);

      expect(logs).toHaveLength(1);
      expect(logs[0].recipient).toBe(E2E_TEAM_INBOX);
      expect(logs[0].cc, "nobody should receive one enquiry twice").toEqual([]);
    } finally {
      await restore();
    }
  });

  test("a booked viewing copies the owner too, and is recorded as a viewing", async ({
    page,
    identity,
  }) => {
    const home = await aPublishedHome();
    const owner = `${identity.marker.toLowerCase()}-owner@nivasa.invalid`;
    const restore = await setOwnerEmail(home.slug, owner);

    try {
      // Far enough out to be inside the horizon and clear of the current, partly-past week.
      const date = istDateIn(9);
      const response = await page.request.post("/api/enquiries", {
        data: {
          kind: "SITE_VISIT",
          propertySlug: home.slug,
          name: identity.name,
          phone: identity.phone,
          email: identity.email,
          date,
          time: "11:00 AM",
        },
      });

      // Another spec may hold that hour or have filled that week; either is a real answer about
      // availability and not about notifications, so this test only asserts when it got the slot.
      test.skip(response.status() !== 201, `slot unavailable (${response.status()})`);

      const enquiry = await enquiryByReference((await response.json()).data.reference);
      const logs = await notificationsFor(enquiry!.id);

      expect(logs).toHaveLength(1);
      // The owner is the person who has to open the door, so a booked visit is the case where
      // the copy matters most.
      expect(logs[0].cc).toEqual([owner]);
      expect(logs[0].type).toBe("VIEWING_BOOKED");
      expect(logs[0].subject).toContain(home.name);
    } finally {
      await restore();
    }
  });
});

test.describe("with no email provider configured", () => {
  test("the lead is still taken, and the row says why nothing was sent", async ({
    page,
    identity,
  }) => {
    const home = await aPublishedHome();
    const restore = await setOwnerEmail(home.slug, `${identity.marker.toLowerCase()}@nivasa.invalid`);

    try {
      const { reference, logs } = await messageAbout(page.request, home.slug, identity);

      // The whole point of `notify()` never throwing: the enquiry a person typed in survives a
      // messaging layer that cannot deliver.
      expect(reference).toMatch(/^NIV-[A-Z0-9]{6}$/);

      expect(logs[0].status).toBe("SKIPPED");
      expect(logs[0].error).toBe("No email provider is configured");
      // SKIPPED, not FAILED — "we chose not to send" and "we tried and could not" are different
      // things to read at 9am, and /dashboard/outbox shows this reason verbatim.
      expect(logs[0].body).toContain(identity.name);
    } finally {
      await restore();
    }
  });
});
