import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { E2E_SERVER_ENV, loadLocalEnv } from "./e2e/support/env";

/**
 * End-to-end tests: a real Next server against a real Postgres.
 *
 * There is no useful "mock the network" variant of this suite. `app/page.tsx` is a server
 * component that loads the whole published collection before any JavaScript runs, so the
 * catalogue a visitor sees never crosses a request a browser could intercept — the only honest
 * way to test what the page shows is to put rows in the database and look.
 *
 * Point it at the throwaway container from CLAUDE.md, not at anything that matters:
 *
 *   docker run -d --name nivasa-pg -e POSTGRES_PASSWORD=nivasa -e POSTGRES_USER=nivasa \
 *     -e POSTGRES_DB=nivasa -p 55432:5432 postgres:17-alpine
 *   npm run db:migrate && npm run db:seed
 *
 * `e2e/global-setup.ts` refuses to run against a non-local database unless
 * `E2E_ALLOW_REMOTE_DB=1` says so out loud.
 *
 * Knobs:
 *   PW_PORT=3187          which port the server under test listens on
 *   PW_BASE_URL=…         test an already-running server instead of starting one
 *   PW_PROD=1             build and `next start` rather than `next dev`
 *   PW_WORKERS=n          see the note on `workers` below
 */
loadLocalEnv();

// Not 3000: `npm run dev` is usually already there, and a suite that quietly tested whatever
// server happened to be running — against whatever database it was started with — would be
// worse than one that refuses to start.
const PORT = Number(process.env.PW_PORT ?? 3187);
/**
 * `localhost`, not `127.0.0.1`. Next 16's dev server refuses to serve `/_next/static` and the
 * HMR socket to an origin it was not started on — the page still server-renders, so a suite
 * pointed at the IP passes every static assertion and fails every interactive one, with nothing
 * in the browser console to say why. Naming the host the server names avoids editing
 * `allowedDevOrigins` in the app's own config to suit the tests.
 */
const BASE_URL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;
const PROD = process.env.PW_PROD === "1";

/**
 * Next 16 allows exactly one `next dev` per directory, and the way it says so is worth catching
 * here rather than discovering it three failures deep.
 *
 * A second instance still prints "Ready" and still binds its port — it just refuses to own the
 * build, so it answers the HTML 404 document for any route the *first* server has not compiled.
 * That reaches a spec as `SyntaxError: Unexpected token '<'` on an endpoint that works perfectly
 * when you curl it, and it moves around between runs depending on what the other server has been
 * asked for. `.next/dev/lock` is how Next tracks the owner, so this reads the same file.
 */
function assertNoOtherDevServer(): void {
  if (process.env.PW_BASE_URL || PROD) return;
  // This file is re-imported by every worker process, long after `webServer` took the lock for
  // itself. Only the run that is about to start a server has anything to check.
  if (process.env.TEST_WORKER_INDEX !== undefined) return;

  const lockFile = resolve(process.cwd(), ".next/dev/lock");
  if (!existsSync(lockFile)) return;

  let lock: { pid?: number; port?: number; appUrl?: string };
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    return; // half-written or stale — not worth blocking on
  }

  if (!lock.pid) return;
  // A server on our own port is one a previous run left behind; `webServer` reports that itself,
  // and far more clearly than this would.
  if (lock.port === PORT) return;
  try {
    process.kill(lock.pid, 0); // signal 0 only asks "is this process alive?"
  } catch {
    return; // the lock outlived the server that wrote it
  }

  throw new Error(
    [
      `A Next dev server for this repo is already running (pid ${lock.pid}, ${lock.appUrl}).`,
      "",
      "  Next allows one per directory. A second one starts, binds its port, and then serves",
      "  the HTML 404 page for routes the first has not compiled — so the suite fails in ways",
      "  that have nothing to do with the code. Pick one:",
      "",
      "    • stop that server and run again, or",
      `    • test against it:  PW_BASE_URL=${lock.appUrl} npm run test:e2e   (its database is`,
      "      whatever it was started with — check that first), or",
      "    • run a production build instead, which has no such restriction:  npm run test:e2e:prod",
    ].join("\n"),
  );
}

assertNoOtherDevServer();

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  // A dev server compiles a route the first time it is asked for, which can be several seconds
  // on a cold start; the assertion timeout stays tight so a genuinely stuck locator still fails
  // fast.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  /**
   * Serial by default, and the reason is the domain rather than flakiness: a property honours
   * `weeklyViewingSlots` viewings per week (2, 3 and 4 across the seeded homes), so two tests
   * booking into the same week concurrently would change the number the other one is asserting.
   * Rate limiting is already isolated per test by the `x-real-ip` fixture; this is the part that
   * cannot be. Raise it with PW_WORKERS if you are only running read-only specs.
   */
  fullyParallel: false,
  workers: Number(process.env.PW_WORKERS ?? 1),

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The site fades every card in on scroll via `[data-reveal]`. `app/globals.css` answers
    // `prefers-reduced-motion` by resolving those rules to `opacity: 1` and switching off every
    // animation and transition, so what a test sees never depends on an animation frame.
    contextOptions: { reducedMotion: "reduce" },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },

  projects: [
    {
      name: "chromium",
      // The responsive spec asserts what the `max-width: 760px` rules do; at 1280 it would be
      // asserting the opposite of what is on screen.
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      // Only the specs that assert responsive behaviour — running the rest again would be a
      // second pass over the same database for no extra coverage.
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: PROD
          ? `npm run build && npx next start --port ${PORT}`
          : `npx next dev --port ${PORT}`,
        url: BASE_URL,
        // A known webhook secret so the signed-request specs are deterministic, and blanked
        // AgentMail/Anthropic credentials so no run can reach a model or a real mailbox. See
        // `E2E_SERVER_ENV`.
        env: E2E_SERVER_ENV,
        // Never recycle a server someone else started: it may hold a different DATABASE_URL.
        reuseExistingServer: false,
        timeout: PROD ? 300_000 : 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
