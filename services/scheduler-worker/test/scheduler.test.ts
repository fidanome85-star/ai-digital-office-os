import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { startScheduler } from "../src/scheduler.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const tag = tenantId.slice(0, 8);

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);
  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Scheduler Loop Tenant",
    `sched-${tag}`,
  ]);
});

after(async () => {
  try {
    await owner.query("DELETE FROM approval_requests WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  } finally {
    await appPool.end();
    await owner.end();
  }
});

describe("startScheduler", () => {
  it("sweeps on a real interval and genuinely stops when told to", async () => {
    await owner.query(
      `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, expires_at)
       VALUES ($1, $2, 'AGENT_ACTIVATE', 'YELLOW', now() - interval '1 hour')`,
      [`appr-loop1-${tag}`, tenantId],
    );

    const handle = startScheduler(owner, appPool, 100);
    await sleep(350); // several ticks at 100ms, including the immediate one

    const { rows: firstRows } = await owner.query("SELECT decision FROM approval_requests WHERE request_id = $1", [
      `appr-loop1-${tag}`,
    ]);
    assert.equal(firstRows[0].decision, "EXPIRED", "at least one tick must have run and swept the overdue approval");

    handle.stop();

    await owner.query(
      `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, expires_at)
       VALUES ($1, $2, 'AGENT_ACTIVATE', 'YELLOW', now() - interval '1 hour')`,
      [`appr-loop2-${tag}`, tenantId],
    );
    await sleep(350); // long enough for several more ticks, if stop() hadn't worked

    const { rows: secondRows } = await owner.query("SELECT decision FROM approval_requests WHERE request_id = $1", [
      `appr-loop2-${tag}`,
    ]);
    assert.equal(secondRows[0].decision, null, "no further tick may run after stop() — this row must still be untouched");
  });
});
