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
