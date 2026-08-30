import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { AgentFactoryError } from "../src/errors.js";
import { advanceToApproved, advanceToEvaluated, advanceToSandbox, advanceToTested, runFullPipeline } from "../src/pipeline.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const toolId = `tool-${runTag}`;
const mcpServerId = `mcp-${runTag}`;

function makeAgentId(): string {
  return `agent-${randomUUID()}`;
}

async function insertAgent(overrides: Record<string, unknown> = {}): Promise<string> {
  const agentId = makeAgentId();
  const defaults = {
    agent_name: "Test Agent",
    department: "engineering",
    role: "developer",
    purpose: "Writes and reviews production code changes end to end.",
    capabilities: JSON.stringify(["coding", "review"]),
    allowed_tools: JSON.stringify([toolId]),
    input_schema: JSON.stringify({ type: "object", properties: { goal: { type: "string" } } }),
    output_schema: JSON.stringify({ type: "object", properties: { diff: { type: "string" } } }),
    security_level: "GREEN",
    ...overrides,
  };
  await owner.query(
    `INSERT INTO agent_registry
       (agent_id, tenant_id, agent_name, department, role, purpose, capabilities, allowed_tools, input_schema, output_schema, security_level, lifecycle_state, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, 'DRAFT', 'INACTIVE')`,
    [
      agentId,
      tenantId,
      defaults.agent_name,
      defaults.department,
      defaults.role,
      defaults.purpose,
      defaults.capabilities,
      defaults.allowed_tools,
      defaults.input_schema,
      defaults.output_schema,
      defaults.security_level,
    ],
  );
  return agentId;
}

async function lifecycleStateOf(agentId: string): Promise<string> {
  const { rows } = await owner.query("SELECT lifecycle_state FROM agent_registry WHERE agent_id = $1", [agentId]);
  return rows[0].lifecycle_state;
}

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Agent Factory Test Tenant",
    `af-test-${runTag}`,
  ]);
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
  await appPool.end();
  await owner.query("DELETE FROM policy_decision_records WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM agent_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM tool_registry WHERE tool_id = $1", [toolId]);
  await owner.query("DELETE FROM mcp_server_registry WHERE mcp_server_id = $1", [mcpServerId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("agent-factory pipeline", () => {
  it("advances a well-formed, GREEN-security agent all the way to APPROVED", async () => {
    const agentId = await insertAgent();
    const result = await runFullPipeline(appPool, tenantId, agentId);
    assert.equal(result.stoppedAt, undefined);
    assert.equal(result.reachedState, "APPROVED");
    assert.ok(result.evaluationScore !== null && result.evaluationScore >= 60);
    assert.equal(await lifecycleStateOf(agentId), "APPROVED");
  });

  it("blocks SANDBOX for a RED-security agent via the policy engine and records the decision", async () => {
    const agentId = await insertAgent({ security_level: "RED" });
    await assert.rejects(
      () => advanceToSandbox(appPool, tenantId, agentId),
      (err: unknown) => {
        assert.ok(err instanceof AgentFactoryError);
        assert.equal(err.code, "POLICY_BLOCKED");
        return true;
      },
    );
    assert.equal(await lifecycleStateOf(agentId), "DRAFT");

    const { rows } = await owner.query(
      "SELECT decision FROM policy_decision_records WHERE tenant_id = $1 AND agent_id = $2",
      [tenantId, agentId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decision, "REQUIRE_ESCALATION");
  });

  it("fails SANDBOX validation when allowed_tools references a tool that doesn't exist", async () => {
    const agentId = await insertAgent({ allowed_tools: JSON.stringify(["nonexistent-tool"]) });
    await assert.rejects(
      () => advanceToSandbox(appPool, tenantId, agentId),
      (err: unknown) => {
        assert.ok(err instanceof AgentFactoryError);
        assert.equal(err.code, "SANDBOX_VALIDATION_FAILED");
        return true;
      },
    );
    assert.equal(await lifecycleStateOf(agentId), "DRAFT");
  });

  it("rejects advancing to TESTED out of order (still DRAFT, not SANDBOX)", async () => {
    const agentId = await insertAgent();
    await assert.rejects(
      () => advanceToTested(appPool, tenantId, agentId),
      (err: unknown) => {
        assert.ok(err instanceof AgentFactoryError);
        assert.equal(err.code, "INVALID_TRANSITION");
        return true;
      },
    );
  });

  it("fails TESTED when input_schema is not a well-formed JSON Schema document", async () => {
    const agentId = await insertAgent({ input_schema: JSON.stringify({ type: 123 }) });
    await advanceToSandbox(appPool, tenantId, agentId);
    await assert.rejects(
      () => advanceToTested(appPool, tenantId, agentId),
      (err: unknown) => {
        assert.ok(err instanceof AgentFactoryError);
        assert.equal(err.code, "SCHEMA_VALIDATION_FAILED");
        return true;
      },
    );
    assert.equal(await lifecycleStateOf(agentId), "SANDBOX");
  });

  it("stops runFullPipeline at EVALUATED when the completeness score is below the quality gate", async () => {
    const agentId = await insertAgent({
      capabilities: JSON.stringify([]),
      purpose: "x",
      input_schema: null,
      output_schema: null,
    });
    const result = await runFullPipeline(appPool, tenantId, agentId);
    assert.equal(result.reachedState, "EVALUATED");
    assert.equal(result.stoppedAt?.step, "advanceToApproved");
    assert.ok(result.evaluationScore !== null && result.evaluationScore < 60);
  });

  it("advanceToApproved throws QUALITY_GATE_FAILED directly when called on a low-scoring EVALUATED agent", async () => {
    const agentId = await insertAgent({ capabilities: JSON.stringify([]), purpose: "x", input_schema: null, output_schema: null });
    await advanceToSandbox(appPool, tenantId, agentId);
    await advanceToTested(appPool, tenantId, agentId);
    await advanceToEvaluated(appPool, tenantId, agentId);
    await assert.rejects(
      () => advanceToApproved(appPool, tenantId, agentId),
      (err: unknown) => {
        assert.ok(err instanceof AgentFactoryError);
        assert.equal(err.code, "QUALITY_GATE_FAILED");
        return true;
      },
    );
  });
});
