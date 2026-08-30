import type { Pool, PoolClient } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { evaluatePolicy, parsePolicyRules, recordPolicyDecision, type RiskLevel } from "@ai-office/policy-engine";
import { withSpan } from "@ai-office/observability";
import { ToolGatewayError } from "./errors.js";
import { logger } from "./logger.js";
import { McpClient, type McpToolCallResult } from "./mcp-client.js";

export interface ToolCallInput {
  tenantId: string;
  agentId: string;
  toolId: string;
  action: string;
  arguments: Record<string, unknown>;
}

interface ToolRow {
  tool_id: string;
  tool_name: string;
  mcp_server_id: string;
  risk_level: string;
  enabled: boolean;
}

interface McpServerRow {
  mcp_server_id: string;
  endpoint: string;
  enabled: boolean;
}

const RISK_LEVELS: readonly RiskLevel[] = ["GREEN", "YELLOW", "RED"];

function toRiskLevel(value: string): RiskLevel {
  return RISK_LEVELS.includes(value as RiskLevel) ? (value as RiskLevel) : "YELLOW";
}

async function requireTool(client: PoolClient, toolId: string): Promise<ToolRow> {
  const { rows } = await client.query<ToolRow>("SELECT * FROM tool_registry WHERE tool_id = $1 AND enabled = true", [
    toolId,
  ]);
  const tool = rows[0];
  if (!tool) throw new ToolGatewayError("NOT_FOUND", `Tool ${toolId} not found or not enabled.`);
  return tool;
}

async function requireMcpServer(client: PoolClient, mcpServerId: string): Promise<McpServerRow> {
  const { rows } = await client.query<McpServerRow>(
    "SELECT * FROM mcp_server_registry WHERE mcp_server_id = $1 AND enabled = true",
    [mcpServerId],
  );
  const server = rows[0];
  if (!server) throw new ToolGatewayError("NOT_FOUND", `MCP server ${mcpServerId} not found or not enabled.`);
  return server;
}

async function checkBinding(client: PoolClient, input: ToolCallInput): Promise<void> {
  const { rows } = await client.query<{ allowed_actions: unknown }>(
    "SELECT allowed_actions FROM agent_tool_bindings WHERE tenant_id = $1 AND agent_id = $2 AND tool_id = $3",
    [input.tenantId, input.agentId, input.toolId],
  );
  const binding = rows[0];
  if (!binding) {
    throw new ToolGatewayError(
      "BINDING_DENIED",
      `Agent ${input.agentId} has no tool binding for ${input.toolId} — nothing is permitted by default.`,
    );
  }
  const allowedActions = Array.isArray(binding.allowed_actions) ? binding.allowed_actions : [];
  if (!allowedActions.includes(input.action)) {
    throw new ToolGatewayError(
      "BINDING_DENIED",
      `Agent ${input.agentId}'s binding to ${input.toolId} does not permit action "${input.action}" (allowed: ${allowedActions.join(", ") || "none"}).`,
    );
  }
}

/**
 * Enforces agent_tool_bindings (a hard authorization check — no binding,
 * no default access), then a policy-engine gate keyed off the tool's own
 * risk_level (same pattern as agent-factory's SANDBOX gate, ADR 0003 §4:
 * the policy decision is recorded in its own transaction so it survives
 * even when it blocks the call), then proxies the call to the tool's MCP
 * server over a real JSON-RPC client. Every outcome — success, policy
 * block, or MCP failure — is written to audit_events.
 */
export async function callTool(pool: Pool, input: ToolCallInput): Promise<McpToolCallResult> {
  return withSpan(logger, `callTool(${input.toolId}:${input.action})`, async () => {
    const { tool, server, decision } = await withTenantTransaction(pool, input.tenantId, async (client) => {
      const tool = await requireTool(client, input.toolId);
      await checkBinding(client, input);
      const server = await requireMcpServer(client, tool.mcp_server_id);

      const policyRulesRes = await client.query<{ rules: unknown }>(
        `SELECT rules FROM policy_registry WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'ACTIVE'
         ORDER BY tenant_id NULLS LAST LIMIT 1`,
        [input.tenantId],
      );
      const tenantRules = policyRulesRes.rows[0] ? parsePolicyRules(policyRulesRes.rows[0].rules) : [];

      const policyInput = { actionType: "TOOL_CALL", riskLevel: toRiskLevel(tool.risk_level), agentId: input.agentId, toolId: input.toolId };
      const decision = evaluatePolicy(policyInput, tenantRules);
      await recordPolicyDecision(client, input.tenantId, policyInput, decision);

      return { tool, server, decision };
    });

    if (decision.decision !== "ALLOW") {
      await recordAudit(pool, input.tenantId, "TOOL_CALL_BLOCKED", input, { decision: decision.decision, reason: decision.reason });
      throw new ToolGatewayError(
        "POLICY_BLOCKED",
        `Tool call ${input.toolId}:${input.action} blocked: ${decision.decision} (${decision.reason})`,
      );
    }

    const client = new McpClient(server.endpoint);
    try {
      const result = await client.callTool(tool.tool_name, input.arguments);
      await recordAudit(pool, input.tenantId, "TOOL_CALL_EXECUTED", input, { isError: result.isError });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordAudit(pool, input.tenantId, "TOOL_CALL_FAILED", input, { error: message });
      throw err;
    }
  });
}

async function recordAudit(
  pool: Pool,
  tenantId: string,
  eventType: string,
  input: ToolCallInput,
  payload: Record<string, unknown>,
): Promise<void> {
  await withTenantTransaction(pool, tenantId, (client) =>
    client.query(
      `INSERT INTO audit_events (tenant_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, 'SERVICE', $3, $4)`,
      [tenantId, eventType, input.agentId, JSON.stringify({ toolId: input.toolId, action: input.action, ...payload })],
    ),
  );
}
