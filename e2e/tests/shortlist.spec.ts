import { publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { cardFor, gotoHome, listingCards, openProperty, toast } from "../support/ui";

/**
 * Shortlist and recently-viewed.
 *
 * Both are `localStorage`, and both are keyed by **slug rather than id** — a visitor's shortlist
 * has to survive a reseed or a restore, neither of which preserves a cuid. That is the one thing
 * here worth asserting on the stored value itself rather than through the UI, because a switch
 * to ids would look identical on screen and quietly empty every returning visitor's list.
 */

const savedSlugs = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem("nivasa_saved") || "[]"));

const recentSlugs = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem("nivasa_recent") || "[]"));

test.describe("the shortlist", () => {
  test("saves and unsaves from the card, and counts in the header", async ({ page }) => {
    const [first, second] = await publishedProperties();
    await gotoHome(page);

    const heart = cardFor(page, first.name).getByRole("button", { name: `Save ${first.name}` });
    await expect(heart).toHaveAttribute("aria-pressed", "false");

    await heart.click();
    await expect(
      cardFor(page, first.name).getByRole("button", {
        name: `Remove ${first.name} from your shortlist`,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-nav-saved]")).toContainText("1");
    expect(await savedSlugs(page)).toEqual([first.slug]);

    await cardFor(page, second.name).getByRole("button", { name: `Save ${second.name}` }).click();
    await expect(page.locator("[data-nav-saved]")).toContainText("2");
    expect(await savedSlugs(page)).toEqual([first.slug, second.slug]);

    await cardFor(page, first.name)
      .getByRole("button", { name: `Remove ${first.name} from your shortlist` })
      .click();
    expect(await savedSlugs(page)).toEqual([second.slug]);
  });

  test("survives a reload, because it is stored by slug", async ({ page }) => {
    const [first] = await publishedProperties();
    await gotoHome(page);

    await cardFor(page, first.name).getByRole("button", { name: `Save ${first.name}` }).click();
    expect(await savedSlugs(page)).toEqual([first.slug]);

    await gotoHome(page);
    await expect(
      cardFor(page, first.name).getByRole("button", {
        name: `Remove ${first.name} from your shortlist`,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-nav-saved]")).toContainText("1");
  });

  test("the Saved view shows only what was shortlisted", async ({ page }) => {
    const all = await publishedProperties();
    test.skip(all.length < 2, "needs at least two published homes");
    await gotoHome(page);

    await cardFor(page, all[1].name).getByRole("button", { name: `Save ${all[1].name}` }).click();
    await page.getByRole("button", { name: "Saved" }).click();

    await expect(page.getByRole("heading", { name: "Your saved homes" })).toBeVisible();
    await expect(listingCards(page)).toHaveCount(1);
    await expect(cardFor(page, all[1].name)).toBeVisible();
  });

  test("an empty shortlist explains itself instead of showing nothing", async ({ page }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Saved" }).click();

    await expect(toast(page)).toContainText("Nothing saved yet");
    await expect(page.getByText("You haven't saved any homes yet")).toBeVisible();
    await expect(listingCards(page)).toHaveCount(0);
  });

  test("saving from the listing page agrees with the card", async ({ page }) => {
    const [first] = await publishedProperties();
    await gotoHome(page);
    await openProperty(page, first.name);

    const save = page.getByRole("button", { name: "Save this property" });
    await save.click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await savedSlugs(page)).toEqual([first.slug]);

    await page.getByRole("button", { name: "Back to homes" }).click();
    await expect(
      cardFor(page, first.name).getByRole("button", {
        name: `Remove ${first.name} from your shortlist`,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("recently viewed", () => {
  test("records homes most-recent-first and clears on request", async ({ page }) => {
    const all = await publishedProperties();
    test.skip(all.length < 2, "needs at least two published homes");
    await gotoHome(page);

    await openProperty(page, all[0].name);
    await page.getByRole("button", { name: "Back to homes" }).click();
    await openProperty(page, all[1].name);
    await page.getByRole("button", { name: "Back to homes" }).click();

    expect(await recentSlugs(page)).toEqual([all[1].slug, all[0].slug]);
    await expect(page.getByRole("heading", { name: "Recently viewed" })).toBeVisible();

    // Re-visiting moves a home to the front rather than adding it twice.
    await openProperty(page, all[0].name);
    await page.getByRole("button", { name: "Back to homes" }).click();
    expect(await recentSlugs(page)).toEqual([all[0].slug, all[1].slug]);

    await page.getByRole("button", { name: "Clear" }).click();
    expect(await recentSlugs(page)).toEqual([]);
    await expect(page.getByRole("heading", { name: "Recently viewed" })).toBeHidden();
  });

  /**
   * A slug in storage that no longer resolves is a home archived while it sat there. It has to
   * be dropped silently — the alternative is a card that renders nothing and cannot be opened.
   */
  test("ignores a stored slug that no longer resolves", async ({ page }) => {
    const [first] = await publishedProperties();

    await page.goto("/");
    await page.evaluate(
      (slug) =>
        window.localStorage.setItem("nivasa_recent", JSON.stringify(["gone-last-year", slug])),
      first.slug,
    );
    await gotoHome(page);

    await expect(page.getByRole("heading", { name: "Recently viewed" })).toBeVisible();
    await expect(page.locator("[data-recentrow] > *")).toHaveCount(1);
    await expect(page.locator("[data-recentrow]")).toContainText(first.name);
  });
});
