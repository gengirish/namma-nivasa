import {
  bookSlot,
  bookedInWeek,
  emptyWeekDate,
  enquiryByReference,
  fillWeek,
  propertyBySlug,
  publishedProperties,
} from "../support/db";
import { expect, test } from "../support/fixtures";
import { istFieldsOf, istInstant, istToday, mondayOf } from "../support/ist";
import {
  cardFor,
  chooseDate,
  enquiryModal,
  gotoHome,
  openEnquiryModal,
  openProperty,
  receiptReference,
  slotButton,
  submitEnquiry,
} from "../support/ui";

/**
 * Booking a viewing — the only part of this site that spends something scarce.
 *
 * The invariants under test, in the order they matter:
 *
 *   1. A booking that is confirmed to a visitor exists in the database, at the instant they
 *      picked, with an enquiry beside it. Never one without the other.
 *   2. A slot somebody already holds is never offered, and never bookable even if it is.
 *   3. The weekly cap is counted against the week being booked, not the week it is today.
 *
 * Preconditions are arranged straight in the database rather than by driving a second browser:
 * the race that matters happens inside a single INSERT, and simulating it through two UIs would
 * test the test harness rather than the unique index.
 */

/** The listing with the most head-room, so a run never competes with itself for slots. */
async function roomiestProperty() {
  const all = await publishedProperties();
  const pick = [...all].sort((a, b) => b.weeklyViewingSlots - a.weeklyViewingSlots)[0];
  return propertyBySlug(pick.slug);
}

/** The listing with the smallest cap — the cheapest one to fill up on purpose. */
async function tightestProperty() {
  const all = await publishedProperties();
  const pick = [...all].sort((a, b) => a.weeklyViewingSlots - b.weeklyViewingSlots)[0];
  return propertyBySlug(pick.slug);
}

async function firstAvailableSlot(page: import("@playwright/test").Page): Promise<string> {
  const buttons = enquiryModal(page).locator("button[aria-pressed]:not([disabled])");
  await expect(buttons.first()).toBeVisible();
  const label = await buttons.first().textContent();
  if (!label) throw new Error("the picker offered a slot with no label");
  return label.trim();
}

test.describe("booking a site visit", () => {
  test("confirms only what the database accepted, and stores it as a UTC instant", async ({
    page,
    identity,
  }) => {
    const property = await roomiestProperty();
    const date = await emptyWeekDate(property.id, 8, istToday());

    await gotoHome(page);
    await openProperty(page, property.name);
    await openEnquiryModal(page, "call");
    await chooseDate(page, date);

    const time = await firstAvailableSlot(page);
    await slotButton(page, time).click();
    await expect(slotButton(page, time)).toHaveAttribute("aria-pressed", "true");

    await enquiryModal(page).locator("#nv-name").fill(identity.name);
    await enquiryModal(page).locator("#nv-phone").fill(identity.phone);
    await enquiryModal(page).locator("#nv-email").fill(identity.email);

    expect(await submitEnquiry(page, "Request Visit")).toBe(201);

    // The receipt is the server's answer, not the client's optimism.
    await expect(enquiryModal(page).getByRole("heading")).toContainText(/You.?re all set/);
    const reference = await receiptReference(page);
    await expect(enquiryModal(page)).toContainText(property.name);
    await expect(enquiryModal(page).getByRole("link", { name: "Add to calendar" })).toHaveAttribute(
      "href",
      /^data:text\/calendar/,
    );

    const enquiry = await enquiryByReference(reference);
    expect(enquiry).not.toBeNull();
    expect(enquiry!.kind).toBe("SITE_VISIT");
    expect(enquiry!.status).toBe("SCHEDULED");
    expect(enquiry!.propertyId).toBe(property.id);
    // Snapshotted, so the enquiry still reads correctly if the listing is renamed or archived.
    expect(enquiry!.propertyName).toBe(property.name);
    // Normalised on the way in, so four spellings of one number collide on the index.
    expect(enquiry!.phone).toBe(`+91${identity.phone}`);

    // The row that actually holds the hour. Compared through tzdata rather than the app's
    // hardcoded +05:30, so this is an independent check that IST was converted correctly.
    expect(enquiry!.viewing).not.toBeNull();
    expect(enquiry!.viewing!.scheduledFor.toISOString()).toBe(istInstant(date, time).toISOString());
    expect(istFieldsOf(enquiry!.viewing!.scheduledFor)).toEqual({ date, time });
  });

  test("a booked hour comes off that week's count immediately", async ({ page, identity }) => {
    const property = await roomiestProperty();
    const today = istToday();
    const date = await emptyWeekDate(property.id, 8, today);
    test.skip(
      mondayOf(date) === mondayOf(today),
      "the badge counts the current week; this booking is in a later one",
    );

    await gotoHome(page);
    const before = property.weeklyViewingSlots - (await bookedInWeek(property.id, date));

    await openProperty(page, property.name);
    await openEnquiryModal(page, "call");
    await chooseDate(page, date);
    await expect(enquiryModal(page)).toContainText(
      `${before} of ${property.weeklyViewingSlots} slots left that week`,
    );

    const time = await firstAvailableSlot(page);
    await slotButton(page, time).click();
    await enquiryModal(page).locator("#nv-name").fill(identity.name);
    await enquiryModal(page).locator("#nv-phone").fill(identity.phone);
    expect(await submitEnquiry(page, "Request Visit")).toBe(201);

    expect(await bookedInWeek(property.id, date)).toBe(
      property.weeklyViewingSlots - before + 1,
    );

    // Re-open the picker for the same date: the server now counts one fewer.
    await enquiryModal(page).getByRole("button", { name: "Done" }).click();
    await openEnquiryModal(page, "call");
    await chooseDate(page, date);
    await expect(enquiryModal(page)).toContainText(
      `${before - 1} of ${property.weeklyViewingSlots} slots left that week`,
    );
  });

  test("an owner call books a slot too, and says the owner will ring", async ({
    page,
    identity,
  }) => {
    const property = await roomiestProperty();
    const date = await emptyWeekDate(property.id, 15, istToday());

    await gotoHome(page);
    await openProperty(page, property.name);
    await openEnquiryModal(page, "phonecall");
    await expect(enquiryModal(page).getByRole("heading")).toContainText("Schedule a Call");

    await chooseDate(page, date);
    const time = await firstAvailableSlot(page);
    await slotButton(page, time).click();
    await enquiryModal(page).locator("#nv-name").fill(identity.name);
    await enquiryModal(page).locator("#nv-phone").fill(identity.phone);
    expect(await submitEnquiry(page, "Request Call")).toBe(201);

    await expect(enquiryModal(page)).toContainText("will call you at the time below");
    const enquiry = await enquiryByReference(await receiptReference(page));
    expect(enquiry!.kind).toBe("OWNER_CALL");
    expect(enquiry!.viewing!.scheduledFor.toISOString()).toBe(istInstant(date, time).toISOString());
  });
});

test.describe("a slot somebody already holds", () => {
  test("is offered struck through and cannot be chosen", async ({ page, identity }) => {
    const property = await roomiestProperty();
    const date = await emptyWeekDate(property.id, 22, istToday());
    const taken = "11:00 AM";
    await bookSlot(property, date, taken, identity.marker);

    await gotoHome(page);
    await openProperty(page, property.name);
    await openEnquiryModal(page, "call");
    await chooseDate(page, date);

    const button = slotButton(page, taken);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", "Already booked");
    await expect(button).toHaveCSS("text-decoration-line", "line-through");

    // Every other time on the day is still open.
    await expect(slotButton(page, "10:00 AM")).toBeEnabled();
  });

  /**
   * The guard is the unique index on `(propertyId, scheduledFor)`, not a read: two visitors who
   * loaded the picker at the same moment both see the slot free, both INSERT, and Postgres
   * refuses one. This drives that directly, because it is the only way to be inside the window.
   */
  test("refuses the second of two simultaneous bookings, and says which one lost", async ({
    page,
    playwright,
    baseURL,
    identity,
  }) => {
    const property = await roomiestProperty();
    const date = await emptyWeekDate(property.id, 29, istToday());
    const time = "3:00 PM";

    const body = {
      kind: "SITE_VISIT",
      propertySlug: property.slug,
      name: identity.name,
      phone: identity.phone,
      date,
      time,
    };

    // A second address, so the loser is refused by the index rather than by the rate limiter.
    const rival = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-real-ip": "198.51.100.11" },
    });

    const [a, b] = await Promise.all([
      page.request.post("/api/enquiries", { data: body }),
      rival.post("/api/enquiries", { data: { ...body, name: `${identity.marker} rival` } }),
    ]);
    // Read both bodies before disposing the rival context — disposing it drops its response.
    const outcomes = [
      { status: a.status(), body: await a.json() },
      { status: b.status(), body: await b.json() },
    ];
    await rival.dispose();

    expect(outcomes.map((o) => o.status).sort()).toEqual([201, 409]);

    const loser = outcomes.find((o) => o.status === 409)!;
    expect(loser.body.error).toBe("Someone just took that slot — pick another time");

    // Exactly one hour was taken, not two.
    expect(await bookedInWeek(property.id, date)).toBe(1);
  });

  /**
   * Cancelling does not hand the hour to the next visitor — an owner who was already told about a
   * visit should not have the same time resold from under them.
   *
   * Note the asymmetry this pins down: `dayAvailability()` excludes CANCELLED rows, so the picker
   * still shows the time as free, while the unique index still refuses the INSERT. The refusal is
   * the invariant that protects the owner; the picker offering it is a wart worth knowing about.
   */
  test("a cancelled viewing keeps its hour", async ({ page, identity, prisma }) => {
    const property = await roomiestProperty();
    const date = await emptyWeekDate(property.id, 36, istToday());
    const time = "4:00 PM";

    const { reference } = await bookSlot(property, date, time, identity.marker);
    await prisma.viewing.updateMany({
      where: { enquiry: { reference } },
      data: { status: "CANCELLED" },
    });

    const response = await page.request.post("/api/enquiries", {
      data: {
        kind: "SITE_VISIT",
        propertySlug: property.slug,
        name: identity.name,
        phone: identity.phone,
        date,
        time,
      },
    });

    expect(response.status()).toBe(409);
    expect((await response.json()).error).toBe("Someone just took that slot — pick another time");
  });
});

test.describe("the weekly cap", () => {
  test("a full week is refused, and says to try another one", async ({ page, identity }) => {
    const property = await tightestProperty();
    const date = await emptyWeekDate(property.id, 43, istToday());
    await fillWeek(property, date, identity.marker);

    await gotoHome(page);
    await openProperty(page, property.name);
    await openEnquiryModal(page, "call");
    await chooseDate(page, date);

    await expect(enquiryModal(page)).toContainText(
      "That week is fully booked — try a date in another week",
    );
    for (const time of ["10:00 AM", "2:00 PM", "5:00 PM"]) {
      await expect(slotButton(page, time)).toBeDisabled();
    }

    // And the server says the same thing to anyone who posts anyway.
    const response = await page.request.post("/api/enquiries", {
      data: {
        kind: "SITE_VISIT",
        propertySlug: property.slug,
        name: identity.name,
        phone: identity.phone,
        date,
        time: "10:00 AM",
      },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toBe(
      "That week is fully booked — pick a date in another week",
    );
  });

  /**
   * The invariant: the cap is checked against `weekOf(scheduledFor)`, never `weekOf(now)`. A
   * visitor booking three weeks out must not be turned away because a nearer week filled up.
   *
   * Filled a few weeks ahead rather than in the current week on purpose — this must be provable
   * on a Sunday evening, when the current week has no bookable hours left to fill.
   */
  test("filling one week leaves the week after it open", async ({ page, identity }) => {
    const property = await tightestProperty();
    const today = istToday();

    const full = await emptyWeekDate(property.id, 8, today);
    await fillWeek(property, full, identity.marker);
    const next = await emptyWeekDate(property.id, 15, today);
    expect(mondayOf(next), "the two dates must be in different weeks").not.toBe(mondayOf(full));

    const post = (date: string) =>
      page.request.post("/api/enquiries", {
        data: {
          kind: "SITE_VISIT",
          propertySlug: property.slug,
          name: identity.name,
          phone: identity.phone,
          date,
          time: "10:00 AM",
        },
      });

    const refused = await post(full);
    expect(refused.status()).toBe(409);

    const accepted = await post(next);
    expect(accepted.status(), "the following week was refused along with the full one").toBe(201);
  });

  /**
   * The card badge and the action button do speak about the *current* week, which is why a
   * listing can read "3 slots left" on a Sunday while next week is already full. Skipped rather
   * than faked when the current week has no bookable hours left to fill — late on a Sunday there
   * is no honest way to arrange the precondition.
   */
  test("a listing with nothing left this week says so and stops taking bookings", async ({
    page,
    identity,
  }) => {
    const property = await tightestProperty();

    try {
      await fillWeek(property, istToday(), identity.marker);
    } catch {
      test.skip(true, "no bookable hours left in the current IST week to fill it with");
    }

    await gotoHome(page);
    await expect(cardFor(page, property.name).getByText("Fully booked this week")).toBeVisible();

    await openProperty(page, property.name);
    const button = page.getByRole("button", { name: "No slots left this week" });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  });
});
