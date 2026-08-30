import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { CostUsageError } from "./errors.js";

export type BudgetPeriod = "DAILY" | "MONTHLY";
export type BudgetStatus = "OK" | "WARNING" | "SOFT_LIMIT" | "HARD_LIMIT";

const VALID_PERIODS: readonly BudgetPeriod[] = ["DAILY", "MONTHLY"];

export interface UpsertBudgetTierInput {
  period: BudgetPeriod;
  currency?: string;
  softLimit: number;
  hardLimit: number;
}

export async function upsertBudgetTier(pool: Pool, tenantId: string, input: UpsertBudgetTierInput): Promise<void> {
  if (!VALID_PERIODS.includes(input.period)) {
    throw new CostUsageError("INVALID_PERIOD", `period must be one of ${VALID_PERIODS.join(", ")}, got "${input.period}".`);
  }
  await withTenantTransaction(pool, tenantId, (client) =>
    client.query(
      `INSERT INTO budget_tiers (tenant_id, period, currency, soft_limit, hard_limit)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, period)
       DO UPDATE SET currency = EXCLUDED.currency, soft_limit = EXCLUDED.soft_limit, hard_limit = EXCLUDED.hard_limit, updated_at = now()`,
      [tenantId, input.period, input.currency ?? "USD", input.softLimit, input.hardLimit],
    ),
  );
}

export interface CostSummaryInput {
  from: string;
  to: string;
  /** Which budget_tiers row to compare consumption against — a summary
   * over an arbitrary [from, to) range still needs one fixed tier
   * definition to judge it by. Defaults to MONTHLY. */
  period?: BudgetPeriod;
}

export interface CostSummary {
  totalCost: number;
  currency: string;
  budgetStatus: BudgetStatus;
  breakdownByProvider: Record<string, number>;
  budgetTier: { softLimit: number; hardLimit: number } | null;
}

function computeBudgetStatus(total: number, softLimit: number, hardLimit: number): BudgetStatus {
  if (total >= hardLimit) return "HARD_LIMIT";
  if (total >= softLimit) return "SOFT_LIMIT";
  if (softLimit > 0 && total / softLimit >= 0.8) return "WARNING";
  return "OK";
}

/**
 * Real budget_status determination — closes the Phase 2 gap where
 * GET /costs always returned "OK" because no budget definition existed
 * to compare against (see docs/decisions/0002 item 5 and 0006). A tenant
 * with no budget_tiers row configured still gets "OK" — that's an honest
 * "nothing to compare against," not a fabricated pass.
 */
export async function getCostSummary(pool: Pool, tenantId: string, input: CostSummaryInput): Promise<CostSummary> {
  const period = input.period ?? "MONTHLY";

  return withTenantTransaction(pool, tenantId, async (client) => {
    const totalRes = await client.query<{ total: string; currency: string | null }>(
      "SELECT COALESCE(SUM(actual_cost), 0) AS total, MAX(currency) AS currency FROM usage_events WHERE event_time BETWEEN $1 AND $2",
      [input.from, input.to],
    );
    const byProviderRes = await client.query<{ provider_id: string; cost: string }>(
      `SELECT provider_id, COALESCE(SUM(actual_cost), 0) AS cost
       FROM usage_events WHERE event_time BETWEEN $1 AND $2 AND provider_id IS NOT NULL
       GROUP BY provider_id`,
      [input.from, input.to],
    );
    const tierRes = await client.query<{ soft_limit: string; hard_limit: string }>(
      "SELECT soft_limit, hard_limit FROM budget_tiers WHERE tenant_id = $1 AND period = $2",
      [tenantId, period],
    );

    const total = Number(totalRes.rows[0]!.total);
    const currency = totalRes.rows[0]!.currency ?? "USD";
    const breakdownByProvider: Record<string, number> = {};
    for (const row of byProviderRes.rows) breakdownByProvider[row.provider_id] = Number(row.cost);

    const tier = tierRes.rows[0];
    const budgetTier = tier ? { softLimit: Number(tier.soft_limit), hardLimit: Number(tier.hard_limit) } : null;
    const budgetStatus = budgetTier ? computeBudgetStatus(total, budgetTier.softLimit, budgetTier.hardLimit) : "OK";

    return { totalCost: total, currency, budgetStatus, breakdownByProvider, budgetTier };
  });
}
