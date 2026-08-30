import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { withSpan } from "@ai-office/observability";
import { logger } from "./logger.js";

/**
 * Sweeps approval_requests whose expires_at has passed but which were
 * never decided, moving them to decision='EXPIRED'. EXPIRED is a real
 * value in the OpenAPI ApprovalRecord.decision enum, but nothing in
 * Phase 2's control-plane-api ever set it — GET /approvals would show a
 * stale pending request forever past its expiry. Tenant-scoped like every
 * other sweep in this codebase (purgeExpiredWorkingMemory); a real
 * scheduler would call this once per tenant.
 */
export async function expirePendingApprovals(pool: Pool, tenantId: string): Promise<number> {
  return withSpan(logger, "expirePendingApprovals", async () => {
    const count = await withTenantTransaction(pool, tenantId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE approval_requests
         SET decision = 'EXPIRED', decided_at = now()
         WHERE decision IS NULL AND expires_at IS NOT NULL AND expires_at <= now()`,
      );
      return rowCount ?? 0;
    });
    if (count > 0) logger.info("expired pending approvals", { tenantId, count });
    return count;
  });
}
