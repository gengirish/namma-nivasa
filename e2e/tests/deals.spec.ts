/**
 * Nivasa Close — the deal room's persistence, rules, admin boundary and morning cron.
 *
 * Three layers, each tested where it can honestly be reached:
 *
 *   - **The admin boundary**, over HTTP with no session — every /api/admin/deals* route refuses,
 *     under either auth posture, with nothing but the envelope (as `admin-guard.spec.ts`).
 *   - **The rules in lib/deals.ts**, called directly against the database. Every deal route is
 *     CURATOR-only and the signed-in specs are gated off (see CLAUDE.md, "Tests"), so over HTTP
 *     none of this would run at all. Calling the lib is what `autosend-gate.spec.ts` does for the
 *     same reason, and it exercises exactly the code the routes delegate to.
 *   - **The cron**, over HTTP against the server under test, as `reminders.spec.ts` does: that
 *     server has AgentMail blanked and `CRON_SECRET` pinned, so the digest lands SKIPPED in
 *     NotificationLog with its body readable and nothing leaves the machine.
 *
 * The lib-level calls run in *this* process, which loaded `.env.local`. Before any of them, the
 * same blanks the server gets are applied here, so a populated `.env.local` cannot turn a test
 * into a real email.
 *
 * Every deal carries the test's marker in `propertyLabel`; `purgeMarker()` deletes by it, and
 * parties, milestones, documents and payments cascade.
 */
import type { PrismaClient } from "@prisma/client";

import {
  addPayment,
  createDeal,
  createDealFromEnquiry,
  getDeal,
  renderDocument,
  updateSheet,
} from "../../lib/deals";
import { PLAYBOOKS } from "../../lib/deal-playbooks";
import { clerkAvailable, signInAs } from "../support/clerk";
import { E2E_CRON_SECRET, E2E_SERVER_ENV } from "../support/env";
import { expect, test } from "../support/fixtures";
import { istInstant, istToday } from "../support/ist";

for (const [key, value] of Object.entries(E2E_SERVER_ENV)) process.env[key] = value;

const DENIED = [401, 403, 503];
const CRON_PATH = "/api/cron/deal-milestones";

/** The sanitised A-1042 fixture from handover §10, as a sheet. */
function fixtureSheet(marker: string, executionDate: string | null) {
  return {
    propertyLabel: `${marker} Sobha Dream Gardens, Wing 1, A-1042`,
    builder: "Sobha Limited",
    builderAgreementDate: "2023-11-21",
    associationName: "Sobha Dream Gardens owners association",
    superBuiltUpSqft: 1009.97,
    considerationPaise: 1_160_000_000,
    deadlineDays: 60,
    extensionDays: 15,
    executionDate,
    sellers: [
      { name: "Seller One", shareBps: 5000, email: "seller1@example.com" },
      { name: "Seller Two", shareBps: 5000, email: "seller2@example.com" },
    ],
    buyer: { name: "Buyer One", email: "buyer@example.com" },
    sellerBank: { name: "SBI", branch: "RACPC", loanLast4: "0000" },
    stampDutyPayer: "BUYER",
    transferFeePayer: "SELLER",
    penaltyPaise: 30_000_000,
    lateSelfFundingPenaltyPerDayPaise: 500_000,
  };
}

const FIXTURE_PAYMENTS = [
  { kind: "TOKEN", amountPaise: 10_000_000, toLabel: "Seller One", paidAt: "2026-10-13" },
  { kind: "BOOKING", amountPaise: 15_000_000, toLabel: "Seller One", paidAt: null },
  { kind: "BOOKING", amountPaise: 25_000_000, toLabel: "Seller Two", paidAt: null },
  { kind: "SELF_FUNDING", amountPaise: 110_000_000, toLabel: "Sellers", paidAt: null },
] as const;

async function newDeal(marker: string, executionDate: string | null) {
  const created = await createDeal(
    { playbook: "BUILDER_ASSIGNMENT", propertyLabel: `${marker} Sobha Dream Gardens, Wing 1, A-1042` },
    null,
  );
  return { created, sheet: fixtureSheet(marker, executionDate) };
}

async function purgeDeals(prisma: PrismaClient, marker: string) {
  await prisma.deal.deleteMany({ where: { propertyLabel: { contains: marker } } });
}

// ─────────────────────────────────────────────────────────────────────────────
// The boundary
// ─────────────────────────────────────────────────────────────────────────────

const DEAL_ROUTES: { method: "get" | "post" | "patch" | "delete"; path: string }[] = [
  { method: "get", path: "/api/admin/deals" },
  { method: "post", path: "/api/admin/deals" },
  { method: "get", path: "/api/admin/deals/some-id" },
  { method: "patch", path: "/api/admin/deals/some-id" },
  { method: "patch", path: "/api/admin/deals/some-id/milestones/some-milestone" },
  { method: "post", path: "/api/admin/deals/some-id/payments" },
  { method: "patch", path: "/api/admin/deals/some-id/payments/some-payment" },
  { method: "delete", path: "/api/admin/deals/some-id/payments/some-payment" },
  { method: "post", path: "/api/admin/deals/some-id/documents" },
  // Serves HTML on success — a refusal must still be the JSON envelope, not a document.
  { method: "get", path: "/api/admin/deals/some-id/documents/some-doc" },
  // A paid model call on pasted personal chat; refusing before the body is read matters.
  { method: "post", path: "/api/admin/deals/some-id/extract" },
  // Sends email to real parties.
  { method: "post", path: "/api/admin/deals/some-id/party-update" },
];

test.describe("/api/admin/deals", () => {
  test("refuses every route to a caller with no session, and answers with nothing else", async ({
    page,
  }) => {
    for (const route of DEAL_ROUTES) {
      const options = route.method === "post" || route.method === "patch" ? { data: {} } : {};
      const response = await page.request[route.method](route.path, options);

      expect(DENIED, `${route.method.toUpperCase()} ${route.path} was not refused`).toContain(
        response.status(),
      );
      const payload = await response.json();
      expect(payload.success).toBe(false);
      expect(Object.keys(payload).sort()).toEqual(["error", "success"]);
    }
  });
});

test.describe("the deal-milestone cron's door", () => {
  test("refuses a caller without the secret", async ({ page }) => {
    expect((await page.request.get(CRON_PATH)).status()).toBe(401);
    const wrong = await page.request.get(CRON_PATH, {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status()).toBe(401);
    expect(Object.keys(await wrong.json()).sort()).toEqual(["error", "success"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lib/deals.ts against the database
// ─────────────────────────────────────────────────────────────────────────────

test.describe("a deal, from playbook to final MOU", () => {
  test.afterEach(async ({ prisma, identity }) => {
    await purgeDeals(prisma, identity.marker);
  });

  test("expands the playbook into undated milestones, as a DRAFT", async ({ identity }) => {
    const { created } = await newDeal(identity.marker, null);

    expect(created.reference).toMatch(/^CLS-[0-9A-Z]{6}$/);
    expect(created.status).toBe("DRAFT");
    expect(created.milestones).toHaveLength(PLAYBOOKS.BUILDER_ASSIGNMENT.milestones.length);
    expect(created.milestones.map((m) => m.key)).toEqual(
      PLAYBOOKS.BUILDER_ASSIGNMENT.milestones.map((m) => m.key),
    );
    // No execution date yet: a countdown from a guessed date is worse than none.
    expect(created.milestones.every((m) => m.dueAt === null)).toBe(true);
    expect(created.deadlineAt).toBeNull();
  });

  test("a complete sheet dates the deal from the MOU and makes it ACTIVE", async ({
    identity,
    prisma,
  }) => {
    const { created, sheet } = await newDeal(identity.marker, "2026-10-16");
    const deal = await updateSheet(created.id, sheet, null);

    // 16 Oct + 60 days = 15 Dec, due at the last instant of that day in Bangalore — resolved
    // through tzdata here, not through the app's own offset constant.
    const endOf15Dec = istInstant("2026-12-16", "12:00 AM").getTime() - 1;
    expect(deal.deadlineAt).toBe(new Date(endOf15Dec).toISOString());
    expect(deal.mouSignedAt).toBe(istInstant("2026-10-16", "12:00 AM").toISOString());

    // ACTIVE until the last ten days with something overdue; after 5 Dec 2026 the fixture's
    // 16 Oct milestones are both, so a suite run that late correctly reads AT_RISK.
    const riskWindowOpens = endOf15Dec - 10 * 24 * 60 * 60 * 1000;
    expect(deal.status).toBe(Date.now() < riskWindowOpens ? "ACTIVE" : "AT_RISK");

    // Parties are the sheet's, one row each.
    const roles = deal.parties.map((p) => p.role).sort();
    expect(roles).toEqual(["ASSOCIATION", "BUILDER", "BUYER", "SELLER", "SELLER", "SELLER_BANK"]);
    expect(deal.parties.filter((p) => p.role === "SELLER").map((p) => p.shareBps)).toEqual([5000, 5000]);

    // Every playbook milestone is dated now.
    expect(deal.milestones.every((m) => m.dueAt !== null)).toBe(true);
    const handover = deal.milestones.find((m) => m.key === "handover");
    expect(handover?.dueAt).toBe(new Date(endOf15Dec).toISOString());

    const row = await prisma.deal.findUnique({ where: { id: created.id } });
    expect(Number(row?.considerationPaise)).toBe(1_160_000_000);
  });

  test("records the ledger and reconciles it against the consideration", async ({ identity }) => {
    const { created, sheet } = await newDeal(identity.marker, "2026-10-16");
    await updateSheet(created.id, sheet, null);
    for (const p of FIXTURE_PAYMENTS) {
      await addPayment(created.id, { ...p, fromLabel: "Buyer One" });
    }

    const deal = await getDeal(created.id);
    expect(deal.payments).toHaveLength(4);
    expect(deal.ledger?.paidPaise).toBe(10_000_000);
    expect(deal.ledger?.plannedPaise).toBe(150_000_000);
    expect(deal.ledger?.outstandingPaise).toBe(1_150_000_000);
    // §10 expected values.
    expect(deal.ledger?.derived.tdsPaise).toBe(11_600_000);
    expect(deal.ledger?.derived.tdsBySeller.map((s) => s.tdsPaise)).toEqual([5_800_000, 5_800_000]);
    expect(deal.ledger?.derived.netToSellersPaise).toBe(1_148_400_000);
    // A paid date reads back as the IST day it was entered as.
    expect(deal.payments.find((p) => p.kind === "TOKEN")?.paidAt).toBe(
      new Date("2026-10-13T12:00:00+05:30").toISOString(),
    );
  });

  test("renders a draft MOU, and refuses a final one while a notices email is missing", async ({
    identity,
    prisma,
  }) => {
    const { created, sheet } = await newDeal(identity.marker, "2026-10-16");
    await updateSheet(created.id, sheet, null);
    for (const p of FIXTURE_PAYMENTS) {
      await addPayment(created.id, { ...p, fromLabel: "Buyer One" });
    }

    const draft = await renderDocument(created.id, "MOU", { final: false }, null);
    expect(draft.document.kind).toBe("MOU");
    expect(draft.document.version).toBe(1);
    expect(draft.document.final).toBe(false);
    expect(draft.html).toContain("<");

    // Rule 3: the notices clause relies on email, so every party in it needs one.
    await updateSheet(
      created.id,
      { sellers: [sheet.sellers[0], { ...sheet.sellers[1], email: null }] },
      null,
    );
    const withIssue = await getDeal(created.id);
    expect(withIssue.issues.some((i) => i.rule === 3 && i.severity === "error")).toBe(true);

    await expect(renderDocument(created.id, "MOU", { final: true }, null)).rejects.toThrow(
      /consistency error/,
    );
    // The refusal wrote nothing: still only the draft.
    expect(await prisma.dealDocument.count({ where: { dealId: created.id } })).toBe(1);
  });

  test("never stores a full PAN, under any key", async ({ identity, prisma }) => {
    const { created, sheet } = await newDeal(identity.marker, "2026-10-16");
    await updateSheet(created.id, sheet, null);

    await expect(
      updateSheet(created.id, { buyer: { ...sheet.buyer, pan: "ABCDE1234F" } }, null),
    ).rejects.toThrow(/PAN/);
    await expect(
      updateSheet(created.id, { possessionNotes: "Buyer PAN ABCDE1234F on file" }, null),
    ).rejects.toThrow(/PAN/);

    // Full PANs in a render reach the response, not the stored version.
    await addPayment(created.id, { ...FIXTURE_PAYMENTS[0], fromLabel: "Buyer One" });
    const rendered = await renderDocument(
      created.id,
      "MOU",
      { final: false, fullPans: { "Seller One": "ABCDE1234F" } },
      null,
    );
    const stored = await prisma.dealDocument.findUnique({ where: { id: rendered.document.id } });
    expect(stored?.html).not.toContain("ABCDE1234F");
    const row = await prisma.deal.findUnique({ where: { id: created.id } });
    expect(JSON.stringify(row?.sheet)).not.toContain("ABCDE1234F");
  });

  test("one click from a CLOSED enquiry, and only once", async ({ identity, prisma }) => {
    const enquiry = await prisma.enquiry.create({
      data: {
        reference: `NIV-${identity.marker.slice(-6).toUpperCase()}`,
        kind: "GENERAL",
        status: "NEW",
        propertyName: `${identity.marker} Enquired Home`,
        name: identity.name,
        phone: "+919000000003",
        email: identity.email,
      },
    });

    await expect(createDealFromEnquiry(enquiry.id, null)).rejects.toThrow(/CLOSED/);

    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "CLOSED" } });
    const deal = await createDealFromEnquiry(enquiry.id, null);
    expect(deal.enquiryId).toBe(enquiry.id);
    expect(deal.propertyLabel).toBe(`${identity.marker} Enquired Home`);
    expect(deal.parties.find((p) => p.role === "BUYER")?.email).toBe(identity.email);

    await expect(createDealFromEnquiry(enquiry.id, null)).rejects.toThrow(/already has a deal/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The cron, over HTTP
// ─────────────────────────────────────────────────────────────────────────────

test.describe("the deal-milestone cron", () => {
  test.afterEach(async ({ prisma, identity }) => {
    await purgeDeals(prisma, identity.marker);
  });

  test("sends one digest per IST day, and stamps exactly what it sent", async ({
    page,
    identity,
    prisma,
  }) => {
    // Signed today, so the MOU-day milestones are due today and the day-one request tomorrow.
    const { created, sheet } = await newDeal(identity.marker, istToday());
    await updateSheet(created.id, sheet, null);

    const run = () =>
      page.request.get(CRON_PATH, { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
    expect((await run()).status()).toBe(200);
    expect((await run()).status()).toBe(200);

    const digests = await prisma.notificationLog.findMany({
      where: { type: "DEAL_MILESTONE_DUE", body: { contains: identity.marker } },
    });
    expect(digests, "a second run the same day must not repeat the digest").toHaveLength(1);
    expect(digests[0].body).toContain(created.reference);
    expect(digests[0].body).toContain(`/dashboard/deals/${created.id}`);

    const milestones = await prisma.dealMilestone.findMany({ where: { dealId: created.id } });
    const endOfTomorrow = istInstant(istToday(), "12:00 AM").getTime() + 2 * 24 * 60 * 60 * 1000 - 1;
    const due = milestones.filter((m) => m.dueAt && m.dueAt.getTime() <= endOfTomorrow);
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((m) => m.lastNotifiedAt !== null)).toBe(true);
    expect(
      milestones.filter((m) => !due.includes(m)).every((m) => m.lastNotifiedAt === null),
      "milestones not yet due must not be stamped",
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Signed in — gated like admin-api.spec.ts
// ─────────────────────────────────────────────────────────────────────────────

test.describe("the deals API, signed in", () => {
  test.skip(!clerkAvailable(), "needs E2E_CLERK=1 and Clerk keys — see e2e/support/clerk.ts");

  test.afterEach(async ({ prisma, identity }) => {
    await purgeDeals(prisma, identity.marker);
  });

  test("a curator creates a deal and finds it in the list", async ({ page, identity }) => {
    await signInAs(page, "CURATOR");

    const created = await page.request.post("/api/admin/deals", {
      data: { playbook: "REGISTERED_RESALE", propertyLabel: `${identity.marker} Test Flat` },
    });
    expect(created.status()).toBe(201);
    const { data } = await created.json();
    expect(data.status).toBe("DRAFT");
    expect(data.milestones).toHaveLength(PLAYBOOKS.REGISTERED_RESALE.milestones.length);

    const list = await page.request.get("/api/admin/deals");
    const ids = (await list.json()).data.map((d: { id: string }) => d.id);
    expect(ids).toContain(data.id);
  });
});
