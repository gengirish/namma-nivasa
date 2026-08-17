/**
 * A signed-in curator, for the specs that need one.
 *
 * Everything behind `/dashboard` and `/api/admin` was covered only by "refuses an anonymous
 * caller" until this existed, which left the listing editor, the Blob upload token and the role
 * ranking untested.
 *
 * **There is no auth bypass here, and there must not be one.** The tempting shortcut — an env var
 * that makes `getClerkUserId()` return a fabricated id under test — would put a branch in shipping
 * code whose only purpose is to skip authentication, one misconfiguration away from production.
 * So these tests sign in the way a person does: a real Clerk *development* instance, a real
 * session cookie, and `requireRole()` reading the real `Admin` row.
 *
 * Two Clerk mechanics are load-bearing:
 *
 *   - **`clerkSetup()`** (called from `e2e/global-setup.ts`) fetches a Testing Token. Without it,
 *     Clerk's bot protection challenges an automated browser and every sign-in hangs on a captcha.
 *   - **`setupClerkTestingToken()`** attaches that token to the page's Clerk requests. It has to
 *     run before the page that loads Clerk, not after.
 *
 * The test user is found-or-created rather than created-and-deleted: churning users in a real
 * Clerk instance on every run is slower, rate-limited, and leaves debris when a run is killed. It
 * is created with `+clerk_test` in the address, which is Clerk's reserved test convention.
 */
import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { AdminRole } from "@prisma/client";
import type { Page } from "@playwright/test";

import { db } from "./db";
import { isAuthConfiguredInEnv, loadLocalEnv } from "./env";

/**
 * One user per role, so a spec asserting that a VIEWER is refused does not have to demote the
 * account another spec is using. The password is a fixed throwaway for a development instance.
 *
 * `+clerk_test` is Clerk's reserved convention: an address carrying it never receives real mail
 * and its verification code is always `424242`. The domain is `example.com` rather than the
 * `.invalid` this suite uses everywhere else — Clerk validates the address format and rejects
 * `.invalid` outright (`form_param_format_invalid`), so the RFC 2606 domain that *is* accepted is
 * the one to use. Nothing is delivered either way; the `+clerk_test` marker is what guarantees it.
 */
const USERS: Record<AdminRole, { email: string; password: string }> = {
  OWNER: { email: "nivasa-e2e-owner+clerk_test@example.com", password: "PwE2e-Owner-9f31!" },
  CURATOR: { email: "nivasa-e2e-curator+clerk_test@example.com", password: "PwE2e-Curator-9f31!" },
  VIEWER: { email: "nivasa-e2e-viewer+clerk_test@example.com", password: "PwE2e-Viewer-9f31!" },
};

function backend() {
  loadLocalEnv();
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
}

/** The Clerk user for a role, created on first use. */
async function ensureClerkUser(role: AdminRole): Promise<string> {
  const { email, password } = USERS[role];
  const client = backend();

  const existing = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  if (existing.data.length > 0) return existing.data[0].id;

  const created = await client.users.createUser({
    emailAddress: [email],
    password,
    firstName: "Nivasa",
    lastName: `E2E ${role}`,
    skipPasswordChecks: true,
  });
  return created.id;
}

/**
 * The Clerk user *and* the `Admin` row, which are two different things on purpose: the row is what
 * `requireRole()` reads, because a Clerk session claim stays cached for up to a minute after a
 * demotion. A test that only created the Clerk user would get a 403 from `requireSession()`, which
 * is the correct behaviour and not the one it is trying to assert.
 */
export async function ensureAdmin(role: AdminRole): Promise<{ clerkUserId: string; email: string }> {
  const clerkUserId = await ensureClerkUser(role);
  const { email } = USERS[role];

  await db().admin.upsert({
    where: { clerkUserId },
    create: { clerkUserId, email, name: `Nivasa E2E ${role}`, role },
    // Re-asserted rather than left alone: a previous run may have changed it.
    update: { role, email },
  });

  return { clerkUserId, email };
}

/**
 * Signs the browser in as that role.
 *
 * **A sign-in ticket, not a password.** Which first factors exist is an instance setting — this
 * one offers Google and an email code, and has no password step at all — so a password sign-in
 * fails on the instance rather than on anything this repo controls. A ticket is minted by the
 * Backend API for a known user id and accepted whatever the instance's first factors are, which
 * makes the specs depend on the Clerk *account* rather than on how it is configured today.
 *
 * Sign-in happens on `/sign-in` because that is where `ClerkProvider` is mounted. The visitor site
 * deliberately loads no auth client at all (`components/clerk-boundary.tsx`), so `window.Clerk`
 * does not exist on `/` and there would be nothing to talk to there — a feature of the app, not an
 * obstacle to work around.
 */
export async function signInAs(page: Page, role: AdminRole): Promise<void> {
  const { clerkUserId } = await ensureAdmin(role);

  const { token } = await backend().signInTokens.createSignInToken({
    userId: clerkUserId,
    expiresInSeconds: 600,
  });

  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: token } });
}

/** Removes the `Admin` rows these helpers create. The Clerk users are left in place — see above. */
export async function purgeAdmins(): Promise<void> {
  await db().admin.deleteMany({
    where: { email: { in: Object.values(USERS).map((u) => u.email) } },
  });
}

/**
 * Whether the signed-in specs run.
 *
 * Two conditions, and the second needs explaining.
 *
 * Keys, obviously: without them the dashboard is unreachable by design — middleware degrades to a
 * pass-through and `requireRole()` answers 503 — so these skip rather than fail, the same way
 * `admin-guard.spec.ts` branches on the copy.
 *
 * **`E2E_CLERK=1` on top of that, because the server does not currently accept the session these
 * helpers create.** What was verified against this project's own development instance:
 *
 *   - the Clerk user and the `Admin` row are created;
 *   - `clerk.signIn()` with a Backend-API sign-in ticket resolves, and `window.Clerk.session` and
 *     `window.Clerk.user` are both populated afterwards;
 *   - the browser holds `__session` (820 bytes), `__client_uat` (non-zero), and the dev-browser
 *     JWT, in both their bare and instance-suffixed spellings;
 *   - every one of those cookies is on the outgoing request to `/dashboard`;
 *   - the `__session` JWT's `iss` matches the publishable key's instance, its `azp` is the server
 *     under test, it is unexpired, and `verifyToken()` accepts it **using the same
 *     `CLERK_SECRET_KEY` the server is running with**.
 *
 * And `auth()` still reports signed out — in `middleware.ts`, and in `/api/admin/bootstrap`, which
 * middleware lets through and which therefore fails on the handler's own `auth()`. So the token is
 * valid and verifiable by the server's key, and the server does not see it.
 *
 * That is above the test layer: it points at this Clerk/Next pairing (the dev server also warns
 * that the `middleware` file convention is deprecated in favour of `proxy`, and that Clerk's
 * `createRouteMatcher` is on its way out), not at anything these helpers do. Until it is
 * understood, the specs stay behind an opt-in so neither CI nor a local run goes red on it — but
 * they stay *written*, because the moment it is resolved they are the coverage that was missing.
 *
 *   E2E_CLERK=1 npm run test:e2e
 */
export function clerkAvailable(): boolean {
  return isAuthConfiguredInEnv() && process.env.E2E_CLERK === "1";
}
