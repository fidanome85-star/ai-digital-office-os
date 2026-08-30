import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthenticatedPrincipal } from "./claims.js";

/**
 * Carries the authenticated principal through the async call chain of a
 * single request so that anything downstream — a repository, a service
 * call, a log line — can read the current tenant without threading it
 * through every function signature. This is also the bridge to Postgres
 * RLS: a pooled db client wrapper should call getCurrentTenantId() and
 * `SET LOCAL app.current_tenant_id` at the start of every transaction
 * (see packages/db/migrations/0021_row_level_security_full.sql).
 */
const storage = new AsyncLocalStorage<AuthenticatedPrincipal>();

export function runWithPrincipal<T>(principal: AuthenticatedPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

export function getCurrentPrincipal(): AuthenticatedPrincipal | undefined {
  return storage.getStore();
}

export function requireCurrentPrincipal(): AuthenticatedPrincipal {
  const principal = storage.getStore();
  if (!principal) {
    throw new Error(
      "No authenticated principal in the current async context. Did requireAuth() middleware run?",
    );
  }
  return principal;
}

export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
