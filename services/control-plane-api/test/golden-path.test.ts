/**
 * One long, realistic, sequential flow through nearly every endpoint,
 * against a real running server and real Postgres — proves the pieces work
 * together, not just in isolation. Global catalog rows (providers, models,
 * tools, mcp servers) are seeded directly via the owner connection, the
 * way an ops/seed script would, since there are no POST endpoints for
 * platform catalogs in the v1.4 contract.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { closeAppDbPool, createOwnerClient, signTestToken, startTestServer, stopTestServer } from "./test-helpers.js";

let server: Server;
let baseUrl: string;
let owner: Client;

const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const providerId = `prov-${runTag}`;
const modelId = `model-${runTag}`;
const toolId = `tool-${runTag}`;
const mcpServerId = `mcp-${runTag}`;

let token: string;

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
}

function post(path: string, body: unknown, idempotencyKey = randomUUID()): Promise<Response> {
  return authed(path, { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": idempotencyKey } });
}

async function json(res: Response): Promise<Record<string, any>> {
  return res.json() as Promise<Record<string, any>>;
}

async function jsonArray(res: Response): Promise<any[]> {
  return res.json() as Promise<any[]>;
}

before(async () => {
  ({ server, baseUrl } = await startTestServer());
  token = await signTestToken({ tenantId, scopes: ["*"] });

  owner = createOwnerClient();
  await owner.connect();

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Golden Path Tenant",
    `golden-${runTag}`,
  ]);
  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability, health_status)
     VALUES ($1, 'Test Provider', 'llm', 'test-adapter', 'ACTIVE', 'HEALTHY')`,
    [providerId],
  );
  await owner.query(
    `INSERT INTO model_registry (model_id, provider_id, model_name, capabilities, availability, evaluation_score)
     VALUES ($1, $2, 'Test Model', $3::jsonb, 'ACTIVE', 87.5)`,
    [modelId, providerId, JSON.stringify(["coding", "reasoning"])],
  );
  await owner.query(
    `INSERT INTO mcp_server_registry (mcp_server_id, tenant_id, server_name, endpoint, trust_level, enabled)
     VALUES ($1, $2, 'Test MCP Server', 'https://mcp.test.local', 'TRUSTED', true)`,
    [mcpServerId, tenantId],
  );
  await owner.query(
    `INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled)
     VALUES ($1, $2, 'test_tool', 'GREEN', true)`,
    [toolId, mcpServerId],
  );
});

after(async () => {
  // try/finally: the server and db pool MUST close even if a cleanup query
  // fails partway through, or `node --test` hangs on an open socket
  // instead of reporting the real failure.
  try {
    // Explicit, dependency-ordered cleanup — none of these FKs cascade, and
    // the golden path deliberately touches most of the schema. Two pairs
    // are circular (deployment_registry.rollback_target self-references;
    // agent_registry.active_agent_version_id <-> agent_versions.agent_id)
    // and need their pointer nulled before either side can be deleted.
    const t = tenantId;
    await owner.query("UPDATE deployment_registry SET rollback_target = NULL WHERE tenant_id = $1", [t]);
    await owner.query("UPDATE agent_registry SET active_agent_version_id = NULL WHERE tenant_id = $1", [t]);

    await owner.query("DELETE FROM routing_decision_records WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM policy_decision_records WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM workflow_history WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM artifact_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM deployment_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM secrets_vault_references WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM agent_messages WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM agent_tool_bindings WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM task_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM release_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM approval_requests WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM workflow_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM agent_versions WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM agent_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM project_registry WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM feature_flags WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM memory_facts WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM audit_events WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM api_idempotency_keys WHERE tenant_id = $1", [t]);
    await owner.query("DELETE FROM tool_registry WHERE tool_id = $1", [toolId]);
    await owner.query("DELETE FROM mcp_server_registry WHERE mcp_server_id = $1", [mcpServerId]);
    await owner.query("DELETE FROM model_runs WHERE tenant_id = $1", [t]);
    await owner.query(
      "DELETE FROM model_evaluation_metrics WHERE evaluation_id IN (SELECT evaluation_id FROM model_evaluation_runs WHERE model_id = $1)",
      [modelId],
    );
    await owner.query("DELETE FROM model_evaluation_runs WHERE model_id = $1", [modelId]);
    await owner.query("DELETE FROM model_registry WHERE model_id = $1", [modelId]);
    await owner.query("DELETE FROM provider_registry WHERE provider_id = $1", [providerId]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [t]);
  } finally {
    await owner.end();
    await stopTestServer(server);
    await closeAppDbPool();
  }
});

describe("golden path: project -> agent -> version -> approval -> activation", () => {
  let projectId: string;
  let agentId: string;
  let agentVersionId: string;
  let taskId: string;

  it("creates a project", async () => {
    const res = await post("/projects", { project_name: "Golden Path Project", project_type: "internal-tool" });
    assert.equal(res.status, 201);
    const body = await json(res);
    projectId = body.projectId;
    assert.ok(projectId);
  });

  it("patches the project's lifecycle_state", async () => {
    const res = await authed(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ lifecycle_state: "DEVELOPMENT" }),
      headers: { "Idempotency-Key": randomUUID() },
    });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.lifecycleState, "DEVELOPMENT");
  });

  it("lists the project back via GET /projects and GET /projects/{id}", async () => {
    const listRes = await authed(`/projects?lifecycle_state=DEVELOPMENT`);
    const list = await listRes.json();
    assert.ok(Array.isArray(list) && list.some((p: any) => p.projectId === projectId));

    const getRes = await authed(`/projects/${projectId}`);
    assert.equal(getRes.status, 200);
  });

  it("submits an agent specification (lands in DRAFT)", async () => {
    const res = await post("/agents", {
      agent_name: "Golden Path Agent",
      department: "engineering",
      role: "developer",
      purpose: "test",
      capabilities: ["coding"],
    });
    assert.equal(res.status, 202);
    const body = await json(res);
    agentId = body.agentId;
    assert.equal(body.lifecycleState, "DRAFT");
  });

  it("sets the agent's preferred_model directly (owner seed step — no PATCH /agents endpoint in v1.4)", async () => {
    await owner.query("UPDATE agent_registry SET preferred_model = $1 WHERE agent_id = $2", [modelId, agentId]);
  });

  it("submits a new agent version", async () => {
    const res = await post(`/agents/${agentId}/versions`, { version: "1.0.0" });
    assert.equal(res.status, 201);
    const body = await json(res);
    agentVersionId = body.agentVersionId;
    assert.ok(agentVersionId);
    assert.ok(body.specificationHash);
  });

  it("blocks activation without a prior APPROVED AGENT_ACTIVATE approval", async () => {
    const res = await post(`/agents/${agentId}/versions/${agentVersionId}/activate`, {});
    assert.equal(res.status, 403);
    const body = await json(res);
    assert.equal(body.error_code, "POLICY_ERROR");
  });

  it("creates and approves an AGENT_ACTIVATE approval request", async () => {
    const createRes = await post("/approvals", { action: "AGENT_ACTIVATE", risk_level: "YELLOW", agent_id: agentId });
    assert.equal(createRes.status, 201);
    const approval = await json(createRes);

    const decideRes = await post(`/approvals/${approval.requestId}/decision`, { decision: "APPROVED" });
    assert.equal(decideRes.status, 200);
    const decided = await json(decideRes);
    assert.equal(decided.decision, "APPROVED");
  });

  it("activates the agent version now that approval exists", async () => {
    const res = await post(`/agents/${agentId}/versions/${agentVersionId}/activate`, {});
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.lifecycleState, "ACTIVE");

    const getRes = await authed(`/agents/${agentId}`);
    const agent = await json(getRes);
    assert.equal(agent.lifecycleState, "ACTIVE");
    assert.equal(agent.activeAgentVersionId, agentVersionId);
  });

  describe("task, workflow and artifact lineage", () => {
    let workflowId: string;
    let artifactId: string;

    it("creates a task", async () => {
      const res = await post("/tasks", {
        project_id: projectId,
        required_capability: "coding",
        input: { goal: "write a function" },
        idempotency_key: randomUUID(),
      });
      assert.equal(res.status, 201);
      const body = await json(res);
      taskId = body.taskId;
      assert.equal(body.status, "CREATED");
    });

    it("retrying task creation with the same idempotency_key returns the same task, not a duplicate", async () => {
      const getRes = await authed(`/tasks/${taskId}`);
      const original = await json(getRes);

      const res = await post("/tasks", {
        project_id: projectId,
        required_capability: "coding",
        input: { goal: "write a function" },
        idempotency_key: original.idempotencyKey,
      });
      assert.equal(res.status, 201);
      const body = await json(res);
      assert.equal(body.taskId, taskId, "replaying the same idempotency_key must return the original task");
    });

    it("starts, pauses, resumes and escalates a workflow", async () => {
      const createRes = await post("/workflows", {
        project_id: projectId,
        workflow_type: "feature_delivery",
        definition_version: "1",
      });
      assert.equal(createRes.status, 201);
      workflowId = (await json(createRes)).workflowId;

      const pauseRes = await post(`/workflows/${workflowId}/pause`, {});
      assert.equal(pauseRes.status, 200);
      assert.equal((await json(pauseRes)).status, "PAUSED");

      const resumeRes = await post(`/workflows/${workflowId}/resume`, {});
      assert.equal(resumeRes.status, 200);
      assert.equal((await json(resumeRes)).status, "RUNNING");

      const escalateRes = await post(`/workflows/${workflowId}/escalate`, {});
      assert.equal(escalateRes.status, 200);
      const escalation = await json(escalateRes);
      assert.equal(escalation.action, "WORKFLOW_ESCALATE");

      const getRes = await authed(`/workflows/${workflowId}`);
      assert.equal((await json(getRes)).status, "ESCALATED");
    });

    it("rejects an invalid workflow transition (cannot resume an ESCALATED workflow)", async () => {
      const res = await post(`/workflows/${workflowId}/resume`, {});
      assert.equal(res.status, 409);
    });

    it("registers an artifact and resolves it through GET, list and lineage", async () => {
      const createRes = await post("/artifacts", {
        project_id: projectId,
        task_id: taskId,
        artifact_type: "CODE",
        storage_uri: "s3://bucket/golden-path.ts",
        content_hash: "sha256:deadbeef",
      });
      assert.equal(createRes.status, 201);
      artifactId = (await json(createRes)).artifactId;

      const listRes = await authed(`/artifacts?project_id=${projectId}`);
      const list = await jsonArray(listRes);
      assert.ok(list.some((a: any) => a.artifactId === artifactId));

      const lineageRes = await authed(`/artifacts/${artifactId}/lineage`);
      assert.equal(lineageRes.status, 200);
      const lineage = await json(lineageRes);
      assert.equal(lineage.artifact.artifactId, artifactId);
      assert.equal(lineage.task.taskId, taskId);
    });
  });

  describe("model routing, evaluation and platform catalogs", () => {
    it("routes to the seeded model for a matching capability (ALLOW)", async () => {
      const res = await post("/models/route", { task_id: taskId, agent_id: agentId, required_capability: "coding" });
      assert.equal(res.status, 200);
      const body = await json(res);
      assert.equal(body.selectedModel, modelId);
      assert.equal(body.policyResult, "ALLOW");
    });

    it("denies routing for a capability nothing supports (DENY -> 403)", async () => {
      const res = await post("/models/route", {
        task_id: taskId,
        agent_id: agentId,
        required_capability: "nonexistent-capability",
      });
      assert.equal(res.status, 403);
      const body = await json(res);
      assert.equal(body.error_code, "POLICY_ERROR");
    });

    it("lists providers, provider health, and models by capability", async () => {
      const providersRes = await authed("/providers");
      assert.ok((await jsonArray(providersRes)).some((p: any) => p.providerId === providerId));

      const healthRes = await authed("/providers/health");
      assert.equal(healthRes.status, 200);

      const modelsRes = await authed("/models?capability=coding");
      assert.ok((await jsonArray(modelsRes)).some((m: any) => m.modelId === modelId));
    });

    it("triggers a model evaluation and lists evaluation history", async () => {
      const triggerRes = await post("/models/evaluate", { model_id: modelId, benchmark_suite: "test-suite-v1" });
      assert.equal(triggerRes.status, 202);

      const historyRes = await authed(`/models/evaluations?model_id=${modelId}`);
      const history = await jsonArray(historyRes);
      assert.ok(history.length >= 1);
      assert.equal(history[0].modelId, modelId);
    });

    it("lists MCP-registered tools and servers", async () => {
      const toolsRes = await authed("/tools");
      assert.ok((await jsonArray(toolsRes)).some((t: any) => t.toolId === toolId));

      const serversRes = await authed("/mcp/servers");
      assert.ok((await jsonArray(serversRes)).some((s: any) => s.mcpServerId === mcpServerId));
    });

    it("query records the routing decision, visible via GET /routing-decisions", async () => {
      const res = await authed("/routing-decisions");
      const records = await jsonArray(res);
      assert.ok(records.some((r: any) => r.selectedModel === modelId));
    });
  });

  describe("feature flags, secrets, usage/costs, deployments", () => {
    it("creates and lists a feature flag", async () => {
      const createRes = await post("/feature-flags", { flag_key: `golden-flag-${runTag}`, default_value: true });
      assert.equal(createRes.status, 201);

      const listRes = await authed("/feature-flags");
      const list = await jsonArray(listRes);
      assert.ok(list.some((f: any) => f.flagKey === `golden-flag-${runTag}`));
    });

    it("rotates a secret reference without ever exposing a raw value", async () => {
      const { rows } = await owner.query(
        `INSERT INTO secrets_vault_references (tenant_id, secret_name, vault_path)
         VALUES ($1, 'test-secret', 'vault://test/path') RETURNING reference_id`,
        [tenantId],
      );
      const referenceId = rows[0].reference_id;

      const res = await post(`/secrets/${referenceId}/rotate`, {});
      assert.equal(res.status, 202);
      const body = await json(res);
      assert.equal(body.referenceId, referenceId);
      assert.equal(Object.keys(body).includes("rawValue" as never), false);
    });

    it("queries usage events and an aggregated cost summary", async () => {
      await owner.query(
        `INSERT INTO usage_events (tenant_id, provider_id, model_id, input_tokens, output_tokens, actual_cost, currency)
         VALUES ($1, $2, $3, 100, 200, 0.05, 'USD')`,
        [tenantId, providerId, modelId],
      );

      const usageRes = await authed("/usage");
      const usage = await jsonArray(usageRes);
      assert.ok(usage.some((u: any) => u.providerId === providerId));

      const costsRes = await authed("/costs");
      assert.equal(costsRes.status, 200);
      const costs = await json(costsRes);
      assert.ok(costs.totalCost >= 0.05);
      assert.equal(costs.budgetStatus, "OK");
    });

    it("creates a deployment, gets it, and rolls it back", async () => {
      const releaseId = `rel-${runTag}`;
      await owner.query(
        `INSERT INTO release_registry (release_id, tenant_id, project_id, version, artifact_refs, status)
         VALUES ($1, $2, $3, '1.0.0', '[]'::jsonb, 'READY')`,
        [releaseId, tenantId, projectId],
      );

      const createRes = await post("/deployments", {
        project_id: projectId,
        release_id: releaseId,
        environment: "staging",
        strategy: "standard",
      });
      assert.equal(createRes.status, 201);
      const deployment = await json(createRes);

      const getRes = await authed(`/deployments/${deployment.deploymentId}`);
      assert.equal(getRes.status, 200);

      await owner.query("UPDATE deployment_registry SET status = 'HEALTHY', rollback_target = deployment_id WHERE deployment_id = $1", [
        deployment.deploymentId,
      ]);

      const rollbackRes = await post(`/deployments/${deployment.deploymentId}/rollback`, {});
      assert.equal(rollbackRes.status, 202);
    });

    it("lists policy decisions (empty is fine — none recorded in this flow)", async () => {
      const res = await authed("/policy-decisions");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(await jsonArray(res)));
    });

    it("queries tiered memory by text match", async () => {
      await owner.query(
        `INSERT INTO memory_facts (tenant_id, scope, subject_type, subject_id, fact)
         VALUES ($1, 'PROJECT', 'project', $2, 'The golden path project uses TypeScript and Express.')`,
        [tenantId, projectId],
      );

      const res = await post("/memory/query", { query_text: "TypeScript" });
      assert.equal(res.status, 200);
      const results = await jsonArray(res);
      assert.ok(results.some((r: any) => r.content.includes("TypeScript")));
    });
  });
});
