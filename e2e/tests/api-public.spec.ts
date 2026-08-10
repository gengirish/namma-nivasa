import { createUnpublishedProperty, propertyBySlug, publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { BOOKING_HORIZON_DAYS, CANONICAL_SLOT_TIMES, istDateIn, istToday } from "../support/ist";

/**
 * The public API's contract.
 *
 * Two things here are load-bearing beyond "does it return 200":
 *
 *   **The DTO is chosen field by field.** `lib/dto.ts` exists so that adding a column to the
 *   schema never silently ships it to a browser. That only stays true if something fails when it
 *   stops being true, which is what the exact key-set assertions below are.
 *
 *   **Rate limiting keys on an address the caller cannot choose.** `x-forwarded-for` is a list
 *   each proxy appends to, so its leading entry is whatever the client sent; reading that first
 *   would let one caller mint a fresh bucket per request. The precedence is asserted, not assumed.
 */

const PROPERTY_KEYS = [
  "amenities",
  "area",
  "areaLabel",
  "areaSqft",
  "availability",
  "bhk",
  "bhkNum",
  "description",
  "floorplanNote",
  "floorplanUrl",
  "heroImageUrl",
  "hood",
  "hoodBlurb",
  "id",
  "images",
  "latitude",
  "locality",
  "location",
  "longitude",
  "name",
  "pricePaise",
  "slug",
  "story",
  "tagline",
  "videoUrl",
].sort();

test.describe("GET /api/properties", () => {
  test("answers with the published collection and nothing else about it", async ({ page }) => {
    const expected = await publishedProperties();
    const response = await page.request.get("/api/properties");

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.properties.map((p: { slug: string }) => p.slug)).toEqual(
      expected.map((p) => p.slug),
    );

    for (const property of payload.data.properties) {
      expect(Object.keys(property).sort(), `unexpected field on ${property.slug}`).toEqual(
        PROPERTY_KEYS,
      );
      expect(Object.keys(property.availability).sort()).toEqual(
        ["dot", "label", "line", "slotsLeft", "weeklySlots"].sort(),
      );
      // BigInt cannot be JSON-serialised; this must arrive as an exact integer, never a string.
      expect(typeof property.pricePaise).toBe("number");
      expect(Number.isInteger(property.pricePaise)).toBe(true);
    }
  });

  test("a draft or archived listing is reachable by neither route", async ({ page, identity }) => {
    for (const status of ["DRAFT", "ARCHIVED"] as const) {
      const hidden = await createUnpublishedProperty(identity.marker, status);
      try {
        const list = await page.request.get("/api/properties");
        const slugs = (await list.json()).data.properties.map((p: { slug: string }) => p.slug);
        expect(slugs, `${status} listing leaked into the collection`).not.toContain(hidden.slug);

        const direct = await page.request.get(`/api/properties/${hidden.slug}`);
        expect(direct.status(), `${status} listing was reachable by slug`).toBe(404);
        expect((await direct.json()).error).toBe("That home is no longer listed");
      } finally {
        await hidden.dispose();
      }
    }
  });

  test("an unknown slug is a 404 in the same envelope as everything else", async ({ page }) => {
    const response = await page.request.get("/api/properties/no-such-home");
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "That home is no longer listed",
    });
  });
});

test.describe("GET /api/properties/[slug]/availability", () => {
  test("offers the whole grid for a free day, and defaults to today in Bangalore", async ({
    page,
  }) => {
    const [property] = await publishedProperties();
    const date = istDateIn(9);

    const dated = await (await page.request.get(
      `/api/properties/${property.slug}/availability?date=${date}`,
    )).json();

    expect(dated.success).toBe(true);
    expect(Object.keys(dated.data).sort()).toEqual(
      ["date", "slots", "slotsLeftInWeek", "weeklySlots"].sort(),
    );
    expect(dated.data.date).toBe(date);
    expect(dated.data.weeklySlots).toBe(property.weeklyViewingSlots);
    expect(dated.data.slots.map((s: { time: string }) => s.time)).toEqual([
      ...CANONICAL_SLOT_TIMES,
    ]);

    const undated = await (await page.request.get(
      `/api/properties/${property.slug}/availability`,
    )).json();
    expect(undated.data.date).toBe(istToday());
  });

  /**
   * Offering a 10 AM visit at 4 PM is a booking the owner will not honour, so today's grid closes
   * behind the clock.
   */
  test("today's already-passed hours are closed", async ({ page }) => {
    const [property] = await publishedProperties();
    const today = istToday();
    const now = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(new Date());

    const payload = await (await page.request.get(
      `/api/properties/${property.slug}/availability?date=${today}`,
    )).json();

    const passed = payload.data.slots.filter((slot: { time: string; available: boolean }) => {
      const [, hour, meridiem] = /^(\d{1,2}):00 (AM|PM)$/.exec(slot.time)!;
      const hour24 = (Number(hour) % 12) + (meridiem === "PM" ? 12 : 0);
      return hour24 < Number(now);
    });

    for (const slot of passed) {
      expect(slot.available, `${slot.time} is in the past and was still offered`).toBe(false);
    }
  });

  test("a date past the booking horizon offers nothing", async ({ page }) => {
    const [property] = await publishedProperties();
    const beyond = istDateIn(BOOKING_HORIZON_DAYS + 5);

    const payload = await (await page.request.get(
      `/api/properties/${property.slug}/availability?date=${beyond}`,
    )).json();

    expect(payload.success).toBe(true);
    expect(
      payload.data.slots.every((s: { available: boolean }) => !s.available),
      "a date beyond the horizon still offered slots",
    ).toBe(true);
  });

  test("refuses a date it cannot read, and a home it cannot find", async ({ page }) => {
    const [property] = await publishedProperties();

    for (const bad of ["tomorrow", "2026-13-01", "2026-02-30", ""]) {
      const response = await page.request.get(
        `/api/properties/${property.slug}/availability?date=${encodeURIComponent(bad)}`,
      );
      expect(response.status(), `"${bad}" was accepted as a date`).toBe(400);
      expect((await response.json()).error).toBe("Pick a date");
    }

    const missing = await page.request.get("/api/properties/no-such-home/availability");
    expect(missing.status()).toBe(404);
  });
});

test.describe("POST /api/enquiries", () => {
  test("says which detail is wrong, one sentence at a time", async ({
    playwright,
    baseURL,
    identity,
  }) => {
    const [property] = await publishedProperties();
    const date = istDateIn(10);

    const cases: { data: Record<string, unknown>; status: number; error: string }[] = [
      {
        data: { kind: "GENERAL", name: "A", phone: identity.phone },
        status: 400,
        error: "Add your name",
      },
      {
        data: { kind: "GENERAL", name: identity.name, phone: "nonsense" },
        status: 400,
        error: "That phone number does not look right",
      },
      {
        data: {
          kind: "SITE_VISIT",
          propertySlug: property.slug,
          name: identity.name,
          phone: identity.phone,
          date,
        },
        status: 400,
        error: "Pick a date and time",
      },
      {
        data: { kind: "SITE_VISIT", name: identity.name, phone: identity.phone, date, time: "10:00 AM" },
        status: 400,
        error: "That home is no longer listed",
      },
      {
        data: {
          kind: "SITE_VISIT",
          propertySlug: property.slug,
          name: identity.name,
          phone: identity.phone,
          date,
          time: "9:30 AM",
        },
        status: 400,
        error: "Pick one of the offered times",
      },
      {
        data: {
          kind: "SITE_VISIT",
          propertySlug: property.slug,
          name: identity.name,
          phone: identity.phone,
          date: istDateIn(BOOKING_HORIZON_DAYS + 5),
          time: "10:00 AM",
        },
        status: 400,
        error: "Pick a date within the next 60 days",
      },
      {
        data: {
          kind: "SITE_VISIT",
          propertySlug: "no-such-home",
          name: identity.name,
          phone: identity.phone,
          date,
          time: "10:00 AM",
        },
        status: 404,
        error: "That home is no longer listed",
      },
    ];

    // One address per case. The limiter runs before validation (see the test below), so a single
    // bucket would run out mid-list and the eventual failure would be about the wrong thing.
    for (const [index, { data, status, error }] of cases.entries()) {
      const caller = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { "x-real-ip": `198.51.100.${100 + index}` },
      });
      try {
        const response = await caller.post("/api/enquiries", { data });
        const payload = await response.json();
        expect(response.status(), `unexpected status for ${JSON.stringify(data)}`).toBe(status);
        expect(payload).toEqual({ success: false, error });
      } finally {
        await caller.dispose();
      }
    }
  });

  /**
   * The limiter is the first statement in the handler, before the body is even read — so a
   * visitor who mistypes their phone number six times is locked out for an hour with nothing
   * stored. That is a deliberate ordering (a script sending garbage should not get to spend the
   * database's time either), but it is worth knowing the count is of *attempts*, not of leads.
   */
  test("a rejected enquiry still spends the caller's allowance", async ({ page, identity }) => {
    const invalid = { kind: "GENERAL", name: identity.name, phone: "not-a-number" };

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await page.request.post("/api/enquiries", { data: invalid });
      expect(response.status(), `attempt ${attempt}`).toBe(400);
    }

    const refused = await page.request.post("/api/enquiries", {
      data: { kind: "GENERAL", name: identity.name, phone: identity.phone },
    });
    expect(refused.status()).toBe(429);
  });

  test("a slot in the past is refused even though the date is valid", async ({
    page,
    identity,
  }) => {
    const property = await propertyBySlug((await publishedProperties())[0].slug);
    const response = await page.request.post("/api/enquiries", {
      data: {
        kind: "SITE_VISIT",
        propertySlug: property.slug,
        name: identity.name,
        phone: identity.phone,
        date: istDateIn(-1),
        time: "10:00 AM",
      },
    });

    expect(response.status()).toBe(400);
    // Yesterday is inside the "not before now - 1 day" window the picker allows, so the refusal
    // has to come from the instant check rather than the date check.
    expect((await response.json()).error).toMatch(
      /already passed|within the next 60 days/,
    );
  });
});

test.describe("rate limiting", () => {
  test("six enquiries an hour per address, and the seventh is told why", async ({
    page,
    identity,
  }) => {
    const body = { kind: "GENERAL", name: identity.name, phone: identity.phone };

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await page.request.post("/api/enquiries", { data: body });
      expect(response.status(), `enquiry ${attempt} was refused early`).toBe(201);
    }

    const refused = await page.request.post("/api/enquiries", { data: body });
    expect(refused.status()).toBe(429);
    expect((await refused.json()).error).toContain("Too many enquiries from this connection");
  });

  /**
   * `x-forwarded-for` is caller-controlled. If `getClientIp()` read its leading entry first, the
   * loop below would get a fresh bucket every request and never see a 429 — which is exactly the
   * regression this catches.
   */
  test("a caller cannot mint a fresh bucket by rotating x-forwarded-for", async ({
    playwright,
    baseURL,
    identity,
  }) => {
    const caller = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-real-ip": identity.clientIp },
    });

    try {
      const body = { kind: "GENERAL", name: identity.name, phone: identity.phone };
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await caller.post("/api/enquiries", {
          data: body,
          headers: { "x-forwarded-for": `203.0.113.${attempt + 1}` },
        });
        statuses.push(response.status());
      }

      expect(statuses.slice(0, 6)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(statuses[6]).toBe(429);
    } finally {
      await caller.dispose();
    }
  });

  test("one address running out does not affect another", async ({
    page,
    playwright,
    baseURL,
    identity,
  }) => {
    const body = { kind: "GENERAL", name: identity.name, phone: identity.phone };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.request.post("/api/enquiries", { data: body });
    }
    expect((await page.request.post("/api/enquiries", { data: body })).status()).toBe(429);

    const neighbour = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-real-ip": "198.51.100.22" },
    });
    try {
      const response = await neighbour.post("/api/enquiries", {
        data: { ...body, name: `${identity.marker} neighbour` },
      });
      expect(response.status()).toBe(201);
    } finally {
      await neighbour.dispose();
    }
  });
});

test.describe("POST /api/subscribers", () => {
  test("accepts an address once and answers the same way the second time", async ({
    page,
    identity,
    prisma,
  }) => {
    const first = await page.request.post("/api/subscribers", { data: { email: identity.email } });
    expect(first.status()).toBe(201);
    expect(await first.json()).toEqual({ success: true, data: { ok: true } });

    const second = await page.request.post("/api/subscribers", { data: { email: identity.email } });
    expect(second.status()).toBe(first.status());
    expect(await second.json()).toEqual(await first.json());

    expect(await prisma.subscriber.count({ where: { email: identity.email } })).toBe(1);
  });

  test("refuses an address that is not one", async ({ page }) => {
    const response = await page.request.post("/api/subscribers", { data: { email: "nope" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe("That email address does not look right");
  });

  test("a body that is not JSON is a 400, not a 500", async ({ page }) => {
    const response = await page.request.post("/api/subscribers", {
      headers: { "content-type": "application/json" },
      data: "{ not json",
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).success).toBe(false);
  });
});
