/**
 * Runs a command with environment variables set, cross-platform.
 *
 *     node scripts/run-with-env.mjs PW_PROD=1 -- playwright test
 *
 * `VAR=value cmd` is shell syntax POSIX shells understand and cmd.exe does not, so an npm script
 * written that way works for half the people who clone this. Rather than take a dependency on
 * cross-env for one script, this does the same job with the same spawn handling
 * `scripts/db-env.mjs` already needed for Windows `.cmd` shims.
 */
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
if (separator === -1) {
  console.error("usage: node scripts/run-with-env.mjs KEY=value [KEY=value…] -- <command> [args…]");
  process.exit(1);
}

const assignments = argv.slice(0, separator);
const [command, ...args] = argv.slice(separator + 1);
if (!command) {
  console.error("no command given after --");
  process.exit(1);
}

const env = { ...process.env };
for (const assignment of assignments) {
  const eq = assignment.indexOf("=");
  if (eq === -1) {
    console.error(`not a KEY=value assignment: ${assignment}`);
    process.exit(1);
  }
  env[assignment.slice(0, eq)] = assignment.slice(eq + 1);
}

// `playwright` and `prisma` are `.cmd` shims on Windows, which spawn cannot execute without a
// shell — and a shell re-parses the argument list, so anything with a space is quoted back up.
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
