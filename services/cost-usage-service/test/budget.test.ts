import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { CostUsageError } from "../src/errors.js";
import { getCostSummary, upsertBudgetTier } from "../src/budget.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const providerId = `prov-${runTag}`;
const from = "2026-01-01T00:00:00Z";
const to = "2026-01-31T23:59:59Z";

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Cost Usage Test Tenant",
    `cost-test-${runTag}`,
  ]);
  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Test Provider', 'llm', 'local-echo', 'ACTIVE')`,
    [providerId],
  );
});

after(async () => {
  await appPool.end();
  await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM budget_tiers WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM provider_registry WHERE provider_id = $1", [providerId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

async function seedUsage(cost: number): Promise<void> {
  await owner.query(
    `INSERT INTO usage_events (tenant_id, provider_id, input_tokens, output_tokens, actual_cost, currency, event_time)
     VALUES ($1, $2, 100, 100, $3, 'USD', '2026-01-15T00:00:00Z')`,
    [tenantId, providerId, cost],
  );
}

describe("cost-usage-service", () => {
  it("returns OK with no budget_tiers row configured, regardless of spend", async () => {
    await seedUsage(9999);
    const summary = await getCostSummary(appPool, tenantId, { from, to });
    assert.equal(summary.budgetStatus, "OK");
    assert.equal(summary.budgetTier, null);
    assert.ok(summary.totalCost >= 9999);
  });

  it("rejects an invalid period", async () => {
    await assert.rejects(
      () => upsertBudgetTier(appPool, tenantId, { period: "YEARLY" as never, softLimit: 10, hardLimit: 20 }),
      (err: unknown) => {
        assert.ok(err instanceof CostUsageError);
        assert.equal(err.code, "INVALID_PERIOD");
        return true;
      },
    );
  });

  it("computes OK / WARNING / SOFT_LIMIT / HARD_LIMIT correctly against a configured tier", async () => {
    await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
    await upsertBudgetTier(appPool, tenantId, { period: "MONTHLY", softLimit: 100, hardLimit: 200 });

    await seedUsage(50); // 50% of soft limit
    assert.equal((await getCostSummary(appPool, tenantId, { from, to })).budgetStatus, "OK");

    await seedUsage(35); // total 85 -> 85% of soft limit
    assert.equal((await getCostSummary(appPool, tenantId, { from, to })).budgetStatus, "WARNING");

    await seedUsage(20); // total 105 -> over soft limit, under hard limit
    assert.equal((await getCostSummary(appPool, tenantId, { from, to })).budgetStatus, "SOFT_LIMIT");

    await seedUsage(100); // total 205 -> over hard limit
    assert.equal((await getCostSummary(appPool, tenantId, { from, to })).budgetStatus, "HARD_LIMIT");
  });

  it("upsert replaces the previous limits for the same (tenant, period)", async () => {
    await upsertBudgetTier(appPool, tenantId, { period: "DAILY", softLimit: 10, hardLimit: 20 });
    await upsertBudgetTier(appPool, tenantId, { period: "DAILY", softLimit: 30, hardLimit: 40 });

    const { rows } = await owner.query("SELECT soft_limit, hard_limit FROM budget_tiers WHERE tenant_id = $1 AND period = 'DAILY'", [
      tenantId,
    ]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].soft_limit), 30);
    assert.equal(Number(rows[0].hard_limit), 40);
  });

  it("breaks down cost by provider", async () => {
    await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
    await seedUsage(12.5);
    const summary = await getCostSummary(appPool, tenantId, { from, to });
    assert.equal(summary.breakdownByProvider[providerId], 12.5);
  });
});
