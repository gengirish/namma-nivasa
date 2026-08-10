/**
 * The fixtures every spec builds on.
 *
 * Two things here matter more than they look:
 *
 *   **A unique client IP per test.** Every public POST is rate-limited per address —
 *   6 enquiries an hour, 4 owner submissions, 8 sign-ups — and the in-memory limiter lives for
 *   the life of the dev server. Without this, the ninth test to submit a form fails with a 429
 *   that has nothing to do with what it was testing. `getClientIp()` prefers `x-real-ip` over
 *   `x-forwarded-for` precisely because the latter is caller-controlled, so that is the header
 *   used, and the spec that pins that precedence is `api-public.spec.ts`.
 *
 *   **A marker on every row a test writes.** The suite runs against a real database, and tests
 *   that book viewings consume a real weekly quota. Each test's rows carry its own marker and are
 *   deleted afterwards, so a week's availability is back where it started before the next test
 *   reads it.
 */
import { test as base, expect } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

import { db, markerFor, purgeMarker } from "./db";

export interface Identity {
  /** Present in every row this test writes; the key cleanup deletes by. */
  marker: string;
  /** "PWE2E-abc123 Visitor" — goes in the name field of every form. */
  name: string;
  /** A valid Indian mobile, stable for this test. */
  phone: string;
  email: string;
  /** The address this test is rate-limited as. */
  clientIp: string;
}

interface Fixtures {
  identity: Identity;
  prisma: PrismaClient;
}

/** Small, stable, and only ever used to spread tests across phone numbers and IP octets. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function identityFor(token: string): Identity {
  const marker = markerFor(token);
  const n = hash(token);
  const digits = String(n).padStart(9, "0").slice(0, 9);

  return {
    marker,
    name: `${marker} Visitor`,
    // [6-9] leading digit is what `normalizePhone` accepts as an Indian mobile.
    phone: `9${digits}`,
    email: `${marker.toLowerCase()}@e2e.invalid`,
    // 10.x.y.z — private, unroutable, and unique enough that two tests never share a bucket.
    clientIp: `10.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${(n % 254) + 1}`,
  };
}

export const test = base.extend<Fixtures>({
  identity: async ({}, use, testInfo) => {
    // Retries get their own identity so a retry never inherits the rate-limit bucket that the
    // failed attempt may have spent.
    const identity = identityFor(`${testInfo.testId}${testInfo.retry || ""}`);
    await use(identity);
    await purgeMarker(identity.marker);
  },

  // Applies to page navigations, in-page fetch(), and the `request` fixture alike.
  extraHTTPHeaders: async ({ identity }, use) => {
    await use({ "x-real-ip": identity.clientIp });
  },

  prisma: async ({}, use) => {
    await use(db());
  },
});

export { expect };
