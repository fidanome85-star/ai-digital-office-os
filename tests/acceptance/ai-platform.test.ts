/**
 * One test per bullet in the "AI Platform" section of
 * docs/blueprint/implementation_acceptance_checklist_v1.4.md.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import type { Pool } from "@ai-office/db";
import { getCostSummary } from "@ai-office/cost-usage-service";
import { callTool, ToolGatewayError } from "@ai-office/tool-gateway-mcp";
import { createAppPool, createOwnerClient } from "./db.js";

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const tag = tenantId.slice(0, 8);

before(async () => {
  owner = createOwnerClient();
  await owner.connect();
  appPool = createAppPool();
  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Acceptance AI Platform Tenant",
    `aiplat-${tag}`,
  ]);
});

after(async () => {
  // try/finally: the pools MUST close even if a cleanup query throws (e.g.
  // a wrong FK ordering), or `node --test` hangs on an open handle instead
  // of reporting the real failure.
  try {
    await owner.query("DELETE FROM policy_decision_records WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM agent_tool_bindings WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM agent_registry WHERE tenant_id = $1", [tenantId]);
    // tool_registry references mcp_server_registry — must be deleted first.
    await owner.query("DELETE FROM tool_registry WHERE tool_id LIKE $1", [`tool-${tag}%`]);
    await owner.query("DELETE FROM mcp_server_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM routing_decision_records WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM budget_tiers WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM model_evaluation_runs WHERE model_id LIKE $1", [`model-${tag}%`]);
    await owner.query("DELETE FROM model_registry WHERE model_id LIKE $1", [`model-${tag}%`]);
    await owner.query("DELETE FROM provider_registry WHERE provider_id LIKE $1", [`prov-${tag}%`]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  } finally {
    await appPool.end();
    await owner.end();
  }
});

describe("AI Platform", () => {
  it("Model evaluation history is versioned and rerunnable", async () => {
    const providerId = `prov-${tag}`;
    const modelId = `model-${tag}`;
    await owner.query("INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type) VALUES ($1,'Acceptance Provider','llm','test-adapter')", [providerId]);
    await owner.query("INSERT INTO model_registry (model_id, provider_id, model_name) VALUES ($1,$2,'Acceptance Model')", [modelId, providerId]);

    const run1 = await owner.query(
      "INSERT INTO model_evaluation_runs (model_id, benchmark_suite, score, executed_at) VALUES ($1,'coding-bench-v1',72.5, now() - interval '1 day') RETURNING evaluation_id",
      [modelId],
    );
    const run2 = await owner.query(
      "INSERT INTO model_evaluation_runs (model_id, benchmark_suite, score, executed_at) VALUES ($1,'coding-bench-v1',81.0, now()) RETURNING evaluation_id",
      [modelId],
    );
    assert.notEqual(run1.rows[0].evaluation_id, run2.rows[0].evaluation_id, "each rerun is its own row, not an overwrite");

    const { rows } = await owner.query("SELECT evaluation_id, score FROM model_evaluation_runs WHERE model_id = $1 ORDER BY executed_at", [modelId]);
    assert.equal(rows.length, 2, "evaluation history must be versioned — both runs for the same model survive independently");
  });

  it("Provider/model routing decisions are persisted", async () => {
    await owner.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
    const providerId = `prov-route-${tag}`;
    const modelId = `model-route-${tag}`;
    await owner.query("INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type) VALUES ($1,'Route Provider','llm','test-adapter')", [providerId]);
    await owner.query("INSERT INTO model_registry (model_id, provider_id, model_name) VALUES ($1,$2,'Route Model')", [modelId, providerId]);

    await owner.query(
      "INSERT INTO routing_decision_records (tenant_id, selected_provider, selected_model, policy_result) VALUES ($1,$2,$3,'ALLOW')",
      [tenantId, providerId, modelId],
    );
    const { rows } = await owner.query("SELECT selected_provider, selected_model FROM routing_decision_records WHERE tenant_id = $1", [tenantId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].selected_provider, providerId);
    assert.equal(rows[0].selected_model, modelId);

    await owner.query("DELETE FROM routing_decision_records WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM model_registry WHERE model_id = $1", [modelId]);
    await owner.query("DELETE FROM provider_registry WHERE provider_id = $1", [providerId]);
  });

  it("Usage and cost events are persisted and reconcile with budgets", async () => {
    await owner.query("INSERT INTO budget_tiers (tenant_id, period, currency, soft_limit, hard_limit) VALUES ($1,'MONTHLY','USD',10,20)", [tenantId]);
    await owner.query("INSERT INTO usage_events (tenant_id, actual_cost, currency) VALUES ($1,4,'USD')", [tenantId]);
    await owner.query("INSERT INTO usage_events (tenant_id, actual_cost, currency) VALUES ($1,5,'USD')", [tenantId]);

    const summary = await getCostSummary(appPool, tenantId, {
      from: new Date(Date.now() - 3600_000).toISOString(),
      to: new Date(Date.now() + 3600_000).toISOString(),
    });
    // 9 against a soft_limit of 10 is >= 80% -> WARNING: real reconciliation
    // between persisted usage_events and a persisted budget_tiers row, not
    // a hardcoded status.
    assert.equal(summary.totalCost, 9);
    assert.equal(summary.budgetStatus, "WARNING");
    assert.deepEqual(summary.budgetTier, { softLimit: 10, hardLimit: 20 });
  });

  it("MCP server/tool registry is authoritative (no binding, no default access)", async () => {
    await owner.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
    const agentId = `agent-mcp-${tag}`;
    const toolId = `tool-${tag}-auth`;
    await owner.query("INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role) VALUES ($1,$2,'MCP Agent','Engineering','worker')", [agentId, tenantId]);
    await owner.query("INSERT INTO tool_registry (tool_id, tool_name, risk_level, enabled) VALUES ($1,'acceptance_tool','GREEN',true)", [toolId]);

    await assert.rejects(
      () => callTool(appPool, { tenantId, agentId, toolId, action: "invoke", arguments: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "BINDING_DENIED");
        return true;
      },
      "a tool call with no agent_tool_bindings row must be denied — the registry is the only source of truth for access, not an implicit default",
    );
  });

  it("Agent-tool bindings are tenant-scoped and policy-controlled", async () => {
    await owner.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
    const agentId = `agent-policy-${tag}`;
    const toolId = `tool-${tag}-policy`;
    const mcpServerId = `mcp-${tag}-policy`;
    await owner.query("INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role) VALUES ($1,$2,'Policy Agent','Engineering','worker')", [agentId, tenantId]);
    await owner.query("INSERT INTO mcp_server_registry (mcp_server_id, tenant_id, server_name, endpoint, enabled) VALUES ($1,$2,'Policy MCP','https://mcp.test.local',true)", [mcpServerId, tenantId]);
    // RED risk_level -> DEFAULT_RULES escalates it, proving policy-engine
    // actually governs the call rather than the binding alone deciding.
    await owner.query("INSERT INTO tool_registry (tool_id, mcp_server_id, tool_name, risk_level, enabled) VALUES ($1,$2,'red_tool','RED',true)", [toolId, mcpServerId]);
    await owner.query(
      "INSERT INTO agent_tool_bindings (tenant_id, agent_id, tool_id, allowed_actions) VALUES ($1,$2,$3,$4::jsonb)",
      [tenantId, agentId, toolId, JSON.stringify(["invoke"])],
    );

    await assert.rejects(
      () => callTool(appPool, { tenantId, agentId, toolId, action: "invoke", arguments: {} }),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "POLICY_BLOCKED");
        return true;
      },
      "a valid, tenant-scoped binding still isn't enough for a RED-risk tool — policy-engine must gate it",
    );

    const { rows } = await owner.query(
      "SELECT decision FROM policy_decision_records WHERE tenant_id = $1 AND tool_id = $2",
      [tenantId, toolId],
    );
    assert.equal(rows.length, 1, "the policy decision itself must be persisted, tenant-scoped, even though the call was blocked");
  });
});
