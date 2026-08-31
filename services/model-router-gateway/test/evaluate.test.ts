import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { runBenchmarkSuite } from "../src/evaluate.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);

const localProviderId = `prov-eval-local-${runTag}`;
const localModelId = `model-eval-local-${runTag}`;
const brokenProviderId = `prov-eval-broken-${runTag}`;
const brokenModelId = `model-eval-broken-${runTag}`;

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Evaluate Test Tenant",
    `eval-test-${runTag}`,
  ]);

  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Local', 'local', 'local-echo', 'ACTIVE')`,
    [localProviderId],
  );
  await owner.query(
    `INSERT INTO model_registry (model_id, provider_id, model_name, availability) VALUES ($1, $2, 'Local Model', 'ACTIVE')`,
    [localModelId, localProviderId],
  );

  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Broken', 'llm', 'no-such-adapter', 'ACTIVE')`,
    [brokenProviderId],
  );
  await owner.query(
    `INSERT INTO model_registry (model_id, provider_id, model_name, availability) VALUES ($1, $2, 'Broken Model', 'ACTIVE')`,
    [brokenModelId, brokenProviderId],
  );
});

after(async () => {
  try {
    await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM model_runs WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM model_registry WHERE model_id = ANY($1::text[])", [
      [localModelId, brokenModelId],
    ]);
    await owner.query("DELETE FROM provider_registry WHERE provider_id = ANY($1::text[])", [
      [localProviderId, brokenProviderId],
    ]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  } finally {
    await appPool.end();
    await owner.end();
  }
});

describe("runBenchmarkSuite", () => {
  it("runs the default prompt set through the real executeModelRun path and scores 100% against a working adapter", async () => {
    const result = await runBenchmarkSuite(appPool, { tenantId, providerId: localProviderId, modelId: localModelId });

    assert.equal(result.cases.length, 3, "default prompt set has 3 prompts");
    assert.ok(result.cases.every((c) => c.success), "every case must succeed against the real, working local-echo adapter");
    assert.equal(result.score, 100);
    assert.equal(result.successRate, 1);
    assert.ok(result.averageOutputTokens > 0, "local-echo produces real, non-zero output token counts");

    const { rows } = await owner.query("SELECT count(*)::int AS n FROM model_runs WHERE tenant_id = $1 AND model_id = $2", [
      tenantId,
      localModelId,
    ]);
    assert.equal(rows[0].n, 3, "each benchmark case must leave a real model_runs row, same as any other executeModelRun call");
  });

  it("scores 0% and records the real failure reason when the adapter is unsupported, without crashing the suite", async () => {
    const result = await runBenchmarkSuite(appPool, {
      tenantId,
      providerId: brokenProviderId,
      modelId: brokenModelId,
      prompts: ["one prompt is enough for this case"],
    });

    assert.equal(result.cases.length, 1);
    assert.equal(result.cases[0]!.success, false);
    assert.ok(result.cases[0]!.error?.includes("no-such-adapter"));
    assert.equal(result.score, 0);
  });

  it("accepts a custom prompt set instead of the default one", async () => {
    const result = await runBenchmarkSuite(appPool, {
      tenantId,
      providerId: localProviderId,
      modelId: localModelId,
      prompts: ["custom prompt A", "custom prompt B"],
    });
    assert.equal(result.cases.length, 2);
    assert.deepEqual(
      result.cases.map((c) => c.prompt),
      ["custom prompt A", "custom prompt B"],
    );
  });
});
