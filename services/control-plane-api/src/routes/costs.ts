import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { getCostSummary } from "@ai-office/cost-usage-service";
import { ah } from "../async-handler.js";
import { pool } from "../db.js";

export const costsRouter = Router();

/**
 * Real budget_status against budget_tiers (closes the Phase 2 placeholder
 * that always returned "OK" because no budget definition existed to
 * compare consumption against — see docs/decisions/0006 §2, 0007).
 * Delegates entirely to @ai-office/cost-usage-service's getCostSummary
 * rather than re-implementing the aggregation query here; a tenant with no
 * budget_tiers row configured still gets "OK" back — an honest "nothing to
 * compare against," not a fabricated pass.
 */
costsRouter.get(
  "/costs",
  ah(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const periodStart = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = to ?? new Date().toISOString();
    const tenantId = getCurrentTenantId()!;

    const summary = await getCostSummary(pool, tenantId, { from: periodStart, to: periodEnd });

    res.status(200).json({
      tenantId,
      periodStart,
      periodEnd,
      totalCost: summary.totalCost,
      currency: summary.currency,
      budgetStatus: summary.budgetStatus,
      breakdownByProvider: summary.breakdownByProvider,
      budgetTier: summary.budgetTier,
    });
  }),
);
