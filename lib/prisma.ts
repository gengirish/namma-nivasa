import { PrismaClient } from "@prisma/client";

/**
 * Vercel's Neon integration publishes its variables **prefixed with the resource name** —
 * `namma_nivasa_DATABASE_URL`, not `DATABASE_URL` — because one project can hold several
 * databases. Prisma reads `env("DATABASE_URL")` from the schema, so on a perfectly healthy
 * deployment it would find nothing and every request would 500.
 *
 * Rather than depending on someone remembering to add an unprefixed alias in the dashboard,
 * resolve it here: exact name first, then any key ending in `_<name>`. `scripts/db-env.mjs`
 * does the same for the Prisma CLI, which cannot see this file.
 *
 * Anchored on the underscore so `namma_nivasa_DATABASE_URL` matches and a future
 * `SHADOW_DATABASE_URL` is not mistaken for the primary one.
 */
function pickEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const exact = process.env[name];
    if (exact) return exact;

    const suffix = `_${name}`;
    for (const [key, value] of Object.entries(process.env)) {
      if (value && key.endsWith(suffix)) return value;
    }
  }
  return undefined;
}

/**
 * `POSTGRES_PRISMA_URL` is Neon's pooled URL already carrying `pgbouncer=true` and a connection
 * limit, which is what a serverless function wants. Preferred over the plain pooled URL when the
 * integration publishes it; a hand-set `DATABASE_URL` still wins over both.
 */
export function databaseUrl(): string | undefined {
  return pickEnv("DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL");
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = databaseUrl();
  // Passing the URL explicitly overrides the schema's `env("DATABASE_URL")`. When it is absent
  // we let Prisma construct normally so the failure is Prisma's own, with its own message.
  return url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Whether a database is configured at all. Public pages call this before querying so a clone
 * with no connection string renders an empty collection instead of a 500 — the same
 * "boots with the integration unset" posture the rest of the app takes.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(databaseUrl());
}
