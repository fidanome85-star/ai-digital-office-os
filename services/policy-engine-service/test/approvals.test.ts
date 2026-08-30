import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { expirePendingApprovals } from "../src/approvals.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Approvals Test Tenant",
    `appr-test-${runTag}`,
  ]);
});

after(async () => {
  await appPool.end();
  await owner.query("DELETE FROM approval_requests WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

/** expiresAtInterval is a fixed literal from our own test code (never
 * user input), so it's safe to interpolate directly — it lets the seed
 * express "N hours ago" / "N days from now" without Postgres rejecting a
 * bound parameter as an invalid timestamp literal. */
async function seedApproval(decision: string | null, expiresAtInterval: string | null): Promise<string> {
  const requestId = `appr-${randomUUID()}`;
  const expiresAtSql = expiresAtInterval ? `now() + interval '${expiresAtInterval}'` : "NULL";
  await owner.query(
    `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, decision, expires_at)
     VALUES ($1, $2, 'AGENT_ACTIVATE', 'YELLOW', $3, ${expiresAtSql})`,
    [requestId, tenantId, decision],
  );
  return requestId;
}

describe("policy-engine-service approvals", () => {
  it("expires pending approvals whose expires_at has passed", async () => {
    const expiredId = await seedApproval(null, "-1 hour");
    const stillPendingId = await seedApproval(null, "1 day");
    const alreadyDecidedId = await seedApproval("APPROVED", "-1 hour");

    const count = await expirePendingApprovals(appPool, tenantId);
    assert.equal(count, 1);

    const { rows } = await owner.query(
      "SELECT request_id, decision FROM approval_requests WHERE tenant_id = $1 ORDER BY request_id",
      [tenantId],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.request_id, r.decision]));
    assert.equal(byId[expiredId], "EXPIRED");
    assert.equal(byId[stillPendingId], null);
    assert.equal(byId[alreadyDecidedId], "APPROVED");
  });

  it("returns 0 and does nothing when there is nothing to expire", async () => {
    const count = await expirePendingApprovals(appPool, randomUUID());
    assert.equal(count, 0);
  });
});
