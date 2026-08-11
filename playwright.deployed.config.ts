import { defineConfig, devices } from "@playwright/test";

/**
 * Read-only smoke tests against an already-deployed server.
 *
 * Separate from `playwright.config.ts` on purpose, and the separation is the safety property:
 * this config has **no `globalSetup`, no `globalTeardown` and no database connection at all**, so
 * there is no path by which it can write to, purge from, or assert against a production Postgres.
 * The main suite's setup exists to guarantee it is pointed at a throwaway container; the guarantee
 * here is that there is nothing to point.
 *
 * It also starts no server. `webServer` is absent rather than conditional — the target is a
 * deployment, and a config that could silently fall back to building one locally would let a green
 * run mean the wrong thing.
 *
 *   npm run test:e2e:deployed                              # the production alias
 *   PW_DEPLOY_URL=https://<preview>.vercel.app npm run test:e2e:deployed
 */
const BASE_URL = process.env.PW_DEPLOY_URL ?? "https://namma-nivasa.vercel.app";

if (!/^https?:\/\//.test(BASE_URL)) {
  throw new Error(`[e2e] PW_DEPLOY_URL must be an absolute URL, got: ${BASE_URL}`);
}

export default defineConfig({
  testDir: "./e2e/smoke",

  // A cold Vercel function pays its start-up on the first request, and this suite is the first
  // traffic a fresh deployment sees.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  // Read-only, so the weekly-quota reason the main suite runs serially does not apply. Kept
  // modest anyway: this points at a real deployment, and a smoke suite should not look like a
  // burst of traffic.
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS ?? 2),

  forbidOnly: !!process.env.CI,
  // A deployed target adds network flakiness the local suite does not have; one retry
  // distinguishes a dropped connection from a real regression.
  retries: Number(process.env.PW_RETRIES ?? 1),

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
});
