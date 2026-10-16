/**
 * Read-only smoke coverage for a deployed server.
 *
 * The main suite cannot be pointed at production, and the reason is structural rather than
 * squeamish: `e2e/global-setup.ts` needs `DATABASE_URL` to be *the same database the server under
 * test is using*, because seven of the eleven specs read and write Postgres directly to set up and
 * assert state. Neon's connection string is non-retrievable through `vercel env pull`, so that
 * pairing cannot be made from a developer's machine — and if it could, the write specs would
 * create real enquiries and spend the real weekly viewing quota on a real listing.
 *
 * So this file writes nothing. Every check here is a GET, or a POST the server is expected to
 * refuse before it parses a body. What that buys is narrower than the main suite and worth
 * naming: it pins the deployed catalogue against its own API, the live availability endpoint, the
 * admin boundary, the webhook's refusal, and the PWA assets. It does not cover booking, the
 * double-booking index, the weekly cap, enquiry writes or the reply agent — those need the
 * database, and they are the main suite's job against the throwaway container.
 *
 *   PW_DEPLOY_URL=https://namma-nivasa.vercel.app npm run test:e2e:deployed
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { istDateIn } from "../support/ist";
import { expectHydrated, listingCards } from "../support/ui";

/** Fields `lib/dto.ts` chooses. A DTO is field-by-field, so this list is the contract. */
const REQUIRED_DTO_FIELDS = [
  "id",
  "slug",
  "name",
  "location",
  "locality",
  "tagline",
  "bhk",
  "areaSqft",
  "pricePaise",
  "latitude",
  "longitude",
  "heroImageUrl",
  "availability",
] as const;

/**
 * Columns that exist on `Property` but are deliberately not in `PropertyDto`. A schema column
 * that starts crossing the wire shows up here rather than in someone's devtools.
 */
const FIELDS_THAT_MUST_NOT_LEAK = [
  "status",
  "publishedAt",
  "createdAt",
  "updatedAt",
  "weeklyViewingSlots",
  "ownerName",
  "ownerPhone",
  "ownerEmail",
  "internalNotes",
] as const;

type Property = Record<string, unknown> & { slug: string; name: string };

async function publishedProperties(request: APIRequestContext): Promise<Property[]> {
  const response = await request.get("/api/properties");
  expect(response.status(), "GET /api/properties").toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data.properties as Property[];
}

test.describe("deployed catalogue", () => {
  test("the API serves a published collection in the shape the client expects", async ({
    request,
  }) => {
    const properties = await publishedProperties(request);

    // A deployment serving an empty catalogue renders a homepage with no homes on it. That is a
    // real outage of the only thing a visitor came for, so it fails here rather than passing
    // vacuously.
    expect(properties.length, "no published listings on the deployed server").toBeGreaterThan(0);

    for (const property of properties) {
      for (const field of REQUIRED_DTO_FIELDS) {
        expect(property[field], `${property.slug} is missing ${field}`).toBeDefined();
      }
      for (const field of FIELDS_THAT_MUST_NOT_LEAK) {
        expect(property[field], `${property.slug} leaks ${field} to the client`).toBeUndefined();
      }
      // Paise, integer, never a float — a rounded rupee value would be a silent 100× error.
      expect(Number.isInteger(property.pricePaise), `${property.slug} pricePaise`).toBe(true);
    }
  });

  test("the server-rendered home page shows exactly what the API published", async ({
    page,
    request,
  }) => {
    const properties = await publishedProperties(request);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find a home");
    await expectHydrated(page);

    // `app/page.tsx` loads the collection server-side while `/api/properties` is a separate read.
    // They can only disagree if one of them is filtering status differently — which is exactly how
    // a DRAFT listing would reach a visitor.
    await expect(listingCards(page)).toHaveCount(properties.length);
    await expect(page.getByText(properties[0].name).first()).toBeVisible();
  });

  test("a published slug resolves and an unknown one 404s as JSON", async ({ request }) => {
    const [first] = await publishedProperties(request);

    const found = await request.get(`/api/properties/${first.slug}`);
    expect(found.status()).toBe(200);
    // The collection route wraps in `data.properties`; this one answers the DTO at `data`.
    expect((await found.json()).data.slug).toBe(first.slug);

    const missing = await request.get("/api/properties/no-such-home");
    expect(missing.status(), "unknown slug").toBe(404);
    // Not the HTML 404 document — a route that answers HTML here reaches the client as
    // `SyntaxError: Unexpected token '<'`.
    expect(missing.headers()["content-type"]).toContain("application/json");
    expect((await missing.json()).success).toBe(false);
  });

  test("availability is answered live for a future date", async ({ request }) => {
    const [first] = await publishedProperties(request);
    const date = istDateIn(3);

    const response = await request.get(
      `/api/properties/${first.slug}/availability?date=${date}`,
    );
    expect(response.status()).toBe(200);

    const { data } = await response.json();
    expect(data.date).toBe(date);
    expect(Array.isArray(data.slots)).toBe(true);
    expect(data.slots.length).toBeGreaterThan(0);
    for (const slot of data.slots) {
      expect(typeof slot.time).toBe("string");
      expect(typeof slot.available).toBe("boolean");
    }
    // The cap is counted against the week being booked, so this is the target week's number.
    expect(data.slotsLeftInWeek).toBeLessThanOrEqual(data.weeklySlots);
    expect(data.slotsLeftInWeek).toBeGreaterThanOrEqual(0);
  });
});

test.describe("deployed boundaries", () => {
  /**
   * The regression this exists for: with Clerk absent from the Vercel project, `/dashboard`
   * answered 200 and rendered "The team area is not configured" rather than redirecting to a
   * sign-in. A 200 there is the signal that the deployment lost its auth configuration.
   */
  test("the dashboard demands a session rather than announcing it has no auth", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard");

    expect(await page.content()).not.toContain("The team area is not configured");
    await expect(page).toHaveURL(/sign-in|clerk|accounts\./);
    expect(response?.status()).toBeLessThan(400);
  });

  test("the admin API refuses an unauthenticated read", async ({ request }) => {
    const response = await request.get("/api/admin/enquiries");

    expect(response.status(), "an unauthenticated admin read must never succeed").not.toBe(200);
    // 503 is the no-Clerk-keys refusal. Against a configured deployment it means the keys went
    // missing, which is the outage this whole describe block is watching for.
    expect(response.status(), "503 means Clerk is not configured on this deployment").not.toBe(503);
    expect([401, 403]).toContain(response.status());
  });

  /**
   * Unsigned, so the handler refuses it before it parses or stores anything — the same probe
   * `global-setup.ts` uses to prove the route compiled. There is no branch that processes an
   * unverified body, and a 200 here would mean one had appeared.
   */
  test("the inbound webhook refuses an unsigned payload", async ({ request }) => {
    const response = await request.post("/api/webhooks/agentmail", {
      data: { message: "unsigned probe from the deployed smoke suite" },
    });

    expect(response.status(), "an unsigned webhook must never be accepted").not.toBe(200);
    expect([400, 401, 503]).toContain(response.status());

    // The refusal has to be *ours*. Vercel's deployment-protection wall also answers 401 with
    // JSON, so a status check alone passes against a login page that never reached the app —
    // which is how this test quietly stops testing anything.
    const body = await response.json();
    expect(body.success, "not this app's error envelope — is the deployment protected?").toBe(
      false,
    );
    expect(typeof body.error).toBe("string");
  });

  test("no server-side secret reaches the HTML", async ({ page }) => {
    await page.goto("/");
    // Same trap as the webhook check: an SSO login page contains no secrets either, and would
    // sail through every assertion below.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find a home");

    const html = await page.content();

    expect(html).not.toContain("sk_live_");
    expect(html).not.toContain("sk_test_");
    expect(html).not.toContain("postgresql://");
    expect(html).not.toContain("AGENTMAIL_API_KEY");
  });
});

test.describe("deployed PWA assets", () => {
  test("the manifest and service worker are served", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const parsed = await manifest.json();
    expect(parsed.name).toBeTruthy();
    expect(Array.isArray(parsed.icons)).toBe(true);
    expect(parsed.icons.length).toBeGreaterThan(0);

    const worker = await request.get("/sw.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("javascript");
  });
});
