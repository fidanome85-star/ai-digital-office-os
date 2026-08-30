import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";

export const costsRouter = Router();

/**
 * No budget-tier table exists in the schema yet (the blueprint's "budget
 * governance" concept has no persisted definition to compare consumption
 * against), so budget_status is always OK here — a real threshold
 * comparison needs that table added in a later phase, not fabricated now.
 */
costsRouter.get(
  "/costs",
  ah(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const periodStart = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = to ?? new Date().toISOString();

    const summary = await withRequestTenant(async (client) => {
      const totalRes = await client.query(
        "SELECT COALESCE(SUM(actual_cost), 0) AS total, MAX(currency) AS currency FROM usage_events WHERE event_time BETWEEN $1 AND $2",
        [periodStart, periodEnd],
      );
      const byProviderRes = await client.query(
        `SELECT provider_id, COALESCE(SUM(actual_cost), 0) AS cost
         FROM usage_events WHERE event_time BETWEEN $1 AND $2 AND provider_id IS NOT NULL
         GROUP BY provider_id`,
        [periodStart, periodEnd],
      );
      const breakdown: Record<string, number> = {};
      for (const row of byProviderRes.rows) {
        breakdown[row.provider_id as string] = Number(row.cost);
      }
      return {
        total: Number(totalRes.rows[0].total),
        currency: totalRes.rows[0].currency ?? "USD",
        breakdown,
      };
    });

    res.status(200).json({
      tenantId: getCurrentTenantId(),
      periodStart,
      periodEnd,
      totalCost: summary.total,
      currency: summary.currency,
      budgetStatus: "OK",
      breakdownByProvider: summary.breakdown,
    });
  }),
);
