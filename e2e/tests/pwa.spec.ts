import { isAuthConfiguredInEnv } from "../support/env";
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
    const clerkScripts: string[] = [];
    const clerkOther: string[] = [];
    page.on("request", (request) => {
      if (!/clerk/i.test(request.url())) return;
      if (request.resourceType() === "script") clerkScripts.push(request.url());
      else clerkOther.push(request.url());
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Enquire" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // The invariant worth defending: `ClerkProvider` is mounted per-segment, never at the root,
    // so the visitor page ships no auth *client* — no clerk-js bundle to download, parse and run
    // for somebody who will never have an account. True with keys configured or without.
    expect(clerkScripts, "the visitor page must not download an auth client").toEqual([]);

    // Anything else clerk-shaped depends on how the server is configured, and the difference is
    // worth naming rather than hiding:
    //
    //   no keys — `clerkMiddleware` is skipped entirely, so nothing clerk-shaped exists at all.
    //   keys    — the middleware matcher covers every route (narrowing it is what would let a
    //             protected route drift out of the pattern), so Clerk runs before our handler
    //             returns `NextResponse.next()` and negotiates a `__clerk_handshake` on a first
    //             visit. That is a cookie round-trip, not an auth client — but it is a redirect
    //             and a third-party request in front of a visitor, so it is not free.
    if (!isAuthConfiguredInEnv()) {
      expect(clerkOther, "an unconfigured server should not mention Clerk at all").toEqual([]);
    }
  });
});
