import { createDbPool, withTenantTransaction, type Pool, type PoolClient } from "@ai-office/db";
import { getCurrentTenantId } from "@ai-office/auth";

const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!APP_DATABASE_URL) {
  throw new Error(
    "APP_DATABASE_URL is not set. This service must connect as the ai_office_app role (see .env.example), never DATABASE_URL (the migration-owner role, which bypasses RLS).",
  );
}

export const pool: Pool = createDbPool(APP_DATABASE_URL);

/**
 * Every route handler that touches the database goes through this. It
 * pulls the tenant id from the AsyncLocalStorage context @ai-office/auth's
 * requireAuth() populated, so handlers never see or pass a tenant id by
 * hand — there is no way to "forget" to scope a query.
 */
export async function withRequestTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("withRequestTenant() called outside an authenticated request context.");
  }
  return withTenantTransaction(pool, tenantId, fn);
}

export type { PoolClient } from "@ai-office/db";
