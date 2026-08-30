import type { Logger } from "./logger.js";

/** Wraps an operation with start/success/failure logging and a duration —
 * a minimal, dependency-free stand-in for real span export (no APM
 * integration exists yet; this never blocks or fails if one never does). */
export async function withSpan<T>(logger: Logger, name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  logger.debug(`${name} started`);
  try {
    const result = await fn();
    logger.info(`${name} completed`, { durationMs: Math.round(performance.now() - startedAt) });
    return result;
  } catch (err) {
    logger.error(`${name} failed`, {
      durationMs: Math.round(performance.now() - startedAt),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
