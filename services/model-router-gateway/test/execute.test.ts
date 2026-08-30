import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { ModelRouterError } from "../src/errors.js";
import { executeModelRun } from "../src/execute.js";
import { sendJson, startMockServer, stopMockServer } from "./mock-server.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);

const localProviderId = `prov-local-${runTag}`;
const localModelId = `model-local-${runTag}`;
const openAiProviderId = `prov-openai-${runTag}`;
const openAiModelId = `model-openai-${runTag}`;
const brokenProviderId = `prov-broken-${runTag}`;
const brokenModelId = `model-broken-${runTag}`;

let mockServer: Server;
let mockBaseUrl: string;

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  const mock = await startMockServer((_req, res) => {
    sendJson(res, 200, {
      choices: [{ message: { content: "mocked completion" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
  });
  mockServer = mock.server;
  mockBaseUrl = mock.baseUrl;

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Model Router Test Tenant",
    `mr-test-${runTag}`,
  ]);

  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Local', 'local', 'local-echo', 'ACTIVE')`,
    [localProviderId],
  );
  await owner.query(
    `INSERT INTO model_registry (model_id, provider_id, model_name, availability)
     VALUES ($1, $2, 'Local Model', 'ACTIVE')`,
    [localModelId, localProviderId],
  );

  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Test OpenAI', 'llm', 'openai-chat', 'ACTIVE')`,
    [openAiProviderId],
  );
  await owner.query(
    `INSERT INTO model_registry (model_id, provider_id, model_name, availability, cost_profile)
     VALUES ($1, $2, 'Test GPT', 'ACTIVE', $3::jsonb)`,
    [openAiModelId, openAiProviderId, JSON.stringify({ input_per_1k: 0.01, output_per_1k: 0.03 })],
  );
  await owner.query(
    `INSERT INTO secrets_vault_references (tenant_id, secret_name, vault_path, scope_provider_id)
     VALUES ($1, 'openai-key', 'env:MODEL_ROUTER_TEST_OPENAI_KEY', $2)`,
    [tenantId, openAiProviderId],
  );
  process.env["MODEL_ROUTER_TEST_OPENAI_KEY"] = "sk-test-from-env";

  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Broken', 'llm', 'no-such-adapter', 'ACTIVE')`,
    [brokenProviderId],
  );
  await owner.query(
    `INSERT INTO model_registry (model_id, provider_id, model_name, availability)
     VALUES ($1, $2, 'Broken Model', 'ACTIVE')`,
    [brokenModelId, brokenProviderId],
  );
});

after(async () => {
  await stopMockServer(mockServer);
  await appPool.end();
  await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM model_runs WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM secrets_vault_references WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM model_registry WHERE model_id = ANY($1::text[])", [
    [localModelId, openAiModelId, brokenModelId],
  ]);
  await owner.query("DELETE FROM provider_registry WHERE provider_id = ANY($1::text[])", [
    [localProviderId, openAiProviderId, brokenProviderId],
  ]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("executeModelRun", () => {
  it("runs the local-echo adapter end to end with no secret configured, records model_runs + usage_events", async () => {
    const result = await executeModelRun(appPool, {
      tenantId,
      providerId: localProviderId,
      modelId: localModelId,
      request: { model: "local", messages: [{ role: "user", content: "ping" }] },
    });

    assert.match(result.completion.content, /ping/);
    assert.equal(result.estimatedCost, 0);

    const { rows: runRows } = await owner.query("SELECT * FROM model_runs WHERE model_run_id = $1", [result.modelRunId]);
    assert.equal(runRows[0].status, "COMPLETED");

    const { rows: usageRows } = await owner.query("SELECT * FROM usage_events WHERE provider_id = $1", [localProviderId]);
    assert.equal(usageRows.length, 1);
  });

  it("resolves the API key from secrets_vault_references and calls the mock provider, computing real cost", async () => {
    const result = await executeModelRun(
      appPool,
      {
        tenantId,
        providerId: openAiProviderId,
        modelId: openAiModelId,
        request: { model: "gpt-test", messages: [{ role: "user", content: "hello" }] },
      },
      { adapterBaseUrl: mockBaseUrl },
    );

    assert.equal(result.completion.content, "mocked completion");
    // 10 input tokens * 0.01/1k + 20 output tokens * 0.03/1k = 0.0001 + 0.0006 = 0.0007
    assert.equal(result.estimatedCost, 0.0007);

    const { rows } = await owner.query("SELECT * FROM model_runs WHERE model_run_id = $1", [result.modelRunId]);
    assert.equal(rows[0].input_tokens, "10");
    assert.equal(rows[0].output_tokens, "20");
  });

  it("marks model_runs FAILED and rethrows when the adapter_type is unsupported", async () => {
    await assert.rejects(
      () =>
        executeModelRun(appPool, {
          tenantId,
          providerId: brokenProviderId,
          modelId: brokenModelId,
          request: { model: "x", messages: [{ role: "user", content: "hi" }] },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ModelRouterError);
        assert.equal(err.code, "UNSUPPORTED_ADAPTER_TYPE");
        return true;
      },
    );

    const { rows } = await owner.query(
      "SELECT status FROM model_runs WHERE tenant_id = $1 AND provider_id = $2 ORDER BY started_at DESC LIMIT 1",
      [tenantId, brokenProviderId],
    );
    assert.equal(rows[0].status, "FAILED");
  });

  it("throws NOT_FOUND for an unknown provider without creating a model_runs row", async () => {
    await assert.rejects(
      () =>
        executeModelRun(appPool, {
          tenantId,
          providerId: "does-not-exist",
          modelId: "does-not-exist",
          request: { model: "x", messages: [{ role: "user", content: "hi" }] },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ModelRouterError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });
});
