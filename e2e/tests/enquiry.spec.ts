import { enquiryByReference, publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import {
  enquiryModal,
  gotoHome,
  openEnquiryModal,
  openProperty,
  receiptReference,
  submitEnquiry,
  toast,
} from "../support/ui";

/**
 * Enquiries that book nothing — the general "Enquire" in the header, and "Leave a Message" on a
 * listing. No slot means no scarcity, so what matters here is that the lead is stored, attributed
 * to the right home, and that a visitor who mistypes a phone number is told rather than thanked.
 *
 * Visitors have no accounts by design: an enquiry is a reference and a phone number. Every
 * assertion about "who this is" is therefore about `reference` and the normalised `phone`.
 */

test.describe("a general enquiry", () => {
  test("is not attached to any home", async ({ page, identity }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Enquire" }).click();

    const modal = enquiryModal(page);
    await expect(modal.getByRole("heading")).toContainText("Tell us what you're looking for");
    // Nothing to schedule without a listing.
    await expect(modal.locator("#nv-date")).toHaveCount(0);

    await modal.locator("#nv-name").fill(identity.name);
    await modal.locator("#nv-phone").fill(identity.phone);
    await modal.locator("#nv-msg").fill("Looking for a 3 BHK near Indiranagar.");
    expect(await submitEnquiry(page, /^Send$/)).toBe(201);

    await expect(modal.getByRole("heading")).toContainText("Message sent.");
    const enquiry = await enquiryByReference(await receiptReference(page));
    expect(enquiry!.kind).toBe("GENERAL");
    expect(enquiry!.propertyId).toBeNull();
    expect(enquiry!.propertyName).toBeNull();
    expect(enquiry!.status).toBe("NEW");
    expect(enquiry!.message).toBe("Looking for a 3 BHK near Indiranagar.");
    expect(enquiry!.viewing).toBeNull();
  });

  test("opens from the hero and from the footer as well as the header", async ({ page }) => {
    await gotoHome(page);

    for (const label of ["Talk to us", "Message us", "Enquire"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(enquiryModal(page).getByRole("heading")).toContainText(
        "Tell us what you're looking for",
      );
      await page.keyboard.press("Escape");
      await expect(enquiryModal(page)).toBeHidden();
    }
  });
});

test.describe("a message to an owner", () => {
  test("is attributed to the listing it was sent from", async ({ page, identity }) => {
    const [property] = await publishedProperties();
    await gotoHome(page);
    await openProperty(page, property.name);
    const modal = await openEnquiryModal(page, "message");

    await expect(modal.getByRole("heading")).toContainText("Leave a Message");
    await expect(modal).toContainText(`Send a message directly to the owner of ${property.name}`);
    await expect(modal.locator("#nv-date")).toHaveCount(0);

    await modal.locator("#nv-name").fill(identity.name);
    await modal.locator("#nv-phone").fill(identity.phone);
    await modal.locator("#nv-msg").fill("Is the balcony north facing?");
    expect(await submitEnquiry(page, "Send Message")).toBe(201);

    const enquiry = await enquiryByReference(await receiptReference(page));
    expect(enquiry!.kind).toBe("MESSAGE");
    expect(enquiry!.propertyName).toBe(property.name);
    expect(enquiry!.viewing).toBeNull();
  });
});

test.describe("what a visitor typed wrong", () => {
  test("a phone number that cannot be dialled is refused, and nothing is stored", async ({
    page,
    identity,
    prisma,
  }) => {
    await gotoHome(page);
    await page.getByRole("button", { name: "Enquire" }).click();

    const modal = enquiryModal(page);
    await modal.locator("#nv-name").fill(identity.name);
    await modal.locator("#nv-phone").fill("12345");
    expect(await submitEnquiry(page, /^Send$/)).toBe(400);

    await expect(toast(page)).toContainText("That phone number does not look right");
    // Still the form, not a confirmation.
    await expect(modal.locator("#nv-name")).toBeVisible();
    expect(await prisma.enquiry.count({ where: { name: { contains: identity.marker } } })).toBe(0);
  });

  /**
   * Four spellings of one number have to collide, because `Enquiry.phone` is the index the team
   * uses to recognise a repeat caller.
   */
  test("the same number typed four ways is stored once, one way", async ({ page, identity }) => {
    await gotoHome(page);
    const bare = identity.phone;
    const spellings = [bare, `+91 ${bare.slice(0, 5)} ${bare.slice(5)}`, `91${bare}`, `0${bare}`];

    const references: string[] = [];
    for (const [index, spelling] of spellings.entries()) {
      const response = await page.request.post("/api/enquiries", {
        data: { kind: "GENERAL", name: `${identity.marker} spelling ${index}`, phone: spelling },
      });
      expect(response.status(), `spelling "${spelling}" was refused`).toBe(201);
      references.push((await response.json()).data.reference);
    }

    const stored = await Promise.all(references.map((ref) => enquiryByReference(ref)));
    expect(stored.map((e) => e!.phone)).toEqual(spellings.map(() => `+91${bare}`));
  });

  test("an empty form never leaves the browser", async ({ page }) => {
    let posted = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/enquiries")) posted = true;
    });

    await gotoHome(page);
    await page.getByRole("button", { name: "Enquire" }).click();
    await enquiryModal(page).getByRole("button", { name: /^Send$/ }).click();

    await expect(enquiryModal(page).locator("#nv-name:invalid")).toBeVisible();
    expect(posted).toBe(false);
  });
});

test.describe("the modal itself", () => {
  test("takes focus, locks the page, and gives both back on close", async ({ page }) => {
    await gotoHome(page);
    const overflow = () => page.evaluate(() => document.body.style.overflow);

    await page.getByRole("button", { name: "Enquire" }).click();
    await expect(enquiryModal(page).locator("#nv-name")).toBeFocused();
    expect(await overflow()).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(enquiryModal(page)).toBeHidden();
    expect(await overflow()).toBe("");
  });

  test("closes on the backdrop and on the close button, but not on the panel", async ({ page }) => {
    await gotoHome(page);

    await page.getByRole("button", { name: "Enquire" }).click();
    // A click inside the panel must not dismiss a half-filled form.
    await enquiryModal(page).getByRole("heading").click();
    await expect(enquiryModal(page)).toBeVisible();

    await enquiryModal(page).click({ position: { x: 5, y: 5 } });
    await expect(enquiryModal(page)).toBeHidden();

    await page.getByRole("button", { name: "Enquire" }).click();
    await enquiryModal(page).getByRole("button", { name: "Close" }).click();
    await expect(enquiryModal(page)).toBeHidden();
  });

  test("forgets what was typed once it is closed", async ({ page, identity }) => {
    await gotoHome(page);

    await page.getByRole("button", { name: "Enquire" }).click();
    await enquiryModal(page).locator("#nv-name").fill(identity.name);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Enquire" }).click();
    await expect(enquiryModal(page).locator("#nv-name")).toHaveValue("");
  });
});
