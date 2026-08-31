import type { Client } from "pg";
import type { Pool } from "@ai-office/db";
import { purgeExpiredWorkingMemory } from "@ai-office/memory-service";
import { expirePendingApprovals } from "@ai-office/policy-engine-service";
import { logger } from "./logger.js";

export interface SweepSummary {
  tenantsSwept: number;
  approvalsExpired: number;
  workingMemoryPurged: number;
}

/**
 * Listing every tenant is a genuinely cross-tenant, system-level
 * operation — no single tenant session can see other tenants' rows in
 * `organizations` (RLS forbids it, correctly). This is the same reason
 * every test fixture in this repo seeds through an owner-role connection
 * rather than the app role: an operational/administrative reader, not a
 * request acting on a tenant's behalf.
 */
async function listTenantIds(owner: Client): Promise<string[]> {
  const { rows } = await owner.query<{ tenant_id: string }>("SELECT tenant_id FROM organizations");
  return rows.map((r) => r.tenant_id);
}

/**
 * Runs both sweep functions built in Phase 6
 * (`@ai-office/policy-engine-service`'s `expirePendingApprovals`,
 * `@ai-office/memory-service`'s `purgeExpiredWorkingMemory`) once per
 * tenant. Every actual write still goes through `withTenantTransaction`
 * inside those functions, using the app role — this function only reads
 * `organizations` at owner level to know which tenants exist; it never
 * writes anything itself and never bypasses RLS for a tenant's own data.
 * One tenant's sweep failing doesn't stop the others' — errors are
 * logged and counted, not thrown past the caller, matching this
 * codebase's house style (`runFullPipeline`, `advanceDeployment`) of
 * always returning a structured result rather than an all-or-nothing
 * exception for a batch operation.
 */
export async function runSweepOnce(owner: Client, appPool: Pool): Promise<SweepSummary> {
  const tenantIds = await listTenantIds(owner);
  let approvalsExpired = 0;
  let workingMemoryPurged = 0;

  for (const tenantId of tenantIds) {
    try {
      approvalsExpired += await expirePendingApprovals(appPool, tenantId);
    } catch (err) {
      logger.error("approval expiry sweep failed for tenant", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      workingMemoryPurged += await purgeExpiredWorkingMemory(appPool, tenantId);
    } catch (err) {
      logger.error("working memory purge sweep failed for tenant", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: SweepSummary = { tenantsSwept: tenantIds.length, approvalsExpired, workingMemoryPurged };
  logger.info("sweep pass completed", { ...summary });
  return summary;
}
