/**
 * A one-line description of the database a script is about to write to.
 *
 * The listing scripts run against whatever `DATABASE_URL` resolves to, which is the local docker
 * container most of the time and production when it is overridden for a single command. Those
 * two cases are a `export DATABASE_URL=…` apart and previously looked identical in the output:
 * "Updated sobha-manhattan-towers-townpark" reads the same whether it edited the live catalogue
 * or a throwaway container. Printing the host makes a write to the wrong database something you
 * notice while it happens rather than an hour later.
 *
 * Reads `process.env.DATABASE_URL` because `scripts/db-env.mjs` has already resolved the
 * `namma_nivasa_` prefix into it by the time a script runs.
 */
export function databaseTarget(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "unknown — DATABASE_URL is not set";

  try {
    const { hostname, port, pathname } = new URL(url);
    const name = pathname.replace(/^\//, "") || "?";
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    return `${name} at ${hostname}${port ? `:${port}` : ""} — ${isLocal ? "local" : "REMOTE"}`;
  } catch {
    return "unknown — DATABASE_URL is not a valid URL";
  }
}
