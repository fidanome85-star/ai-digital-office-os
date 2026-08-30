import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";

export interface SetWorkingMemoryInput {
  /** cache_key is the table's global primary key, not composite with
   * tenant_id — callers should namespace it (e.g. `${tenantId}:${key}`)
   * to avoid a cross-tenant key collision. RLS still prevents any actual
   * data leak (a collision throws an RLS violation rather than silently
   * overwriting another tenant's row), but a clean namespaced key avoids
   * hitting that at all. */
  cacheKey: string;
  taskId?: string;
  payload: unknown;
  ttlSeconds: number;
}

/** Tier 1 — fast, short-lived. TTL is enforced at read time (WHERE
 * expires_at > now()), not by a background sweep — an expired row simply
 * stops being visible the instant it expires, with no cron dependency for
 * correctness. purgeExpiredWorkingMemory exists purely for storage
 * hygiene, never for correctness. */
export async function setWorkingMemory(pool: Pool, tenantId: string, input: SetWorkingMemoryInput): Promise<void> {
  await withTenantTransaction(pool, tenantId, (client) =>
    client.query(
      `INSERT INTO working_memory_cache (cache_key, tenant_id, task_id, payload, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
       ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at, task_id = EXCLUDED.task_id`,
      [input.cacheKey, tenantId, input.taskId ?? null, JSON.stringify(input.payload), input.ttlSeconds],
    ),
  );
}

export async function getWorkingMemory<T = unknown>(pool: Pool, tenantId: string, cacheKey: string): Promise<T | null> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ payload: T }>(
      "SELECT payload FROM working_memory_cache WHERE cache_key = $1 AND expires_at > now()",
      [cacheKey],
    );
    return rows[0]?.payload ?? null;
  });
}

export async function purgeExpiredWorkingMemory(pool: Pool, tenantId: string): Promise<number> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM working_memory_cache WHERE expires_at <= now()");
    return rowCount ?? 0;
  });
}
