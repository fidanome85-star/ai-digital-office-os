import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { runNextStep, runToCompletion, startWorkflow } from "../src/engine.js";
import { WorkflowEngineError } from "../src/errors.js";
import type { WorkflowDefinition } from "../src/types.js";
import { startMockMcpServer, stopMockMcpServer } from "./mock-mcp-server.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
let mockServer: Server;
let mockEndpoint: string;
let toolCallCount = 0;

const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const projectId = `proj-${runTag}`;
const providerId = `prov-${runTag}`;
const modelId = `model-${runTag}`;
const mcpServerId = `mcp-${runTag}`;
const greenToolId = `tool-green-${runTag}`;
const redToolId = `tool-red-${runTag}`;
const agentId = `agent-${runTag}`;

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  const mock = await startMockMcpServer((req) => {
    if (req.method === "tools/call") {
      toolCallCount++;
      return { result: { content: [{ type: "text", text: "tool ran" }], isError: false } };
    }
    return { result: {} };
  });
  mockServer = mock.server;
  mockEndpoint = mock.endpoint;

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Workflow Engine Test Tenant",
    `wf-test-${runTag}`,
  ]);
  await owner.query(
    `INSERT INTO project_registry (project_id, tenant_id, project_name, project_type)
     VALUES ($1, $2, 'Workflow Engine Test Project', 'internal-tool')`,
    [projectId, tenantId],
  );
  await owner.query(
    `INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type, availability)
     VALUES ($1, 'Local', 'local', 'local-echo', 'ACTIVE')`,
    [providerId],
  );
  await owner.query(`INSERT INTO model_registry (model_id, provider_id, model_name, availability) VALUES ($1, $2, 'Local Model', 'ACTIVE')`, [
    modelId,
    providerId,
  ]);
  await owner.query(
    `INSERT INTO mcp_server_registry (mcp_server_id, tenant_id, server_name, endpoint, trust_level, enabled)
     VALUES ($1, $2, 'Test MCP Server', $3, 'TRUSTED', true)`,
    [mcpServerId, tenantId, mockEndpoint],
  );
  await owner.query(
    `INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled) VALUES ($1, $2, 'echo_tool', 'GREEN', true)`,
    [greenToolId, mcpServerId],
  );
  await owner.query(
    `INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled) VALUES ($1, $2, 'dangerous_tool', 'RED', true)`,
    [redToolId, mcpServerId],
  );
  await owner.query(
    `INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role, lifecycle_state, status)
     VALUES ($1, $2, 'Test Agent', 'engineering', 'developer', 'ACTIVE', 'ACTIVE')`,
    [agentId, tenantId],
  );
  await owner.query(
    `INSERT INTO agent_tool_bindings (tenant_id, agent_id, tool_id, allowed_actions) VALUES ($1, $2, $3, '["execute"]'::jsonb)`,
    [tenantId, agentId, greenToolId],
  );
  await owner.query(
    `INSERT INTO agent_tool_bindings (tenant_id, agent_id, tool_id, allowed_actions) VALUES ($1, $2, $3, '["execute"]'::jsonb)`,
    [tenantId, agentId, redToolId],
  );
});

after(async () => {
  await stopMockMcpServer(mockServer);
  await appPool.end();
  await owner.query("DELETE FROM artifact_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM policy_decision_records WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM workflow_history WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM workflow_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM model_runs WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM agent_tool_bindings WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM agent_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM tool_registry WHERE mcp_server_id = $1", [mcpServerId]);
  await owner.query("DELETE FROM mcp_server_registry WHERE mcp_server_id = $1", [mcpServerId]);
  await owner.query("DELETE FROM model_registry WHERE model_id = $1", [modelId]);
  await owner.query("DELETE FROM provider_registry WHERE provider_id = $1", [providerId]);
  await owner.query("DELETE FROM project_registry WHERE project_id = $1", [projectId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

function threeStepDefinition(): WorkflowDefinition {
  return {
    steps: [
      {
        type: "model_call",
        stepId: "draft",
        providerId,
        modelId,
        request: { model: "local", messages: [{ role: "user", content: "write something" }] },
      },
      { type: "tool_call", stepId: "review", agentId, toolId: greenToolId, action: "execute", arguments: { text: "x" } },
      {
        type: "create_artifact",
        stepId: "publish",
        projectId,
        artifactType: "DOC",
        storageUri: "s3://bucket/workflow-output.txt",
        contentFromStep: "draft",
      },
    ],
  };
}

describe("workflow-engine: happy path", () => {
  it("runs a model_call -> tool_call -> create_artifact workflow to COMPLETED", async () => {
    const { workflowId } = await startWorkflow(appPool, tenantId, {
      projectId,
      workflowType: "content_pipeline",
      definitionVersion: "1",
      definition: threeStepDefinition(),
    });

    const result = await runToCompletion(appPool, tenantId, workflowId);
    assert.equal(result.finalStatus, "COMPLETED");
    assert.deepEqual(result.completedSteps, ["draft", "review", "publish"]);

    const { rows: historyRows } = await owner.query(
      "SELECT event_type FROM workflow_history WHERE workflow_id = $1 ORDER BY sequence_no ASC",
      [workflowId],
    );
    assert.deepEqual(
      historyRows.map((r) => r.event_type),
      [
        "STARTED",
        "STEP_STARTED",
        "STEP_COMPLETED",
        "STEP_STARTED",
        "STEP_COMPLETED",
        "STEP_STARTED",
        "STEP_COMPLETED",
        "COMPLETED",
      ],
    );

    const { rows: wfRows } = await owner.query("SELECT status, current_state FROM workflow_registry WHERE workflow_id = $1", [
      workflowId,
    ]);
    assert.equal(wfRows[0].status, "COMPLETED");
    assert.deepEqual(wfRows[0].current_state.completedSteps, ["draft", "review", "publish"]);

    const { rows: artifactRows } = await owner.query("SELECT content_hash FROM artifact_registry WHERE project_id = $1", [
      projectId,
    ]);
    assert.equal(artifactRows.length, 1);
    assert.match(artifactRows[0].content_hash, /^sha256:[0-9a-f]{64}$/);
  });
});

describe("workflow-engine: resumability", () => {
  it("does not re-run a step that already completed in an earlier call (simulated crash + resume)", async () => {
    const { workflowId } = await startWorkflow(appPool, tenantId, {
      projectId,
      workflowType: "content_pipeline",
      definitionVersion: "1",
      definition: threeStepDefinition(),
    });

    const before_ = toolCallCount;
    const first = await runNextStep(appPool, tenantId, workflowId);
    assert.equal(first.stepId, "draft");
    assert.equal(first.stepStatus, "completed");
    assert.equal(toolCallCount, before_, "the tool step hasn't run yet");

    // Simulate a crash: nothing more happens here, then a fresh call resumes.
    const result = await runToCompletion(appPool, tenantId, workflowId);
    assert.equal(result.finalStatus, "COMPLETED");
    assert.equal(toolCallCount, before_ + 1, "the tool step ran exactly once total, not twice");

    const { rows } = await owner.query(
      "SELECT count(*) AS n FROM workflow_history WHERE workflow_id = $1 AND event_type = 'STEP_COMPLETED' AND payload->>'stepId' = 'draft'",
      [workflowId],
    );
    assert.equal(Number(rows[0].n), 1, "the draft step was recorded as completed exactly once");
  });
});

describe("workflow-engine: pause is honored mid-execution", () => {
  it("stops before the next step when status is flipped to PAUSED between calls, resumes when RUNNING again", async () => {
    const { workflowId } = await startWorkflow(appPool, tenantId, {
      projectId,
      workflowType: "content_pipeline",
      definitionVersion: "1",
      definition: threeStepDefinition(),
    });

    await runNextStep(appPool, tenantId, workflowId); // completes "draft"

    // Mirrors exactly what control-plane-api's POST /workflows/{id}/pause does.
    await owner.query("UPDATE workflow_registry SET status = 'PAUSED' WHERE workflow_id = $1", [workflowId]);

    const pausedResult = await runNextStep(appPool, tenantId, workflowId);
    assert.equal(pausedResult.ranStep, false);
    assert.equal(pausedResult.workflowStatus, "PAUSED");

    await owner.query("UPDATE workflow_registry SET status = 'RUNNING' WHERE workflow_id = $1", [workflowId]);
    const resumedResult = await runNextStep(appPool, tenantId, workflowId);
    assert.equal(resumedResult.ranStep, true);
    assert.equal(resumedResult.stepId, "review");
  });
});

describe("workflow-engine: step failure", () => {
  it("stops the workflow at FAILED and never runs later steps when a step is policy-blocked", async () => {
    const definition: WorkflowDefinition = {
      steps: [
        { type: "tool_call", stepId: "dangerous", agentId, toolId: redToolId, action: "execute", arguments: {} },
        {
          type: "model_call",
          stepId: "never-runs",
          providerId,
          modelId,
          request: { model: "local", messages: [{ role: "user", content: "unreachable" }] },
        },
      ],
    };
    const { workflowId } = await startWorkflow(appPool, tenantId, {
      projectId,
      workflowType: "content_pipeline",
      definitionVersion: "1",
      definition,
    });

    const result = await runToCompletion(appPool, tenantId, workflowId);
    assert.equal(result.finalStatus, "FAILED");
    assert.deepEqual(result.completedSteps, []);
    assert.match(result.stoppedReason ?? "", /dangerous failed/);

    const { rows } = await owner.query(
      "SELECT event_type FROM workflow_history WHERE workflow_id = $1 AND payload->>'stepId' = 'never-runs'",
      [workflowId],
    );
    assert.equal(rows.length, 0, "the second step must never have been attempted");

    const { rows: wfRows } = await owner.query("SELECT status FROM workflow_registry WHERE workflow_id = $1", [workflowId]);
    assert.equal(wfRows[0].status, "FAILED");
  });
});

describe("workflow-engine: not found", () => {
  it("throws WorkflowEngineError NOT_FOUND for an unknown workflow_id", async () => {
    await assert.rejects(
      () => runNextStep(appPool, tenantId, "does-not-exist"),
      (err: unknown) => {
        assert.ok(err instanceof WorkflowEngineError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });
});
