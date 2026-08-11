/**
 * `.env.local` for the test process.
 *
 * Next reads `.env.local` on its own; the Playwright runner does not, and the specs talk to
 * Postgres directly to set up and assert state. This is the same resolution `scripts/db-env.mjs`
 * does for the Prisma CLI — including the `namma_nivasa_DATABASE_URL` prefix Neon publishes —
 * kept deliberately separate rather than imported, because that file is a process launcher and
 * this is a module.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.local");

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[match[1]] = value;
  }
  return out;
}

function pick(env: Record<string, string | undefined>, ...names: string[]): string | undefined {
  for (const name of names) {
    if (env[name]) return env[name];
    const suffix = `_${name}`;
    const hit = Object.keys(env).find((key) => key.endsWith(suffix) && env[key]);
    if (hit) return env[hit];
  }
  return undefined;
}

let loaded = false;

/** Idempotent. The real environment always wins, so `DATABASE_URL=… npm run test:e2e` works. */
export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  const fileEnv = parseEnvFile(ENV_FILE);
  for (const [key, value] of Object.entries(fileEnv)) {
    if (!process.env[key]) process.env[key] = value;
  }

  const url = pick(process.env, "DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL");
  if (url) process.env.DATABASE_URL = url;
}

export function databaseUrl(): string | undefined {
  loadLocalEnv();
  return process.env.DATABASE_URL;
}

/**
 * Whether the server under test has Clerk keys, which decides *how* the admin surface refuses —
 * 401/403 from the middleware when it is configured, 503 from `requireRole()` when it is not.
 * The specs assert the refusal either way and only branch on the copy.
 */
export function isAuthConfiguredInEnv(): boolean {
  loadLocalEnv();
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/**
 * The Svix secret the server under test verifies inbound webhooks against.
 *
 * Pinned by the suite rather than read from `.env.local`, and pushed into the server's
 * environment by `playwright.config.ts`, so the signed-request specs behave identically on a
 * machine that has an AgentMail account and one that does not. It is a throwaway constant: the
 * only thing it signs is a fabricated payload posted at a dev server on :3187.
 */
export const E2E_WEBHOOK_SECRET = "whsec_ZTJlLXRlc3Qtc2VjcmV0LW5vdC1hLXJlYWwtb25lLg==";

/**
 * Where the server under test addresses team notifications.
 *
 * Pinned for the same reason the webhook secret is: `NIVASA_TEAM_EMAIL` is a real mailbox in a
 * populated `.env.local`, so a suite that read it would assert against whatever address the
 * developer happened to configure, and would write that person's address into every
 * NotificationLog row it created. `.invalid` is reserved by RFC 2606 and can never resolve.
 */
export const E2E_TEAM_INBOX = "e2e-team@nivasa.invalid";

/**
 * What the server under test must NOT have.
 *
 * The webhook spec drives the real handler, and the real handler's next step is to call a model
 * and then send email to whatever address the payload names. Blanking these makes that
 * impossible rather than unlikely — a suite that could email a stranger because someone's
 * `.env.local` was fully populated is not a suite anyone should run twice.
 *
 * `AGENTMAIL_INBOX_ID` is the load-bearing blank: `agentMailConfigured()` needs both halves, so
 * clearing the inbox alone guarantees every `notify()` lands SKIPPED with the reason recorded.
 * That is what makes the outbound path assertable — the CC is computed and written to the log
 * row before delivery is attempted, so the specs can read exactly who a message *would* have
 * reached without anything leaving the machine.
 */
export const E2E_SERVER_ENV: Record<string, string> = {
  AGENTMAIL_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
  AGENTMAIL_INBOX_ID: "",
  ANTHROPIC_API_KEY: "",
  NIVASA_AGENT_AUTOSEND: "",
  NIVASA_TEAM_EMAIL: E2E_TEAM_INBOX,
};
