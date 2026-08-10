import { publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { enquiryModal, gotoHome, listingCards } from "../support/ui";

/**
 * Phone-sized behaviour. Runs only in the `mobile` project — the rest of the suite would just be
 * a second pass over the same database for no extra coverage.
 *
 * Everything responsive in this app is a `@media` rule in `app/globals.css` acting on a
 * `data-*` attribute, because the components carry inline styles that cannot express a
 * breakpoint. That split is exactly what breaks silently: a component renaming its attribute
 * leaves the CSS matching nothing, and the desktop nav simply stays on a 390px screen.
 */

test.describe("on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test("swaps the desktop nav for a menu button", async ({ page }) => {
    await expect(page.locator("[data-nav-links]")).toBeHidden();
    await expect(page.locator("[data-nav-saved]")).toBeHidden();

    const toggle = page.getByRole("button", { name: "Menu" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the menu opens, navigates, and closes behind itself", async ({ page }) => {
    const toggle = page.getByRole("button", { name: "Menu" });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator("[data-mobile-menu]");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "List your home" })).toBeVisible();

    await menu.getByRole("button", { name: "Map" }).click();
    await expect(menu).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".leaflet-container")).toBeVisible();
  });

  test("Escape closes the menu without navigating anywhere", async ({ page }) => {
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator("[data-mobile-menu]")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-mobile-menu]")).toBeHidden();
    await expect(listingCards(page).first()).toBeVisible();
  });

  test("the shortlist count is reachable from the menu, since the header badge is not", async ({
    page,
  }) => {
    const [first] = await publishedProperties();

    await listingCards(page)
      .filter({ hasText: first.name })
      .getByRole("button", { name: `Save ${first.name}` })
      .click();

    await page.getByRole("button", { name: "Menu" }).click();
    const saved = page.locator("[data-mobile-menu]").getByRole("button", { name: "Saved" });
    await expect(saved).toContainText("1");

    await saved.click();
    await expect(page.getByRole("heading", { name: "Your saved homes" })).toBeVisible();
    await expect(listingCards(page)).toHaveCount(1);
  });

  test("the enquiry modal fits and still submits", async ({ page, identity }) => {
    await page.getByRole("button", { name: "Enquire" }).click();

    const modal = enquiryModal(page);
    await expect(modal).toBeVisible();

    // The panel must stay inside the viewport rather than spilling sideways.
    const panel = modal.locator("> div");
    const box = await panel.boundingBox();
    const width = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);

    await modal.locator("#nv-name").fill(identity.name);
    await modal.locator("#nv-phone").fill(identity.phone);

    const posted = page.waitForResponse(
      (res) => res.url().includes("/api/enquiries") && res.request().method() === "POST",
    );
    await modal.getByRole("button", { name: /^Send$/ }).click();
    expect((await posted).status()).toBe(201);
    await expect(modal.getByRole("heading")).toContainText("Message sent.");
  });
});
