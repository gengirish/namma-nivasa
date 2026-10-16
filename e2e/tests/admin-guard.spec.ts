import { expect, test } from "../support/fixtures";
import { isAuthConfiguredInEnv } from "../support/env";

/**
 * The team area, approached by someone who is not on the team.
 *
 * These assertions are written to hold under both postures the app supports, because which one is
 * in force is an environment question, not a code question:
 *
 *   - **Clerk keys present** — `middleware.ts` answers "is anyone signed in" and turns an
 *     anonymous API call into a 401; a signed-in stranger gets 403 from `requireRole()`.
 *   - **Clerk keys absent** — middleware degrades to a pass-through and `requireRole()` refuses
 *     everything with 503, so the dashboard is *unreachable* rather than *unguarded*.
 *
 * What must never differ between them: no admin route answers with data, and none of them leaks
 * anything beyond the one sentence in the standard envelope.
 */

const DENIED = [401, 403, 503];

const ADMIN_ROUTES: { method: "get" | "post" | "patch" | "delete"; path: string }[] = [
  { method: "get", path: "/api/admin/enquiries" },
  { method: "patch", path: "/api/admin/enquiries/some-id" },
  { method: "get", path: "/api/admin/properties" },
  { method: "post", path: "/api/admin/properties" },
  { method: "get", path: "/api/admin/properties/some-id" },
  { method: "patch", path: "/api/admin/properties/some-id" },
  { method: "delete", path: "/api/admin/properties/some-id" },
  { method: "get", path: "/api/admin/submissions" },
  { method: "patch", path: "/api/admin/submissions/some-id" },
  { method: "post", path: "/api/admin/submissions/some-id/listing" },
  // Mints a write token for the Blob store. A refusal here matters more than most: the token is
  // the credential, so a route that issued one before checking the role would have handed out
  // write access to every listing's photographs.
  { method: "post", path: "/api/admin/uploads" },
];

test.describe("/api/admin", () => {
  test("refuses every route to a caller with no session, and answers with nothing else", async ({
    page,
  }) => {
    for (const route of ADMIN_ROUTES) {
      // No body on GET/DELETE — a request that fails to build would look like a passing refusal.
      const options = route.method === "post" || route.method === "patch" ? { data: {} } : {};
      const response = await page.request[route.method](route.path, options);

      expect(DENIED, `${route.method.toUpperCase()} ${route.path} was not refused`).toContain(
        response.status(),
      );

      const payload = await response.json();
      expect(payload.success).toBe(false);
      expect(typeof payload.error).toBe("string");
      // The envelope and nothing else — no stack, no Prisma message, no record.
      expect(Object.keys(payload).sort()).toEqual(["error", "success"]);
    }
  });

  /**
   * `/api/admin/bootstrap` is the one route under a protected prefix that cannot require an
   * `Admin` row — its whole purpose is a Clerk user who has none yet. It is reachable by design;
   * what it must not do is hand out an owner seat to an anonymous caller.
   */
  test("bootstrap is reachable but still refuses an anonymous caller", async ({ page, prisma }) => {
    const before = await prisma.admin.count();

    const response = await page.request.post("/api/admin/bootstrap", { data: {} });
    expect(DENIED).toContain(response.status());
    expect((await response.json()).success).toBe(false);

    expect(await prisma.admin.count()).toBe(before);
  });

  test("a refusal never carries a real enquiry with it", async ({ page, identity }) => {
    // A lead exists, so "the list is empty anyway" cannot be why nothing leaked.
    const created = await page.request.post("/api/enquiries", {
      data: { kind: "GENERAL", name: identity.name, phone: identity.phone },
    });
    expect(created.status()).toBe(201);

    const response = await page.request.get("/api/admin/enquiries");
    const body = await response.text();
    expect(body).not.toContain(identity.phone);
    expect(body).not.toContain(identity.marker);
  });
});

test.describe("/dashboard", () => {
  test("never renders the team's data to a caller with no session", async ({ page }) => {
    await page.goto("/dashboard");

    // Either the "not configured" screen, the sign-in bootstrap panel, or a redirect to sign-in —
    // never the working dashboard.
    await expect(page.getByRole("navigation").getByRole("link", { name: "Outbox" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0);

    if (!isAuthConfiguredInEnv()) {
      await expect(
        page.getByRole("heading", { name: "The team area is not configured" }),
      ).toBeVisible();
      await expect(page.getByText("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")).toBeVisible();
    }
  });

  test("offers a way back to the public site, which needs no account at all", async ({ page }) => {
    test.skip(isAuthConfiguredInEnv(), "with Clerk configured this is the sign-in screen instead");

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Back to homes" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find a home");
  });
});
