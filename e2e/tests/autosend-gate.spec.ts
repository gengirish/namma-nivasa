import type { ReplyIntent } from "@prisma/client";

import { AUTO_SEND_BUDGET_PER_THREAD } from "../../lib/email-threads";
import { autoSendEnabled, autoSendRefusal } from "../../lib/reply-agent";
import { expect, test } from "../support/fixtures";

/**
 * The autonomy gate — the code that decides whether a model-written email reaches a stranger
 * without a person reading it first.
 *
 * This is the highest-consequence logic in the repo and it had no test, for a structural reason:
 * `E2E_SERVER_ENV` blanks `ANTHROPIC_API_KEY`, so no draft is ever composed under test and the
 * gate never runs. Blanking the key is right — a suite that could reach a model and then mail
 * whatever address a payload named is not one anybody should run twice — so the gate is exercised
 * where it can be reached instead: `autoSendRefusal()` is exported, pure, and takes the composed
 * draft as an argument.
 *
 * Calling it directly is what keeps production code honest. The alternative was a test-only branch
 * inside `compose()` returning a canned reply, and a seam whose entire purpose is to bypass the
 * model would sit one env var away from the send path it guards.
 *
 * `autoSendEnabled()` reads `process.env` at call time, so the switch flipped here is **this
 * process's**, not the server's. Nothing in these tests touches the server at all.
 */

interface Draft {
  intent: ReplyIntent;
  confidence: number;
  answeredFromFacts: boolean;
  subject: string;
  body: string;
  rationale: string;
}

/** A draft that clears every condition, so each test can spoil exactly one. */
function goodDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    intent: "PROPERTY_QUESTION",
    confidence: 95,
    answeredFromFacts: true,
    subject: "Re: your enquiry",
    body: "The home has covered parking for two cars.",
    rationale: "Answered from the amenities in the facts block.",
    ...overrides,
  };
}

/** Sets the flag for one assertion and puts back whatever was there. */
async function withAutosend(on: boolean, fn: () => void | Promise<void>): Promise<void> {
  const before = process.env.NIVASA_AGENT_AUTOSEND;
  process.env.NIVASA_AGENT_AUTOSEND = on ? "1" : "";
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.NIVASA_AGENT_AUTOSEND;
    else process.env.NIVASA_AGENT_AUTOSEND = before;
  }
}

test.describe("the flag", () => {
  test("is off unless it is exactly 1", async () => {
    for (const value of ["", "0", "true", "yes", "on", " 1"]) {
      await withAutosend(false, () => {
        process.env.NIVASA_AGENT_AUTOSEND = value;
        expect(autoSendEnabled(), `"${value}" must not enable autosend`).toBe(false);
      });
    }
    await withAutosend(true, () => expect(autoSendEnabled()).toBe(true));
  });

  test("holds everything while it is off, however perfect the draft", async () => {
    await withAutosend(false, () => {
      expect(autoSendRefusal(goodDraft(), 0)).toBe("Autonomous sending is off");
    });
  });
});

test.describe("what may go out alone", () => {
  test("a whitelisted, confident, grounded draft with budget left", async () => {
    await withAutosend(true, () => {
      for (const intent of ["PROPERTY_QUESTION", "LOGISTICS", "VIEWING_CONFIRM"] as const) {
        expect(autoSendRefusal(goodDraft({ intent }), 0), `${intent} should pass`).toBeNull();
      }
    });
  });

  test("nothing else, whatever the model thought of itself", async () => {
    const off: ReplyIntent[] = [
      "VIEWING_RESCHEDULE",
      "VIEWING_CANCEL",
      "PRICE_NEGOTIATION",
      "DOCUMENTS",
      "OTHER",
      "UNCLEAR",
    ];

    await withAutosend(true, () => {
      for (const intent of off) {
        // Maximum confidence and fully grounded: the point is that the intent decides, not the
        // model's own assessment of how safe its message is.
        const held = autoSendRefusal(goodDraft({ intent, confidence: 100 }), 0);
        expect(held, `${intent} must never send unattended`).toBe(`${intent} always goes to review`);
      }
    });
  });

  /**
   * Rescheduling and cancelling are off the whitelist as a product promise, not a tuning
   * constant: a moved slot means an owner has already been told something that is no longer true,
   * and no email should imply otherwise. This is the assertion that fails if someone widens the
   * list looking for throughput.
   */
  test("moving or cancelling a viewing always waits for a person", async () => {
    await withAutosend(true, () => {
      expect(autoSendRefusal(goodDraft({ intent: "VIEWING_RESCHEDULE" }), 0)).not.toBeNull();
      expect(autoSendRefusal(goodDraft({ intent: "VIEWING_CANCEL" }), 0)).not.toBeNull();
    });
  });
});

test.describe("the remaining conditions", () => {
  test("confidence below the floor is held, and the floor is named", async () => {
    await withAutosend(true, () => {
      expect(autoSendRefusal(goodDraft({ confidence: 79 }), 0)).toBe(
        "Confidence 79 is below the floor of 80",
      );
      // The floor is inclusive — 80 is enough.
      expect(autoSendRefusal(goodDraft({ confidence: 80 }), 0)).toBeNull();
    });
  });

  test("a draft that went beyond the facts is held", async () => {
    await withAutosend(true, () => {
      expect(autoSendRefusal(goodDraft({ answeredFromFacts: false }), 0)).toBe(
        "The reply does not answer entirely from what we hold",
      );
    });
  });

  test("a thread that has spent its budget is held", async () => {
    await withAutosend(true, () => {
      // One under the budget still goes.
      expect(autoSendRefusal(goodDraft(), AUTO_SEND_BUDGET_PER_THREAD - 1)).toBeNull();

      const spent = autoSendRefusal(goodDraft(), AUTO_SEND_BUDGET_PER_THREAD);
      expect(spent).toBe(
        `This thread has already had ${AUTO_SEND_BUDGET_PER_THREAD} automatic replies`,
      );
      // And past it, which is the state a race would leave behind.
      expect(autoSendRefusal(goodDraft(), AUTO_SEND_BUDGET_PER_THREAD + 5)).not.toBeNull();
    });
  });

  test("the first failing condition is the one reported", async () => {
    // A draft that fails everything reads as "off" — the cheapest check runs first, and the
    // reason shown beside a held draft in the dashboard should be the one a curator can act on.
    await withAutosend(false, () => {
      expect(
        autoSendRefusal(
          goodDraft({ intent: "PRICE_NEGOTIATION", confidence: 10, answeredFromFacts: false }),
          99,
        ),
      ).toBe("Autonomous sending is off");
    });
  });
});
