/**
 * Runs a Prisma command with `.env.local` loaded and `DIRECT_URL` guaranteed.
 *
 * Replaces `dotenv-cli` in the `db:*` scripts for one reason: `vercel env pull .env.local`
 * *overwrites* that file with exactly what the Vercel project holds, and Neon's Marketplace
 * integration does not publish a variable called `DIRECT_URL`. It publishes the pooled URL as
 * `DATABASE_URL` and the direct one as `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING`.
 *
 * `prisma migrate` must not run through a PgBouncer-pooled connection, which is why the schema
 * declares `directUrl` at all — so rather than asking a human to re-add the same line after
 * every pull, this derives it:
 *
 *     DIRECT_URL  ||  DATABASE_URL_UNPOOLED  ||  POSTGRES_URL_NON_POOLING  ||  DATABASE_URL
 *
 * The last fallback is deliberate: a plain unpooled Postgres (a local container, a direct Neon
 * endpoint) has one URL and needs no distinction. It only degrades on a pooled connection with
 * no unpooled sibling published, which is a misconfiguration worth failing loudly on later
 * rather than guessing at here.
 *
 *     node scripts/db-env.mjs prisma migrate deploy
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.local");

/** Minimal dotenv parse: `KEY=value`, optional `export`, optional single/double quotes. */
function parseEnvFile(path) {
  const out = {};
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
      // Strip a trailing unquoted comment, but never inside a URL's query string.
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[match[1]] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(ENV_FILE);
// Real environment wins, so `DATABASE_URL=... npm run db:deploy` still works in CI.
const env = { ...fileEnv, ...process.env };

/**
 * Vercel's Neon integration prefixes every variable it publishes with the resource name —
 * `namma_nivasa_DATABASE_URL`, not `DATABASE_URL` — because one project can hold several
 * databases. So an exact-name lookup finds nothing on a perfectly healthy setup.
 *
 * Match the exact name first, then any key ending in `_<name>`. Anchored on the underscore so
 * `MY_DATABASE_URL` matches and `SHADOW_DATABASE_URL` does not get mistaken for it.
 */
function pick(...names) {
  for (const name of names) {
    if (env[name]) return env[name];
    const suffix = `_${name}`;
    const hit = Object.keys(env).find((key) => key.endsWith(suffix) && env[key]);
    if (hit) return env[hit];
  }
  return undefined;
}

const pooled = pick("DATABASE_URL", "POSTGRES_URL");
if (pooled) env.DATABASE_URL = pooled;

if (!env.DATABASE_URL) {
  console.error(
    [
      "DATABASE_URL is not set.",
      "",
      `  Looked in ${ENV_FILE}${existsSync(ENV_FILE) ? "" : " (which does not exist)"}.`,
      "",
      "  Provision Neon through the Vercel dashboard and run `vercel env pull .env.local`,",
      "  or point at a local Postgres — see the docker one-liner in README.md.",
    ].join("\n"),
  );
  process.exit(1);
}

env.DIRECT_URL =
  pick("DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING") ?? env.DATABASE_URL;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/db-env.mjs <command> [args…]");
  process.exit(1);
}

/**
 * `prisma` and `tsx` are `.cmd` shims on Windows, which `spawn` cannot execute without a shell —
 * and a shell re-parses the argument list, so anything containing a space or a quote has to be
 * quoted back up before it is handed over. Without this, `db-env.mjs node -e "…"` loses its
 * argument entirely.
 */
const useShell = process.platform === "win32";

function quoteForShell(arg) {
  if (!useShell) return arg;
  if (arg.length > 0 && !/[\s"^&|<>()%!]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

const child = spawn(quoteForShell(command), args.map(quoteForShell), {
  stdio: "inherit",
  env,
  shell: useShell,
  windowsVerbatimArguments: useShell,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (err) => {
  console.error(`could not run ${command}: ${err.message}`);
  process.exit(1);
});
