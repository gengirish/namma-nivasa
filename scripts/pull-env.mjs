/**
 * `vercel env pull .env.local`, without losing the local-only settings.
 *
 * The pull *replaces* the file with exactly what the Vercel project holds. That is correct for
 * anything the platform owns, and destructive for the handful of values that only ever live on
 * this machine — which is how a working `DATABASE_URL` disappeared once already.
 *
 * So: remember the keys below, pull, then restore any of them the pull did not provide.
 *
 * `DATABASE_URL` and `DIRECT_URL` are deliberately NOT in that list. Once Neon is provisioned
 * the platform owns them, and restoring a stale local value over a freshly pulled one is exactly
 * the bug this script exists to avoid — pointing migrations at a throwaway container while the
 * app talks to Neon. If you are on a local database, the pull will leave DATABASE_URL absent and
 * `scripts/db-env.mjs` will say so plainly.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.local");

/** Values this machine owns. Anything else is the platform's to decide. */
const LOCAL_ONLY = ["NEXT_PUBLIC_APP_URL", "NIVASA_TEAM_EMAIL"];

function readKeys(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) out.set(match[1], line);
  }
  return out;
}

/** Any name a Postgres URL arrives under, including Vercel's `<resource>_` prefixing. */
function hasDatabaseUrl(keys) {
  return [...keys.keys()].some((key) => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(key));
}

function pull(environment) {
  const args = ["env", "pull", ".env.local", "--yes"];
  if (environment) args.push(`--environment=${environment}`);
  const result = spawnSync("vercel", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return readKeys(ENV_FILE);
}

const before = readKeys(ENV_FILE);

// `vercel env pull` defaults to Development. A Marketplace integration commonly publishes to
// Production and Preview only, which pulls an empty file and looks exactly like "not
// provisioned" — so fall back rather than leaving that ambiguity for a human to unpick.
let after = pull(process.argv[2]);
if (!hasDatabaseUrl(after) && !process.argv[2]) {
  console.log("\nNo database URL in Development — retrying against Preview.\n");
  after = pull("preview");
}
const restored = LOCAL_ONLY.filter((key) => before.has(key) && !after.has(key));

if (restored.length > 0) {
  const block = ["", "# Restored by scripts/pull-env.mjs — local-only, not held by Vercel."]
    .concat(restored.map((key) => before.get(key)))
    .join("\n");
  writeFileSync(ENV_FILE, readFileSync(ENV_FILE, "utf8").replace(/\s*$/, "\n") + block + "\n");
  console.log(`\nrestored local-only: ${restored.join(", ")}`);
}

if (!hasDatabaseUrl(after)) {
  console.log(
    "\nNo database URL came back from Vercel — the Neon integration is not provisioned yet,\n" +
      "or it is not connected to this project. Check the dashboard (Storage → your database →\n" +
      "Connected Projects), then run this again.",
  );
  if (hasDatabaseUrl(before)) {
    console.log(
      "\nThe previous local DATABASE_URL was NOT restored, on purpose — see the note at the top\n" +
        "of this file. Paste it back by hand if you are still on a local database.",
    );
  }
} else {
  const name = [...after.keys()].find((key) => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(key));
  console.log(`\ndatabase URL present as ${name} — scripts/db-env.mjs resolves it.`);
}
