import { createDbPool } from "@ai-office/db";
import { logger } from "./logger.js";
import { runFullPipeline } from "./pipeline.js";

async function main(): Promise<void> {
  const [tenantId, agentId] = process.argv.slice(2);
  if (!tenantId || !agentId) {
    // eslint-disable-next-line no-console
    console.error("Usage: pnpm --filter @ai-office/agent-factory run process -- <tenantId> <agentId>");
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env["APP_DATABASE_URL"];
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.error("APP_DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const pool = createDbPool(databaseUrl);
  try {
    const result = await runFullPipeline(pool, tenantId, agentId);
    logger.info("pipeline run finished", { ...result });
    if (result.stoppedAt) process.exitCode = 1;
  } catch (err) {
    logger.error("pipeline run crashed", { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
