import { expect, test } from "../support/fixtures";

/**
 * The installable shell and the document metadata.
 *
 * Small surface, but the failure mode is invisible from inside the app: a manifest that 404s, an
 * icon path that moved, or a `start_url` outside `scope` all leave the site working perfectly in
 * a browser tab and quietly un-installable.
 */

test.describe("the web app manifest", () => {
  test("is served, parses, and every icon it names resolves", async ({ page }) => {
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.name).toContain("Nivasa");
    expect(manifest.short_name).toBe("Nivasa");
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("en-IN");
    // start_url has to sit inside scope or the installed app opens outside itself.
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);

    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const asset = await page.request.get(icon.src);
      expect(asset.status(), `${icon.src} did not resolve`).toBe(200);
      expect(asset.headers()["content-type"]).toContain("image/png");
    }

    // An installable app needs a maskable icon, or Android crops the square one badly.
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  });

  test("the service worker file is served as script", async ({ page }) => {
    const response = await page.request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(await response.text()).toContain("self.addEventListener");
  });
});

test.describe("the document", () => {
  test("carries the metadata a share card and an install prompt read", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Nivasa/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-IN");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#1C1917");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /premium Bangalore residences/,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Nivasa/);
  });

  test("the visitor site loads no auth client", async ({ page }) => {
    const authRequests: string[] = [];
    page.on("request", (request) => {
      if (/clerk/i.test(request.url())) authRequests.push(request.url());
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Enquire" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // `ClerkProvider` is mounted per-segment, never at the root, precisely so browsing costs a
    // visitor nothing — and visitors have no accounts by design.
    expect(authRequests).toEqual([]);
  });
});
