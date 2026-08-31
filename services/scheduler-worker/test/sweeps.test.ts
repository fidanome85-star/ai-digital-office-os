import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { runSweepOnce } from "../src/sweeps.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantA = randomUUID();
const tenantB = randomUUID();
const tagA = tenantA.slice(0, 8);
const tagB = tenantB.slice(0, 8);

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantA,
    "Scheduler Sweep Tenant A",
    `sweep-a-${tagA}`,
  ]);
  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantB,
    "Scheduler Sweep Tenant B",
    `sweep-b-${tagB}`,
  ]);
});

after(async () => {
  try {
    await owner.query("DELETE FROM approval_requests WHERE tenant_id = $1 OR tenant_id = $2", [tenantA, tenantB]);
    await owner.query("DELETE FROM working_memory_cache WHERE tenant_id = $1 OR tenant_id = $2", [tenantA, tenantB]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1 OR tenant_id = $2", [tenantA, tenantB]);
  } finally {
    await appPool.end();
    await owner.end();
  }
});

describe("scheduler-worker sweeps", () => {
  it("sweeps overdue approvals and expired working memory across every tenant in one pass", async () => {
    // Tenant A: one overdue undecided approval, one expired working-memory row.
    await owner.query(
      `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, expires_at)
       VALUES ($1, $2, 'AGENT_ACTIVATE', 'YELLOW', now() - interval '1 hour')`,
      [`appr-${tagA}`, tenantA],
    );
    await owner.query(
      `INSERT INTO working_memory_cache (cache_key, tenant_id, payload, expires_at)
       VALUES ($1, $2, '{}'::jsonb, now() - interval '1 hour')`,
      [`wmc-${tagA}`, tenantA],
    );

    // Tenant B: nothing overdue yet — proves the sweep doesn't touch what
    // doesn't need touching, and that per-tenant results are additive
    // across the whole run, not just tenant A's.
    await owner.query(
      `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, expires_at)
       VALUES ($1, $2, 'AGENT_ACTIVATE', 'YELLOW', now() + interval '1 day')`,
      [`appr-${tagB}`, tenantB],
    );

    const summary = await runSweepOnce(owner, appPool);

    // Deliberately not asserting on summary.approvalsExpired/
    // workingMemoryPurged >= 1 here: runSweepOnce sweeps every tenant in
    // the database, and when this test file's process runs concurrently
    // with scheduler.test.ts (its own background ticker sweeps too — same
    // shared Postgres instance, same globally-scoped sweep functions),
    // whichever call reaches an overdue row first legitimately claims the
    // count and the other correctly reports zero for it. The real
    // assertion is the tenant-scoped DB state below, which is correct
    // regardless of which process actually performed the sweep.
    assert.ok(summary.tenantsSwept >= 2, "must have swept at least the two tenants seeded here");

    const { rows: approvalRows } = await owner.query("SELECT decision FROM approval_requests WHERE request_id = $1", [
      `appr-${tagA}`,
    ]);
    assert.equal(approvalRows[0].decision, "EXPIRED");

    const { rows: stillPendingRows } = await owner.query(
      "SELECT decision FROM approval_requests WHERE request_id = $1",
      [`appr-${tagB}`],
    );
    assert.equal(stillPendingRows[0].decision, null, "tenant B's not-yet-overdue approval must be untouched");

    const { rows: wmcRows } = await owner.query("SELECT 1 FROM working_memory_cache WHERE cache_key = $1", [
      `wmc-${tagA}`,
    ]);
    assert.equal(wmcRows.length, 0, "the expired working-memory row must actually be gone");
  });

  it("is idempotent — a second pass doesn't disturb already-settled rows", async () => {
    const summary = await runSweepOnce(owner, appPool);
    assert.ok(summary.tenantsSwept >= 2);

    // Not asserting the pass's own counts are zero (see the note above —
    // a concurrently-running scheduler.test.ts could legitimately claim a
    // count here too). What matters is that tenant A's row, already
    // settled by the previous test, is still exactly EXPIRED — a second
    // pass must be a no-op for it, not an error or a double-decrement.
    const { rows } = await owner.query("SELECT decision FROM approval_requests WHERE request_id = $1", [
      `appr-${tagA}`,
    ]);
    assert.equal(rows[0].decision, "EXPIRED");
  });
});
