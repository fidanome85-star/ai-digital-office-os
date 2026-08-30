import { Pool, type PoolClient } from "pg";

export function createDbPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Runs `fn` inside a transaction with the RLS tenant GUC set for that
 * transaction only (`set_config(..., is_local = true)`, i.e. SET LOCAL
 * semantics). This is deliberately NOT session-level: pool connections are
 * reused across unrelated requests, and a session-level SET would leak one
 * request's tenant into the next request that happens to grab the same
 * pooled connection — a cross-tenant data leak. Always go through this
 * helper rather than running queries against a raw pool client.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type { Pool, PoolClient } from "pg";
