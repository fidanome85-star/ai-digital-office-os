import type { Client } from "pg";
import type { Pool } from "@ai-office/db";
import { logger } from "./logger.js";
import { runSweepOnce, type SweepSummary } from "./sweeps.js";

export interface SchedulerHandle {
  stop(): void;
}

/**
 * The minimal real scheduler this environment has infrastructure for: a
 * plain `setInterval` loop calling `runSweepOnce`, with no queue, no
 * distributed lock, no IaC — all explicitly out of scope per blueprint
 * clause 74 and every prior phase's "what NOT to build here." A
 * production deployment would more likely point a managed trigger (a k8s
 * CronJob, a cloud scheduler function, systemd timer) at the exact same
 * `runSweepOnce` — that function is the seam, same pattern as
 * `SecretResolver` in Phase 4/7: the real logic doesn't change when the
 * thing invoking it does.
 *
 * Runs one pass immediately on start rather than waiting a full interval
 * — an operator starting this process wants sweeps to have happened
 * recently, not to wait `intervalMs` for the first one.
 */
export function startScheduler(owner: Client, appPool: Pool, intervalMs: number): SchedulerHandle {
  let stopped = false;

  const tick = async (): Promise<SweepSummary | undefined> => {
    if (stopped) return undefined;
    try {
      return await runSweepOnce(owner, appPool);
    } catch (err) {
      logger.error("sweep pass failed", { error: err instanceof Error ? err.message : String(err) });
      return undefined;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
