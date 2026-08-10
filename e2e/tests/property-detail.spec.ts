import { db, publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { gotoHome, listingCards, openProperty, toast } from "../support/ui";

/**
 * The listing page.
 *
 * There is no route change here — `NivasaApp` swaps views in client state, so "opening a home"
 * means the same document with different content, and going back means the same again. That is
 * deliberate (the whole catalogue is server-rendered up front so switching costs no round trip),
 * and it is the reason none of these tests navigate by URL.
 */

async function firstProperty() {
  const [first] = await publishedProperties();
  const detail = await db().property.findUniqueOrThrow({
    where: { slug: first.slug },
    select: {
      slug: true,
      name: true,
      location: true,
      locality: true,
      tagline: true,
      story: true,
      description: true,
      bhk: true,
      areaLabel: true,
      area: true,
      amenities: true,
      floorplanNote: true,
      hoodBlurb: true,
      images: { select: { alt: true }, orderBy: { sortOrder: "asc" } },
      hood: { select: { name: true, distance: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  return detail;
}

test.describe("a listing", () => {
  test("shows the whole write-up the curator entered", async ({ page }) => {
    const property = await firstProperty();
    await gotoHome(page);
    await openProperty(page, property.name);

    await expect(page.getByText(property.tagline).first()).toBeVisible();
    await expect(page.getByText(property.story).first()).toBeVisible();
    for (const paragraph of property.description) {
      await expect(page.getByText(paragraph)).toBeVisible();
    }

    // The three specs beside the story.
    await expect(page.getByText("Configuration")).toBeVisible();
    await expect(page.getByText(property.areaLabel).first()).toBeVisible();
    await expect(page.getByText(property.locality, { exact: true }).first()).toBeVisible();

    await expect(page.getByRole("img", { name: `${property.name} floor plan` })).toBeVisible();
    await expect(
      page.getByText(property.floorplanNote ?? "Illustrative floor plan — not to scale."),
    ).toBeVisible();
  });

  test("lists the neighbourhood the way the curator wrote it, not a computed distance", async ({
    page,
  }) => {
    const property = await firstProperty();
    await gotoHome(page);
    await openProperty(page, property.name);

    await expect(page.getByText(property.hoodBlurb)).toBeVisible();
    for (const place of property.hood) {
      // Each entry renders as name over "Transit · 10 min walk", so the distance is only ever
      // visible alongside its kind — assert the row rather than the fragment.
      const row = page.locator("[data-reveal]").filter({ hasText: place.name }).last();
      await expect(row).toBeVisible();
      await expect(row).toContainText(place.distance);
    }
  });

  test("returns to the collection from both the button and the breadcrumb", async ({ page }) => {
    const property = await firstProperty();
    await gotoHome(page);

    await openProperty(page, property.name);
    await page.getByRole("button", { name: "Back to homes" }).click();
    await expect(listingCards(page).first()).toBeVisible();

    await openProperty(page, property.name);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(listingCards(page).first()).toBeVisible();
  });

  test("offers every other home and nothing that is already open", async ({ page }) => {
    const all = await publishedProperties();
    test.skip(all.length < 2, "needs at least two published homes");

    await gotoHome(page);
    await openProperty(page, all[0].name);

    const similar = page.locator("article.nv-card-sm");
    await expect(similar).toHaveCount(all.length - 1);
    await expect(similar.locator("h3")).toHaveText(all.slice(1).map((p) => p.name));

    await similar.first().click();
    await expect(page.getByRole("heading", { level: 1, name: all[1].name })).toBeVisible();
  });
});

test.describe("the gallery", () => {
  test("opens a photo, steps through with the keyboard, and closes on Escape", async ({ page }) => {
    const property = await firstProperty();
    // What the store builds: the hero first, then whatever the curator uploaded.
    const alts = [`${property.name} exterior`, ...property.images.map((i) => i.alt)];
    test.skip(alts.length < 3, "needs a hero and at least two gallery images");

    await gotoHome(page);
    await openProperty(page, property.name);

    await page.getByRole("img", { name: alts[1], exact: true }).click();
    const lightbox = page.getByRole("dialog", { name: alts[1] });
    await expect(lightbox).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: alts[2] })).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: alts[1] })).toBeVisible();

    // Wraps rather than running off the end.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: alts[0] })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("locks the page behind the overlay and releases it afterwards", async ({ page }) => {
    const property = await firstProperty();
    await gotoHome(page);
    await openProperty(page, property.name);

    const overflow = () => page.evaluate(() => document.body.style.overflow);
    expect(await overflow()).toBe("");

    await page.getByRole("img", { name: property.images[0].alt, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await overflow()).toBe("hidden");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await overflow()).toBe("");
  });
});

test.describe("the video tour", () => {
  test("plays in an overlay and closes again", async ({ page }) => {
    const property = await firstProperty();
    const hasVideo = await db().property.findFirst({
      where: { slug: property.slug, videoUrl: { not: null } },
      select: { videoUrl: true },
    });
    test.skip(!hasVideo, "this listing has no video tour");

    await gotoHome(page);
    await openProperty(page, property.name);

    await page.getByRole("button", { name: `Play the ${property.name} video tour` }).click();

    const modal = page.getByRole("dialog", { name: `${property.name} video tour` });
    await expect(modal).toBeVisible();
    await expect(modal.locator("video")).toHaveAttribute("src", hasVideo!.videoUrl!);

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });
});

test.describe("taking a listing away with you", () => {
  /**
   * The brochure is built in the browser from the catalogue already in memory — no endpoint, no
   * round trip — so the only externally visible proof it worked is the download itself.
   */
  test("downloads a brochure named after the listing", async ({ page }) => {
    const property = await firstProperty();
    await gotoHome(page);
    await openProperty(page, property.name);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Brochure" }).click();

    expect((await download).suggestedFilename()).toBe(`nivasa-${property.slug}-brochure.html`);
    await expect(toast(page)).toContainText("Brochure downloaded");
  });
});
