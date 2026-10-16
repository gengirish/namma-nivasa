/**
 * Per-test cleanup already runs in the `identity` fixture. This is the backstop for a test that
 * crashed before its fixture could tear down, so the next run starts from the same weekly
 * availability the last one did.
 */
import { purgeAdmins } from "./support/clerk";
import { disconnectDb, purgeAllE2EData } from "./support/db";
import { loadLocalEnv } from "./support/env";

export default async function globalTeardown(): Promise<void> {
  loadLocalEnv();
  await purgeAllE2EData();
  // The `Admin` rows the signed-in specs granted themselves. The Clerk users behind them stay —
  // recreating them every run is slower, rate-limited, and leaves debris when a run is killed.
  await purgeAdmins();
  await disconnectDb();
}
