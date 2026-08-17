import { clerkAvailable, signInAs } from "../support/clerk";
import { db } from "../support/db";
import { expect, test } from "../support/fixtures";

/**
 * The admin API with a real session behind it.
 *
 * `admin-guard.spec.ts` covers the other half — that every one of these routes refuses a caller
 * with no session, and says nothing about the team's data while doing it. What was never covered
 * is what happens once somebody *is* signed in: whether a listing created through the API lands
 * DRAFT, whether an edit keeps a published home published, whether `ROLE_RANK` actually stops a
 * VIEWER writing. The listing editor and the Blob upload token were both built recently and had
 * never been exercised by a test at all.
 *
 * Skipped without Clerk keys, where the dashboard is unreachable by design rather than unguarded.
 */
test.describe("the admin API, signed in", () => {
  test.skip(!clerkAvailable(), "needs E2E_CLERK=1 and Clerk keys — see e2e/support/clerk.ts");

  /** A complete listing body; specs override the one field they are about. */
  function listingBody(marker: string) {
    return {
      name: `${marker} Test House`,
      location: "Nowhere, Bangalore",
      locality: "Nowhere",
      tagline: "Written by a test.",
      story: "Written by a test.",
      description: ["Written by a test."],
      bhk: "3 BHK",
      bhkNum: 3,
      areaLabel: "Carpet Area",
      area: "1,650 sqft",
      areaSqft: 1650,
      pricePaise: 42_00_00_000,
      latitude: 12.9611,
      longitude: 77.6387,
      amenities: ["LIFT"],
      hoodBlurb: "",
      heroImageUrl: "https://example.invalid/hero.jpg",
    };
  }

  test("a created listing lands DRAFT, and stays out of the public collection", async ({
    page,
    identity,
  }) => {
    await signInAs(page, "CURATOR");

    const created = await page.request.post("/api/admin/properties", {
      data: listingBody(identity.marker),
    });
    expect(created.status()).toBe(201);
    const { data } = await created.json();

    /**
     * DRAFT is the default the route enforces rather than the caller choosing — the same posture
     * `npm run listing:create` takes. A listing that went live the moment it was posted would put
     * a half-finished home in front of visitors on a typo.
     */
    expect(data.status).toBe("DRAFT");

    const publicList = await page.request.get("/api/properties");
    const slugs = (await publicList.json()).data.properties.map((p: { slug: string }) => p.slug);
    expect(slugs).not.toContain(data.slug);
  });

  test("an edit to a published listing leaves it published", async ({ page, identity }) => {
    await signInAs(page, "CURATOR");

    const created = await page.request.post("/api/admin/properties", {
      data: listingBody(identity.marker),
    });
    const { data: listing } = await created.json();

    const published = await page.request.patch(`/api/admin/properties/${listing.id}`, {
      data: { status: "PUBLISHED" },
    });
    expect(published.status()).toBe(200);
    expect((await published.json()).data.status).toBe("PUBLISHED");

    // The regression this guards: a PATCH that carried no status must not reset one.
    const edited = await page.request.patch(`/api/admin/properties/${listing.id}`, {
      data: { tagline: "Edited by a test." },
    });
    expect(edited.status()).toBe(200);
    const after = (await edited.json()).data;
    expect(after.status).toBe("PUBLISHED");
    expect(after.tagline).toBe("Edited by a test.");

    // …and it reaches a visitor, which is the only proof the edit went all the way through.
    const publicRow = await page.request.get(`/api/properties/${after.slug}`);
    expect(publicRow.status()).toBe(200);
    expect((await publicRow.json()).data.tagline).toBe("Edited by a test.");
  });

  test("archiving hides the listing and keeps the leads it produced", async ({
    page,
    identity,
    prisma,
  }) => {
    // DELETE is OWNER-only: archiving is the one listing action a curator cannot take alone.
    await signInAs(page, "OWNER");

    const created = await page.request.post("/api/admin/properties", {
      data: listingBody(identity.marker),
    });
    const { data: listing } = await created.json();
    await page.request.patch(`/api/admin/properties/${listing.id}`, {
      data: { status: "PUBLISHED" },
    });

    const enquiry = await prisma.enquiry.create({
      data: {
        reference: `NIV-${identity.marker.slice(-6).toUpperCase()}`,
        kind: "GENERAL",
        propertyId: listing.id,
        propertyName: listing.name,
        name: identity.name,
        phone: "+919000000003",
      },
      select: { id: true },
    });

    const archived = await page.request.delete(`/api/admin/properties/${listing.id}`);
    expect(archived.status()).toBe(200);

    const row = await prisma.property.findUnique({ where: { id: listing.id } });
    // Archived, never deleted.
    expect(row?.status).toBe("ARCHIVED");

    const publicRow = await page.request.get(`/api/properties/${listing.slug}`);
    expect(publicRow.status()).toBe(404);

    /**
     * The snapshot is the point. `Enquiry.propertyId` is `ON DELETE SET NULL` and `propertyName`
     * is copied at write time, so a lead still reads correctly a year after its listing went away.
     */
    const lead = await prisma.enquiry.findUnique({ where: { id: enquiry.id } });
    expect(lead?.propertyName).toBe(listing.name);
  });

  test("a VIEWER may read the catalogue and may not change it", async ({ page, identity }) => {
    await signInAs(page, "VIEWER");

    // Roles are ranked, not compared for equality: VIEWER is the floor, so reads are allowed.
    const list = await page.request.get("/api/admin/properties");
    expect(list.status()).toBe(200);

    const refused = await page.request.post("/api/admin/properties", {
      data: listingBody(identity.marker),
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).success).toBe(false);

    // 403 rather than 401: this account is signed in and simply may not do this.
    const upload = await page.request.post("/api/admin/uploads", {
      data: { type: "blob.generate-client-token", payload: { pathname: "properties/x.jpg" } },
    });
    expect(upload.status()).not.toBe(200);
  });

  test("the upload token is scoped to the listings prefix, not to whatever was asked for", async ({
    page,
  }) => {
    await signInAs(page, "CURATOR");

    /**
     * The client chooses the pathname, so a token minted for whatever it asked for would let any
     * curator write anywhere in the store — including over another listing's photos. No bytes are
     * uploaded here; what is being asserted is that the route refuses to mint the token at all.
     */
    const outside = await page.request.post("/api/admin/uploads", {
      data: {
        type: "blob.generate-client-token",
        payload: { pathname: "../secrets/key.jpg", callbackUrl: "http://localhost/x" },
      },
    });
    expect(outside.status()).not.toBe(200);
  });

  test("enquiry status changes are recorded against the admin who made them", async ({
    page,
    identity,
    prisma,
  }) => {
    await signInAs(page, "CURATOR");

    const enquiry = await prisma.enquiry.create({
      data: {
        reference: `NIV-${identity.marker.slice(0, 6).toUpperCase()}`,
        kind: "GENERAL",
        name: identity.name,
        phone: "+919000000004",
      },
      select: { id: true },
    });

    const updated = await page.request.patch(`/api/admin/enquiries/${enquiry.id}`, {
      data: { status: "CONTACTED", notes: `${identity.marker} rang them back` },
    });
    expect(updated.status()).toBe(200);

    const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
    expect(row.status).toBe("CONTACTED");
    expect(row.notes).toContain("rang them back");
    // Who handled it, not just that it was handled — the dashboard shows this beside the lead.
    expect(row.handledBy).not.toBeNull();

    const admin = await db().admin.findUnique({ where: { id: row.handledBy! } });
    expect(admin?.role).toBe("CURATOR");
  });

  test("an unknown listing is a 404 in the same envelope as everything else", async ({ page }) => {
    await signInAs(page, "CURATOR");

    const missing = await page.request.get("/api/admin/properties/not-a-real-id");
    expect(missing.status()).toBe(404);
    const body = await missing.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});
