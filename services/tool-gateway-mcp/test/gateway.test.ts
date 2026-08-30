import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { callTool } from "../src/gateway.js";
import { ToolGatewayError } from "../src/errors.js";
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
let mockShouldError = false;

const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const agentId = `agent-${runTag}`;
const mcpServerId = `mcp-${runTag}`;
const greenToolId = `tool-green-${runTag}`;
const redToolId = `tool-red-${runTag}`;
const failingToolId = `tool-fail-${runTag}`;

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  const mock = await startMockMcpServer((req) => {
    if (req.method === "tools/call") {
      const params = req.params as { name: string };
      if (mockShouldError || params.name === "failing_tool") {
        return { error: { code: -32000, message: "tool execution failed" } };
      }
      return { result: { content: [{ type: "text", text: "ok" }], isError: false } };
    }
    return { result: {} };
  });
  mockServer = mock.server;
  mockEndpoint = mock.endpoint;

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Tool Gateway Test Tenant",
    `tg-test-${runTag}`,
  ]);
  await owner.query(
    `INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role, lifecycle_state, status)
     VALUES ($1, $2, 'Test Agent', 'engineering', 'developer', 'ACTIVE', 'ACTIVE')`,
    [agentId, tenantId],
  );
  await owner.query(
    `INSERT INTO mcp_server_registry (mcp_server_id, tenant_id, server_name, endpoint, trust_level, enabled)
     VALUES ($1, $2, 'Test MCP Server', $3, 'TRUSTED', true)`,
    [mcpServerId, tenantId, mockEndpoint],
  );
  await owner.query(
    `INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled)
     VALUES ($1, $2, 'calculator', 'GREEN', true)`,
    [greenToolId, mcpServerId],
  );
  await owner.query(
    `INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled)
     VALUES ($1, $2, 'delete_production_data', 'RED', true)`,
    [redToolId, mcpServerId],
  );
  await owner.query(
    `INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled)
     VALUES ($1, $2, 'failing_tool', 'GREEN', true)`,
    [failingToolId, mcpServerId],
  );

  await owner.query(
    `INSERT INTO agent_tool_bindings (tenant_id, agent_id, tool_id, allowed_actions)
     VALUES ($1, $2, $3, '["execute"]'::jsonb)`,
    [tenantId, agentId, greenToolId],
  );
  await owner.query(
    `INSERT INTO agent_tool_bindings (tenant_id, agent_id, tool_id, allowed_actions)
     VALUES ($1, $2, $3, '["execute"]'::jsonb)`,
    [tenantId, agentId, redToolId],
  );
  await owner.query(
    `INSERT INTO agent_tool_bindings (tenant_id, agent_id, tool_id, allowed_actions)
     VALUES ($1, $2, $3, '["execute"]'::jsonb)`,
    [tenantId, agentId, failingToolId],
  );
});

after(async () => {
  await stopMockMcpServer(mockServer);
  await appPool.end();
  await owner.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM policy_decision_records WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM agent_tool_bindings WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM tool_registry WHERE mcp_server_id = $1", [mcpServerId]);
  await owner.query("DELETE FROM mcp_server_registry WHERE mcp_server_id = $1", [mcpServerId]);
  await owner.query("DELETE FROM agent_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("callTool", () => {
  it("denies a call with no agent_tool_bindings row at all", async () => {
    await assert.rejects(
      () => callTool(appPool, { tenantId, agentId, toolId: "no-such-tool-and-no-binding", action: "execute", arguments: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        // NOT_FOUND (tool lookup fails first) — either way, nothing is permitted by default.
        assert.ok(err.code === "NOT_FOUND" || err.code === "BINDING_DENIED");
        return true;
      },
    );
  });

  it("denies a call where the binding exists but doesn't permit the requested action", async () => {
    await assert.rejects(
      () => callTool(appPool, { tenantId, agentId, toolId: greenToolId, action: "delete", arguments: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "BINDING_DENIED");
        return true;
      },
    );
  });

  it("allows a GREEN-risk, properly-bound tool call and proxies it to the real MCP server", async () => {
    const result = await callTool(appPool, {
      tenantId,
      agentId,
      toolId: greenToolId,
      action: "execute",
      arguments: { expression: "1+1" },
    });
    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);

    const { rows } = await owner.query(
      "SELECT event_type, payload FROM audit_events WHERE tenant_id = $1 AND event_type = 'TOOL_CALL_EXECUTED' ORDER BY created_at DESC LIMIT 1",
      [tenantId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.toolId, greenToolId);
  });

  it("blocks a RED-risk tool via the policy engine and still records the decision", async () => {
    await assert.rejects(
      () => callTool(appPool, { tenantId, agentId, toolId: redToolId, action: "execute", arguments: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "POLICY_BLOCKED");
        return true;
      },
    );

    const { rows: decisionRows } = await owner.query(
      "SELECT decision FROM policy_decision_records WHERE tenant_id = $1 AND tool_id = $2",
      [tenantId, redToolId],
    );
    assert.equal(decisionRows.length, 1);
    assert.equal(decisionRows[0].decision, "REQUIRE_ESCALATION");

    const { rows: auditRows } = await owner.query(
      "SELECT event_type FROM audit_events WHERE tenant_id = $1 AND event_type = 'TOOL_CALL_BLOCKED'",
      [tenantId],
    );
    assert.equal(auditRows.length, 1);
  });

  it("propagates an MCP-level tool failure and audits it", async () => {
    await assert.rejects(
      () => callTool(appPool, { tenantId, agentId, toolId: failingToolId, action: "execute", arguments: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "MCP_PROTOCOL_ERROR");
        return true;
      },
    );

    const { rows } = await owner.query(
      "SELECT event_type FROM audit_events WHERE tenant_id = $1 AND event_type = 'TOOL_CALL_FAILED'",
      [tenantId],
    );
    assert.equal(rows.length, 1);
  });
});
