import { bookedInWeek, publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { istToday } from "../support/ist";
import { cardFor, gotoHome, listingCards, toast } from "../support/ui";

/**
 * The visitor's first screen. Everything asserted here is server-rendered from the catalogue, so
 * the expectations are read from the database rather than hardcoded — a reseed with different
 * homes must not turn into a red suite.
 */

test.beforeEach(async ({ page }) => {
  await gotoHome(page);
});

test.describe("the collection", () => {
  test("renders every published home, in the order the server returns them", async ({ page }) => {
    const expected = await publishedProperties();

    await expect(listingCards(page)).toHaveCount(expected.length);
    await expect(listingCards(page).locator("h3")).toHaveText(expected.map((p) => p.name));
  });

  test("a card carries the copy a visitor decides on", async ({ page }) => {
    const [first] = await publishedProperties();
    const card = cardFor(page, first.name);

    await expect(card.getByText(first.tagline)).toBeVisible();
    await expect(card.getByText(first.location)).toBeVisible();
    await expect(card.getByText(first.bhk, { exact: true })).toBeVisible();
    await expect(card.getByText(first.area, { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: `${first.name} exterior` })).toBeVisible();
  });

  /**
   * The design carried "3 viewing slots left" as a constant. It is now the property's weekly cap
   * minus the viewings on the books for the *current* week, which is what this recomputes.
   */
  test("the availability badge counts the current week's real bookings", async ({ page }) => {
    const today = istToday();

    for (const property of await publishedProperties()) {
      const left = property.weeklyViewingSlots - (await bookedInWeek(property.id, today));
      const expected =
        left <= 0
          ? "Fully booked this week"
          : `${left} viewing slot${left === 1 ? "" : "s"} left`;

      await expect(cardFor(page, property.name).getByText(expected)).toBeVisible();
    }
  });

  test("an unpublished listing never reaches the page", async ({ page, identity }) => {
    const expected = await publishedProperties();
    const names = await listingCards(page).locator("h3").allTextContents();

    expect(names).toEqual(expected.map((p) => p.name));
    expect(names.some((n) => n.includes(identity.marker))).toBe(false);
  });
});

test.describe("the configuration filter", () => {
  test("narrows the grid to one configuration and restores it", async ({ page }) => {
    const all = await publishedProperties();
    const filter = page.getByLabel("Filter by configuration");

    for (const bhk of ["2", "3", "4"]) {
      const matching = all.filter((p) => p.bhkNum === Number(bhk));
      await filter.selectOption(bhk);
      await expect(listingCards(page)).toHaveCount(matching.length);
      for (const property of matching) {
        await expect(cardFor(page, property.name)).toBeVisible();
      }
    }

    await filter.selectOption("all");
    await expect(listingCards(page)).toHaveCount(all.length);
  });
});

test.describe("wayfinding", () => {
  test("the header links scroll to their sections", async ({ page }) => {
    await page.getByRole("button", { name: "How it works" }).click();
    await expect(page.locator("#nv-how")).toBeInViewport();

    await page.getByRole("button", { name: "FAQ" }).click();
    await expect(page.locator("#nv-faq")).toBeInViewport();

    await page.getByRole("button", { name: "Residences" }).click();
    await expect(page.locator("#nv-listings")).toBeInViewport();
  });

  test("back to top appears once the page is scrolled and returns to the top", async ({ page }) => {
    const button = page.getByRole("button", { name: "Back to top" });
    await expect(button).toBeHidden();

    await page.mouse.wheel(0, 1400);
    await expect(button).toBeVisible();

    await button.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(40);
    await expect(button).toBeHidden();
  });
});

test.describe("the FAQ", () => {
  test("opens one answer at a time", async ({ page }) => {
    const questions = page.locator("#nv-faq button[aria-expanded]");
    const first = questions.first();
    const second = questions.nth(1);

    await expect(first).toHaveAttribute("aria-expanded", "false");

    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");

    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false");

    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("the newsletter", () => {
  test("records a sign-up and says so", async ({ page, identity, prisma }) => {
    await page.getByLabel("Email address").fill(identity.email);
    await page.getByRole("button", { name: "Notify Me" }).click();

    await expect(toast(page)).toContainText("we'll reach out when the next home is curated");
    await expect(page.getByLabel("Email address")).toHaveValue("");

    const row = await prisma.subscriber.findUnique({ where: { email: identity.email } });
    expect(row).not.toBeNull();
    expect(row?.unsubscribedAt).toBeNull();
  });

  /**
   * Answering an address already on the list differently would turn this endpoint into a free
   * "is this person a Nivasa subscriber" oracle, so the second sign-up gets the same sentence.
   */
  test("a repeat sign-up is answered identically and creates no second row", async ({
    page,
    identity,
    prisma,
  }) => {
    const email = page.getByLabel("Email address");
    const submit = page.getByRole("button", { name: "Notify Me" });

    await email.fill(identity.email);
    await submit.click();
    await expect(toast(page)).toContainText("we'll reach out");

    await email.fill(identity.email);
    await submit.click();
    await expect(toast(page)).toContainText("we'll reach out");

    expect(await prisma.subscriber.count({ where: { email: identity.email } })).toBe(1);
  });

  test("a malformed address never leaves the browser", async ({ page }) => {
    let posted = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/subscribers")) posted = true;
    });

    await page.getByLabel("Email address").fill("not-an-address");
    await page.getByRole("button", { name: "Notify Me" }).click();

    await expect(page.locator("input[type=email]:invalid")).toBeVisible();
    expect(posted).toBe(false);
  });
});

test.describe("the footer", () => {
  test("says plainly that the legal pages are placeholders", async ({ page }) => {
    await page.getByRole("button", { name: "Privacy Policy" }).click();
    await expect(toast(page)).toContainText("Add a real Privacy Policy page before launch.");

    await page.getByRole("button", { name: "Terms of Service" }).click();
    await expect(toast(page)).toContainText("Add real Terms of Service before launch.");
  });
});
