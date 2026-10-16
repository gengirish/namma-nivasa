import { clerkAvailable, signInAs } from "../support/clerk";
import { createUnpublishedProperty } from "../support/db";
import { expect, test } from "../support/fixtures";
import { expectHydrated, gotoHome, openProperty } from "../support/ui";

/**
 * The dashboard, with a curator actually signed in.
 *
 * The listing editor is the newest surface in the app and the one with the most reach: it is the
 * only way to change a home's copy without a connection string, and what it writes is what every
 * visitor then reads. Until now nothing tested it.
 *
 * These are deliberately few and load-bearing rather than a tour of every page. What is worth
 * asserting is the round trip — a curator types something, saves, and a visitor sees it — plus the
 * boundary a path matcher cannot enforce: a VIEWER reaching a page they may read and being refused
 * one they may not.
 *
 * Skipped without Clerk keys, where `/dashboard` is unreachable by design.
 */
test.describe("the dashboard", () => {
  test.skip(!clerkAvailable(), "needs E2E_CLERK=1 and Clerk keys — see e2e/support/clerk.ts");

  test("shows the curation team its own overview once signed in", async ({ page }) => {
    await signInAs(page, "CURATOR");

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    // The refusal copy the anonymous specs assert must not be here.
    await expect(page.getByText("Sign in to continue")).toBeHidden();
  });

  test("lists every listing, whatever its status — unlike the public collection", async ({
    page,
    identity,
  }) => {
    const draft = await createUnpublishedProperty(identity.marker, "DRAFT");
    try {
      await signInAs(page, "CURATOR");
      await page.goto("/dashboard/properties");

      await expect(page.getByRole("heading", { level: 1, name: "Listings" })).toBeVisible();
      // A DRAFT is invisible to `/api/properties` and central here: the dashboard exists to work
      // on homes that are not live yet.
      await expect(page.getByText(`${identity.marker} hidden home`)).toBeVisible();
    } finally {
      await draft.dispose();
    }
  });

  test("an edit in the editor reaches the public listing page", async ({ page, identity }) => {
    const draft = await createUnpublishedProperty(identity.marker, "DRAFT");
    try {
      await signInAs(page, "CURATOR");

      // Publish it first, so the visitor half of the assertion has something to load.
      const listing = await page.request.get("/api/admin/properties?status=DRAFT");
      const rows = (await listing.json()).data.properties as { id: string; slug: string }[];
      const row = rows.find((r) => r.slug === draft.slug);
      expect(row, "the draft this test just created should be in the admin list").toBeTruthy();

      await page.request.patch(`/api/admin/properties/${row!.id}`, {
        data: { status: "PUBLISHED" },
      });

      await page.goto(`/dashboard/properties/${row!.id}`);
      await expectHydrated(page);

      const tagline = `${identity.marker} edited in the editor`;
      await page.getByLabel("Tagline").fill(tagline);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Saved.")).toBeVisible();

      // The round trip that matters: what a curator typed is what a visitor reads.
      await gotoHome(page);
      await openProperty(page, `${identity.marker} hidden home`);
      await expect(page.getByText(tagline).first()).toBeVisible();
    } finally {
      await draft.dispose();
    }
  });

  test("a VIEWER reads the dashboard and is refused the editor", async ({ page, identity }) => {
    const draft = await createUnpublishedProperty(identity.marker, "DRAFT");
    try {
      await signInAs(page, "VIEWER");

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

      /**
       * The editor calls `requireRole("CURATOR")` as its first statement, so a VIEWER never gets
       * a read-only version of the form — there is no read-only mode to maintain. This is the
       * assertion `ROLE_RANK` exists for, and a path matcher in middleware could not make it:
       * both accounts are signed in, and the difference is the `Admin` row.
       */
      const list = await page.request.get("/api/admin/properties?status=DRAFT");
      const rows = (await list.json()).data.properties as { id: string; slug: string }[];
      const row = rows.find((r) => r.slug === draft.slug);

      const refused = await page.request.patch(`/api/admin/properties/${row!.id}`, {
        data: { tagline: "A viewer should not be able to write this." },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await draft.dispose();
    }
  });

  test("signing out puts the boundary back", async ({ page }) => {
    await signInAs(page, "CURATOR");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    await page.evaluate(async () => {
      await (window as unknown as { Clerk: { signOut: () => Promise<void> } }).Clerk.signOut();
    });

    // Not a cosmetic redirect: the API must refuse the same session too.
    const refused = await page.request.get("/api/admin/properties");
    expect(refused.status()).toBe(401);
  });
});
