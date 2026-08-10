/**
 * Refuses to run the suite unless the database it is pointed at is one it may write to, and
 * unless the catalogue it is about to assert against is actually seeded.
 *
 * The specs create enquiries, book viewings and delete rows by marker. Every one of those is
 * harmless against the throwaway container and none of them are against a real one, so the check
 * is a hard stop rather than a warning.
 */
import type { FullConfig } from "@playwright/test";

import { databaseUrl, loadLocalEnv } from "./support/env";
import { db, disconnectDb, purgeAllE2EData } from "./support/db";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal", "postgres", "db"]);

function assertLocalDatabase(url: string): void {
  if (process.env.E2E_ALLOW_REMOTE_DB === "1") {
    console.warn("[e2e] E2E_ALLOW_REMOTE_DB=1 — writing test rows to a non-local database.");
    return;
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[e2e] DATABASE_URL is not a URL this setup can check: ${url.slice(0, 24)}…`);
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      [
        `[e2e] refusing to run against "${host}".`,
        "",
        "  These tests create and delete rows. Point DATABASE_URL at a local Postgres:",
        "",
        "    docker run -d --name nivasa-pg -e POSTGRES_PASSWORD=nivasa -e POSTGRES_USER=nivasa \\",
        "      -e POSTGRES_DB=nivasa -p 55432:5432 postgres:17-alpine",
        "    npm run db:migrate && npm run db:seed",
        "",
        "  If you genuinely mean to use this database, set E2E_ALLOW_REMOTE_DB=1.",
      ].join("\n"),
    );
  }
}

/**
 * Asks for every API route once before the suite starts.
 *
 * `next dev` compiles a route the first time it is requested, and while that is in flight the
 * server can answer with the HTML 404 document rather than waiting — which reaches a test as
 * `SyntaxError: Unexpected token '<'` on a route that is perfectly fine. Warming them here turns
 * a rare, order-dependent failure into a deterministic cost paid once, and it keeps the first
 * test's timeout from being mostly compilation.
 *
 * Only GETs, plus deliberately-invalid POSTs: a 400 proves the handler compiled and ran its
 * validation, and writes nothing. Those POSTs are unattributed, so they spend the rate-limit
 * bucket for "unknown" — never a bucket a test uses.
 */
async function warmRoutes(baseURL: string, slug: string): Promise<void> {
  const routes: { path: string; method: "GET" | "POST"; expectJson: boolean }[] = [
    { path: "/", method: "GET", expectJson: false },
    { path: "/dashboard", method: "GET", expectJson: false },
    { path: "/api/properties", method: "GET", expectJson: true },
    { path: `/api/properties/${slug}`, method: "GET", expectJson: true },
    { path: `/api/properties/${slug}/availability`, method: "GET", expectJson: true },
    { path: "/api/properties/no-such-home", method: "GET", expectJson: true },
    { path: "/api/admin/enquiries", method: "GET", expectJson: true },
    { path: "/api/enquiries", method: "POST", expectJson: true },
    { path: "/api/subscribers", method: "POST", expectJson: true },
    { path: "/api/owner-submissions", method: "POST", expectJson: true },
  ];

  const deadline = Date.now() + 120_000;

  for (const route of routes) {
    let lastSeen = "no response at all";

    for (;;) {
      try {
        const response = await fetch(new URL(route.path, baseURL), {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.method === "POST" ? "{}" : undefined,
          cache: "no-store",
        });
        const type = response.headers.get("content-type") ?? "unset";
        if (!route.expectJson || type.includes("application/json")) break;
        lastSeen = `HTTP ${response.status}, content-type ${type}`;
      } catch (err) {
        // The server may still be binding its port, or be mid-rebuild.
        lastSeen = (err as Error).message;
      }

      if (Date.now() > deadline) {
        throw new Error(
          `[e2e] ${route.method} ${route.path} never became a JSON route (${lastSeen}).\n` +
            "  If the dev server is rebuilding because a file changed during startup, rerun.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  loadLocalEnv();

  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "[e2e] DATABASE_URL is not set. See .env.example, or the docker one-liner in CLAUDE.md.",
    );
  }
  assertLocalDatabase(url);

  let published: { slug: string }[];
  try {
    published = await db().property.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true },
    });
  } catch (err) {
    throw new Error(
      `[e2e] could not reach the database: ${(err as Error).message}\n` +
        "  Is the container running? `docker start nivasa-pg`",
    );
  }

  if (published.length < 2) {
    throw new Error(
      `[e2e] only ${published.length} published listing(s) found. The specs assume the seeded ` +
        "catalogue — run `npm run db:seed`.",
    );
  }

  // A run killed halfway leaves booked slots behind, and those come out of a real weekly quota.
  await purgeAllE2EData();
  await disconnectDb();

  const baseURL = config.projects[0]?.use?.baseURL;
  if (baseURL) await warmRoutes(baseURL, published[0].slug);
}
