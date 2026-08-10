/**
 * Locators and small flows the specs share.
 *
 * Deliberately thin — no page-object class hierarchy for a site with four views. What lives here
 * is the handful of places where the right locator is not obvious from the markup: the listing
 * card is an `<article class="nv-card">` and the *smaller* recent/similar cards are `nv-card-sm`,
 * the enquiry modal and the lightbox are both `role="dialog"` and are told apart by their label,
 * and the toast is a permanently-mounted `role="status"` whose text is what changes.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import type { Identity } from "./fixtures";

export type ModalMode = "call" | "phonecall" | "message";

// ───────────────────────────────────────────────────────────────────── locators

export const listingCards = (page: Page): Locator => page.locator("article.nv-card");

export const cardFor = (page: Page, name: string): Locator =>
  listingCards(page).filter({ hasText: name });

export const enquiryModal = (page: Page): Locator =>
  page.getByRole("dialog", { name: /^Enquiry/ });

export const toast = (page: Page): Locator => page.getByRole("status");

export const savedBadge = (page: Page): Locator =>
  page.locator("[data-nav-saved] span").first();

export const slotButton = (page: Page, time: string): Locator =>
  enquiryModal(page).getByRole("button", { name: time, exact: true });

// ─────────────────────────────────────────────────────────────────────── flows

/**
 * Waits until React has taken over the server-rendered markup.
 *
 * This matters more here than in most apps: the whole visitor site is one server-rendered page
 * whose navigation, filter and shortlist are client state. Every control is present and looks
 * final before hydration, and a click that lands a moment early is simply swallowed — the test
 * then fails on the assertion afterwards, pointing at the wrong thing.
 *
 * React attaches a `__reactFiber$…` key to each host node as it hydrates it, and server-rendered
 * HTML has no such key — so this is the event itself rather than a proxy for it. (The tempting
 * alternative, waiting for `Reveal` to add `.nv-in`, only works for a card already in the
 * viewport; the listings sit below the fold at desktop sizes and would never fire.)
 */
export async function expectHydrated(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const node = document.querySelector("main, article.nv-card, [data-reveal]");
      return !!node && Object.keys(node).some((key) => key.startsWith("__reactFiber$"));
    },
    undefined,
    { timeout: 20_000 },
  );
}

export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find a home");
  await expectHydrated(page);
}

export async function openProperty(page: Page, name: string): Promise<void> {
  await cardFor(page, name).getByRole("button", { name: "View this home" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const MODAL_TRIGGER: Record<ModalMode, string | RegExp> = {
  call: /Schedule a Site Visit|No slots left this week/,
  phonecall: "Schedule a Call with Owner",
  message: "Leave a Message",
};

/** Opens the enquiry modal from a property's action card. */
export async function openEnquiryModal(page: Page, mode: ModalMode): Promise<Locator> {
  await page.getByRole("button", { name: MODAL_TRIGGER[mode] }).first().click();
  const modal = enquiryModal(page);
  await expect(modal).toBeVisible();
  return modal;
}

/**
 * Picks a date and waits for the server's answer for *that* date. The picker aborts an in-flight
 * request when the date changes and renders slots only when `availability.date` matches, so
 * waiting on the response rather than on the buttons is what makes this deterministic.
 */
export async function chooseDate(page: Page, date: string): Promise<void> {
  const answered = page.waitForResponse(
    (res) => res.url().includes("/availability?date=") && res.url().endsWith(date),
  );
  await enquiryModal(page).locator("#nv-date").fill(date);
  await answered;
  await expect(enquiryModal(page).getByText("Checking the owner")).toBeHidden();
}

export async function fillContactFields(
  page: Page,
  identity: Identity,
  extra: { email?: string; message?: string } = {},
): Promise<void> {
  const modal = enquiryModal(page);
  await modal.locator("#nv-name").fill(identity.name);
  await modal.locator("#nv-phone").fill(identity.phone);
  if (extra.email) await modal.locator("#nv-email").fill(extra.email);
  if (extra.message) await modal.locator("#nv-msg").fill(extra.message);
}

/** Submits and waits for the POST to land, so the assertion after it is never racing the fetch. */
export async function submitEnquiry(page: Page, label: string | RegExp): Promise<number> {
  const posted = page.waitForResponse(
    (res) => res.url().includes("/api/enquiries") && res.request().method() === "POST",
  );
  await enquiryModal(page).getByRole("button", { name: label }).click();
  return (await posted).status();
}

/** The reference on the confirmation panel, e.g. `NIV-7Q4KX2`. */
export async function receiptReference(page: Page): Promise<string> {
  const modal = enquiryModal(page);
  await expect(modal.getByText("Reference")).toBeVisible();
  const text = (await modal.textContent()) ?? "";
  const match = /NIV-[0-9A-Z]{6}/.exec(text);
  if (!match) throw new Error(`no reference on the receipt: ${text.slice(0, 300)}`);
  return match[0];
}
