import { expect, test } from "../support/fixtures";
import { gotoHome } from "../support/ui";

/**
 * "List your home" — the owner side of the marketplace.
 *
 * The one thing this form must not do is imply an upload. There is no image storage in this
 * codebase: the file picker records *what an owner has* so a curator can ask for it, and
 * `mediaCount` is the only thing that reaches the database. A test that let a silent
 * bytes-discarding upload through would be worse than no test, so the count is asserted against
 * the row and the files are asserted to stay in the browser.
 */

const form = (page: import("@playwright/test").Page) =>
  page.locator("form").filter({ hasText: "Tell us about your home" });

async function openIntake(page: import("@playwright/test").Page) {
  await gotoHome(page);
  await page.getByRole("button", { name: "List Property" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("List your home with Nivasa");
}

test.describe("the owner intake form", () => {
  test("stores what the owner said and answers with a reference", async ({
    page,
    identity,
    prisma,
  }) => {
    await openIntake(page);

    await page.locator("#ol-name").fill(identity.name);
    await page.locator("#ol-phone").fill(identity.phone);
    await page.locator("#ol-email").fill(identity.email);
    await page.locator("#ol-locality").fill("Koramangala");
    await page.locator("#ol-type").selectOption("Villa / Independent house");
    await page.locator("#ol-config").selectOption("4 BHK");
    await page.locator("#ol-area").fill("2400");
    await page.locator("#ol-price").fill("3.2 Cr");
    await page.locator("#ol-timeline").selectOption("In 1–3 months");
    await page.locator("#ol-msg").fill("North-facing corner plot.");

    const posted = page.waitForResponse(
      (res) => res.url().includes("/api/owner-submissions") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Submit for review" }).click();
    expect((await posted).status()).toBe(201);

    await expect(page.getByRole("heading", { level: 2 })).toContainText(
      `Thank you, ${identity.marker}.`,
    );
    await expect(page.getByText("your home in Koramangala")).toBeVisible();

    const submission = await prisma.ownerSubmission.findFirstOrThrow({
      where: { name: identity.name },
    });
    expect(submission.reference).toMatch(/^NIV-O-[0-9A-Z]{6}$/);
    await expect(page.getByText(submission.reference)).toBeVisible();

    expect(submission.locality).toBe("Koramangala");
    expect(submission.propertyType).toBe("Villa / Independent house");
    expect(submission.config).toBe("4 BHK");
    expect(submission.areaSqft).toBe(2400);
    // Owners quote in crore; coercing that to paise would invent a precision they did not give.
    expect(submission.expectedPrice).toBe("3.2 Cr");
    expect(submission.timeline).toBe("In 1–3 months");
    expect(submission.phone).toBe(`+91${identity.phone}`);
    expect(submission.status).toBe("NEW");
  });

  test("notes the files an owner has without uploading any of them", async ({
    page,
    identity,
    prisma,
  }) => {
    await openIntake(page);

    const uploads: { name: string; mimeType: string; buffer: Buffer }[] = [
      { name: "living-room.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(2048, 1) },
      { name: "walkthrough.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(4096, 2) },
    ];
    await page.locator('input[type=file]').setInputFiles(uploads);

    await expect(page.getByText("2 files noted")).toBeVisible();
    await expect(page.getByText("living-room.jpg")).toBeVisible();
    await expect(page.getByText("walkthrough.mp4")).toBeVisible();
    // Told apart by type, so a curator knows what to ask for.
    await expect(form(page).getByText("Photo", { exact: true })).toBeVisible();
    await expect(form(page).getByText("Video", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Remove walkthrough.mp4" }).click();
    await expect(page.getByText("1 file noted")).toBeVisible();

    await page.locator("#ol-name").fill(identity.name);
    await page.locator("#ol-phone").fill(identity.phone);
    await page.locator("#ol-locality").fill("Jayanagar");

    // Nothing but JSON goes over the wire — no multipart, no bytes. Both waiters are armed
    // before the click: the request proves what was sent, the response is what the row depends
    // on, and reading the row after only the request would race the write.
    const sent = page.waitForRequest(
      (req) => req.url().includes("/api/owner-submissions") && req.method() === "POST",
    );
    const stored = page.waitForResponse(
      (res) => res.url().includes("/api/owner-submissions") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Submit for review" }).click();

    const request = await sent;
    expect(request.headers()["content-type"]).toContain("application/json");
    expect(request.postData()).not.toContain("living-room.jpg");
    expect((await stored).status()).toBe(201);

    const submission = await prisma.ownerSubmission.findFirstOrThrow({
      where: { name: identity.name },
    });
    expect(submission.mediaCount).toBe(1);
  });

  test("offers to list another home, from a blank form", async ({ page, identity }) => {
    await openIntake(page);

    await page.locator("#ol-name").fill(identity.name);
    await page.locator("#ol-phone").fill(identity.phone);
    await page.locator("#ol-locality").fill("Malleshwaram");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Thank you");

    await page.getByRole("button", { name: "List another home" }).click();
    await expect(page.locator("#ol-name")).toHaveValue("");
    await expect(page.locator("#ol-locality")).toHaveValue("");
  });

  test("a missing locality never leaves the browser", async ({ page, identity }) => {
    let posted = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/owner-submissions")) posted = true;
    });

    await openIntake(page);
    await page.locator("#ol-name").fill(identity.name);
    await page.locator("#ol-phone").fill(identity.phone);
    await page.getByRole("button", { name: "Submit for review" }).click();

    await expect(page.locator("#ol-locality:invalid")).toBeVisible();
    expect(posted).toBe(false);
  });

  /**
   * Four an hour per address. Generous for an owner with two homes, useless for a script.
   */
  test("refuses a fifth submission from the same connection within the hour", async ({
    page,
    identity,
  }) => {
    await gotoHome(page);
    const body = {
      name: identity.name,
      phone: identity.phone,
      locality: "Whitefield",
    };

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await page.request.post("/api/owner-submissions", { data: body });
      expect(response.status(), `submission ${attempt} was refused early`).toBe(201);
    }

    const refused = await page.request.post("/api/owner-submissions", { data: body });
    expect(refused.status()).toBe(429);
    expect((await refused.json()).error).toContain("Too many submissions from this connection");
  });
});
