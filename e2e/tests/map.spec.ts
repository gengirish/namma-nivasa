import type { Page } from "@playwright/test";

import { db, publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { gotoHome, openProperty } from "../support/ui";

/**
 * Both maps: the collection on `components/map-view.tsx`, and the single home on
 * `components/property-map.tsx`.
 *
 * **Tiles are stubbed.** Leaflet fetches `tile.openstreetmap.org`, and a suite that waited on a
 * third-party tile server would fail on a train and fail in CI for reasons that have nothing to do
 * with this repo. What is worth asserting is ours anyway: which coordinates a marker was given,
 * which listing a popup navigates to, and whether the directions link carries the same latitude
 * and longitude the API reports. None of that needs a picture of Bangalore behind it.
 *
 * Leaflet builds the map in an effect after a dynamic `import("leaflet")`, so every assertion here
 * waits on a marker or the container rather than assuming either is present on first paint.
 */

/** 1×1 transparent PNG — enough for Leaflet to consider a tile loaded. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function stubTiles(page: Page): Promise<void> {
  await page.route("**://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
  );
}

const mapContainer = (page: Page) => page.locator(".leaflet-container");
const pins = (page: Page) => page.locator(".leaflet-marker-icon.nv-pin");

test.describe("the collection map", () => {
  test.beforeEach(async ({ page }) => {
    await stubTiles(page);
  });

  test("drops one pin per published home", async ({ page }) => {
    const all = await publishedProperties();

    await gotoHome(page);
    await page.getByRole("button", { name: "Map", exact: true }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where these homes are");
    await expect(mapContainer(page)).toBeVisible();
    await expect(pins(page)).toHaveCount(all.length);

    // The list beside the map is the same catalogue in the same order.
    await expect(page.locator("button.nv-maprow").locator("p").first()).toHaveText(all[0].name);
    await expect(
      page.getByText("Approximate localities shown"),
    ).toBeVisible();
  });

  test("a row focuses its home, and the popup opens that listing", async ({ page }) => {
    const all = await publishedProperties();
    test.skip(all.length < 2, "needs at least two published homes");

    const target = all[1];
    await gotoHome(page);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(pins(page)).toHaveCount(all.length);

    await page.locator("button.nv-maprow").filter({ hasText: target.name }).click();

    const popup = page.locator(".leaflet-popup");
    await expect(popup).toContainText(target.name);
    await expect(popup).toContainText(target.location);

    // The popup's button is plain HTML bound in `popupopen`, not React — which is exactly why it
    // is worth a test: nothing else proves the handler was attached to the right slug.
    await popup.locator(`[data-view="${target.slug}"]`).click();
    await expect(page.getByRole("heading", { level: 1, name: target.name })).toBeVisible();
  });
});

test.describe("a listing's own map", () => {
  test.beforeEach(async ({ page }) => {
    await stubTiles(page);
  });

  test("is centred on the coordinates the API reports for that home", async ({ page }) => {
    const [first] = await publishedProperties();
    const property = await db().property.findUniqueOrThrow({
      where: { slug: first.slug },
      select: { name: true, latitude: true, longitude: true },
    });

    await gotoHome(page);
    await openProperty(page, property.name);

    const section = page.getByRole("group", {
      name: `Map showing the approximate location of ${property.name}`,
    });
    await expect(section).toBeVisible();
    // The labelled element *is* the map: Leaflet initialises the div it was handed and adds its
    // own class to it, so `leaflet-container` is on this node rather than under it.
    await expect(section).toHaveClass(/leaflet-container/);
    await expect(section.locator(".nv-pin")).toHaveCount(1);

    /**
     * The assertion that would catch a coordinate wired through wrong. `latitude`/`longitude`
     * reach the browser through `PropertyDto`, and a component reading the wrong pair — or a
     * hardcoded centre left in during development — renders a perfectly convincing map of
     * somewhere else. The directions link is where those numbers become visible again.
     */
    await expect(page.getByRole("link", { name: "Get directions" })).toHaveAttribute(
      "href",
      `https://www.google.com/maps/dir/?api=1&destination=${property.latitude},${property.longitude}`,
    );

    // The promise the pin is deliberately imprecise for.
    await expect(page.getByText(/Approximate locality shown/)).toBeVisible();
  });

  test("opens in a new tab rather than taking the visitor off the listing", async ({ page }) => {
    const [first] = await publishedProperties();
    await gotoHome(page);
    await openProperty(page, first.name);

    const link = page.getByRole("link", { name: "Get directions" });
    await expect(link).toHaveAttribute("target", "_blank");
    // Without this, the opened tab keeps a handle on this one.
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("reaches the collection map without going home first", async ({ page }) => {
    const all = await publishedProperties();
    await gotoHome(page);
    await openProperty(page, all[0].name);

    await page.getByRole("button", { name: "All homes on the map" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where these homes are");
    await expect(pins(page)).toHaveCount(all.length);
  });
});
