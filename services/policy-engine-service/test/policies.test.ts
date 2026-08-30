import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { PolicyEngineServiceError } from "../src/errors.js";
import { getPolicy, listPolicies, upsertPolicy } from "../src/policies.js";

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
    "Policy Engine Service Test Tenant",
    `pol-test-${runTag}`,
  ]);
});

after(async () => {
  await appPool.end();
  await owner.query("DELETE FROM policy_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("policy-engine-service policies", () => {
  it("creates a new tenant policy with valid rules", async () => {
    const record = await upsertPolicy(appPool, tenantId, {
      policyName: "Default Governance",
      policyVersion: "1.0.0",
      rules: [{ actionType: "TOOL_INVOKE", riskLevel: "YELLOW", decision: "REQUIRE_APPROVAL" }],
    });

    assert.equal(record.tenantId, tenantId);
    assert.equal(record.status, "ACTIVE");
    assert.equal(record.rules.length, 1);
    assert.equal(record.rules[0]?.actionType, "TOOL_INVOKE");

    const fetched = await getPolicy(appPool, tenantId, record.policyId);
    assert.deepEqual(fetched, record);
  });

  it("updates an existing policy in place when policyId is supplied", async () => {
    const created = await upsertPolicy(appPool, tenantId, {
      policyName: "Draft Policy",
      policyVersion: "1.0.0",
      rules: [{ actionType: "*", riskLevel: "GREEN", decision: "ALLOW" }],
    });

    const updated = await upsertPolicy(appPool, tenantId, {
      policyId: created.policyId,
      policyName: "Draft Policy",
      policyVersion: "1.1.0",
      rules: [{ actionType: "*", riskLevel: "GREEN", decision: "DENY" }],
      status: "INACTIVE",
    });

    assert.equal(updated.policyId, created.policyId);
    assert.equal(updated.policyVersion, "1.1.0");
    assert.equal(updated.status, "INACTIVE");
    assert.equal(updated.rules[0]?.decision, "DENY");
  });

  it("rejects a policy with malformed rules before writing anything", async () => {
    await assert.rejects(
      () =>
        upsertPolicy(appPool, tenantId, {
          policyName: "Bad Policy",
          policyVersion: "1.0.0",
          rules: [{ actionType: "*", riskLevel: "PURPLE" as never, decision: "ALLOW" }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof PolicyEngineServiceError);
        assert.equal(err.code, "INVALID_RULES");
        return true;
      },
    );

    const all = await listPolicies(appPool, tenantId);
    assert.ok(all.every((p) => p.policyName !== "Bad Policy"));
  });

  it("throws NOT_FOUND for an unknown policy id", async () => {
    await assert.rejects(
      () => getPolicy(appPool, tenantId, "does-not-exist"),
      (err: unknown) => {
        assert.ok(err instanceof PolicyEngineServiceError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });

  it("lists only this tenant's policies", async () => {
    const otherTenantId = randomUUID();
    await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
      otherTenantId,
      "Other Tenant",
      `pol-other-${otherTenantId.slice(0, 8)}`,
    ]);
    try {
      await upsertPolicy(appPool, otherTenantId, {
        policyName: "Other Tenant Policy",
        policyVersion: "1.0.0",
        rules: [],
      });

      const mine = await listPolicies(appPool, tenantId);
      assert.ok(mine.every((p) => p.tenantId === tenantId));
      assert.ok(mine.every((p) => p.policyName !== "Other Tenant Policy"));
    } finally {
      await owner.query("DELETE FROM policy_registry WHERE tenant_id = $1", [otherTenantId]);
      await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [otherTenantId]);
    }
  });
});
