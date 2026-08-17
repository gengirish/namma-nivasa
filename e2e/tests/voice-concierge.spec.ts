import type { Page } from "@playwright/test";

import { replyTo } from "../../lib/voice";
import { publishedProperties } from "../support/db";
import { expect, test } from "../support/fixtures";
import { gotoHome } from "../support/ui";

/**
 * The voice concierge.
 *
 * Two halves, tested two ways. `replyTo()` is keyword routing with no I/O, so it is called
 * directly — the intents it claims to handle are a product promise, and going through a microphone
 * to check them would test the browser instead.
 *
 * The UI half stubs the Web Speech API rather than asking what the browser under test happens to
 * ship. `webkitSpeechRecognition` is present in some Chromium builds and functional in almost
 * none, so a spec that let the real one decide would assert the idle copy on one machine and the
 * unsupported copy on another. Both paths matter — a visitor on Firefox gets the second one — so
 * both are pinned here with the API supplied by the test.
 */

const launcher = (page: Page) => page.getByRole("button", { name: "Voice concierge" });
/** The panel is a plain positioned div, not a dialog — its heading is what identifies it. */
const panelOpen = (page: Page) => page.getByText("Nivasa Voice", { exact: true });

/** Removes the API before any app code runs, which is what a Firefox visitor sees. */
async function withoutSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error — deleting a vendor-prefixed global the typings do not declare.
    delete window.SpeechRecognition;
    // @ts-expect-error — same.
    delete window.webkitSpeechRecognition;
  });
}

/** A recognition object that never hears anything, so `supported` resolves true deterministically. */
async function withFakeSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: unknown = null;
      onerror: unknown = null;
      onend: unknown = null;
      start() {}
      stop() {}
      abort() {}
    }
    // @ts-expect-error — standing in for a vendor-prefixed global.
    window.SpeechRecognition = FakeRecognition;
    // @ts-expect-error — same.
    window.webkitSpeechRecognition = FakeRecognition;
  });
}

test.describe("what the concierge answers", () => {
  test("routes each intent it claims to handle", async () => {
    const localities = ["Whitefield", "Indiranagar"];

    expect(replyTo("hello there").text).toContain("Nivasa concierge");
    expect(replyTo("I want to list my apartment")).toMatchObject({ action: "openList" });
    expect(replyTo("what does it cost").text).toContain("zero brokerage");
    expect(replyTo("can I schedule a viewing").text).toContain("Schedule a Site Visit");
    expect(replyTo("is there any brokerage").text).toContain("zero brokerage");
    /**
     * Neither "where are my saved homes" nor "show my shortlist": the branches are ordered
     * `includes()` checks, so the first spans the map intent ("where are") and the second spans
     * the owner-form intent — "list" is inside "short*list*". The order of these branches *is* the
     * routing, and a phrase that reaches two of them tests neither.
     */
    expect(replyTo("favourites").text).toContain("Saved");
    expect(replyTo("is there a walkthrough video").text).toContain("video walkthrough");
    expect(replyTo("thanks").text).toContain("Happy house-hunting");

    // The map intent names the localities it actually has, read as a sentence.
    const map = replyTo("where are these located", localities);
    expect(map.action).toBe("openMap");
    expect(map.text).toContain("Whitefield and Indiranagar");
    // …and stays sensible with nothing to name.
    expect(replyTo("show me the map").action).toBe("openMap");
  });

  test("falls back to an offer rather than guessing", async () => {
    const fallback = replyTo("qwertyuiop");
    expect(fallback.action).toBeUndefined();
    expect(fallback.text).toContain("What would you like to know?");
    // An empty utterance is the common case — a mic that heard nothing — and must not throw.
    expect(replyTo("").text).toBe(fallback.text);
  });

  test("names the real localities of the seeded catalogue", async () => {
    const all = await publishedProperties();
    const localities = [...new Set(all.map((p) => p.location.split(",")[0].trim()))];
    const reply = replyTo("where are your homes", localities);
    expect(reply.action).toBe("openMap");
    for (const locality of localities) {
      expect(reply.text).toContain(locality);
    }
  });
});

test.describe("the concierge panel", () => {
  test("opens, closes on its own button, and closes on Escape", async ({ page }) => {
    await withFakeSpeech(page);
    await gotoHome(page);

    await expect(launcher(page)).toHaveAttribute("aria-expanded", "false");
    await launcher(page).click();
    await expect(panelOpen(page)).toBeVisible();
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(panelOpen(page)).toBeHidden();

    await launcher(page).click();
    await expect(panelOpen(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panelOpen(page)).toBeHidden();
  });

  test("invites a tap when the browser can listen", async ({ page }) => {
    await withFakeSpeech(page);
    await gotoHome(page);
    await launcher(page).click();

    await expect(page.getByText("Tap the mic and ask away")).toBeVisible();

    const mic = page.getByRole("button", { name: "Tap to speak" });
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await mic.click();
    // The fake never returns a result, so it stays listening — which is the state being asserted.
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Listening…")).toBeVisible();
  });

  test("says so plainly when the browser cannot, instead of failing at the tap", async ({
    page,
  }) => {
    await withoutSpeech(page);
    await gotoHome(page);
    await launcher(page).click();

    await expect(page.getByText("Voice isn’t supported in this browser.")).toBeVisible();

    // The mic is still there and still answers — pointing at the path that does work rather than
    // doing nothing at all.
    await page.getByRole("button", { name: "Tap to speak" }).click();
    await expect(page.getByText("use Enquire instead")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tap to speak" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
