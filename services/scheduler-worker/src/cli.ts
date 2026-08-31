import { Client } from "pg";
import { createDbPool } from "@ai-office/db";
import { logger } from "./logger.js";
import { startScheduler } from "./scheduler.js";
import { runSweepOnce } from "./sweeps.js";

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  const appDatabaseUrl = process.env["APP_DATABASE_URL"];
  if (!databaseUrl || !appDatabaseUrl) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL and APP_DATABASE_URL must both be set.");
    process.exitCode = 1;
    return;
  }

  const owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
  const appPool = createDbPool(appDatabaseUrl);

  const loop = process.argv.includes("--loop");

  if (!loop) {
    try {
      await runSweepOnce(owner, appPool);
    } catch (err) {
      logger.error("sweep run crashed", { error: err instanceof Error ? err.message : String(err) });
      process.exitCode = 1;
    } finally {
      await appPool.end();
      await owner.end();
    }
    return;
  }

  const intervalMs = Number(process.env["SWEEP_INTERVAL_MS"] ?? DEFAULT_INTERVAL_MS);
  logger.info("scheduler starting", { intervalMs });
  const handle = startScheduler(owner, appPool, intervalMs);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("scheduler shutting down", { signal });
    handle.stop();
    await appPool.end();
    await owner.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main();
