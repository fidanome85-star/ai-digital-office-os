import type { Pool, PoolClient } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { evaluatePolicy, parsePolicyRules, recordPolicyDecision, type RiskLevel } from "@ai-office/policy-engine";
import { withSpan } from "@ai-office/observability";
import { AgentFactoryError } from "./errors.js";
import { logger } from "./logger.js";
import { computeEvaluationScore } from "./scoring.js";
import { validateJsonSchemaShape } from "./schema-validation.js";

interface AgentRow {
  agent_id: string;
  tenant_id: string | null;
  lifecycle_state: string;
  capabilities: unknown;
  allowed_tools: unknown;
  purpose: string | null;
  input_schema: unknown;
  output_schema: unknown;
  security_level: string | null;
  evaluation_score: string | null;
}

const RISK_LEVELS: readonly RiskLevel[] = ["GREEN", "YELLOW", "RED"];

async function requireAgent(client: PoolClient, agentId: string, expectedState: string): Promise<AgentRow> {
  const { rows } = await client.query<AgentRow>("SELECT * FROM agent_registry WHERE agent_id = $1", [agentId]);
  const agent = rows[0];
  if (!agent) throw new AgentFactoryError("NOT_FOUND", `Agent ${agentId} not found.`);
  if (agent.lifecycle_state !== expectedState) {
    throw new AgentFactoryError(
      "INVALID_TRANSITION",
      `Agent ${agentId} is ${agent.lifecycle_state}, expected ${expectedState} for this transition.`,
    );
  }
  return agent;
}

async function getTenantPolicyRules(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ rules: unknown }>(
    `SELECT rules FROM policy_registry
     WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'ACTIVE'
     ORDER BY tenant_id NULLS LAST
     LIMIT 1`,
    [tenantId],
  );
  return rows[0] ? parsePolicyRules(rows[0].rules) : [];
}

function toRiskLevel(securityLevel: string | null): RiskLevel {
  return securityLevel && RISK_LEVELS.includes(securityLevel as RiskLevel) ? (securityLevel as RiskLevel) : "YELLOW";
}

/**
 * DRAFT -> SANDBOX. Two real, offline checks: (1) a policy-engine gate on
 * the agent's declared security_level (a RED-security agent cannot even
 * enter sandbox without the same REQUIRE_ESCALATION governance any other
 * RED action gets); (2) every allowed_tools entry must resolve to an
 * enabled tool_registry row — an agent cannot be sandboxed referencing
 * tools that don't exist.
 */
export async function advanceToSandbox(pool: Pool, tenantId: string, agentId: string): Promise<void> {
  await withSpan(logger, `advanceToSandbox(${agentId})`, async () => {
    // Two separate transactions, deliberately: the policy decision is an
    // audit record and must survive even when it blocks the transition —
    // if it were recorded inside the same transaction as the (aborted)
    // state change, the ROLLBACK would erase the audit trail along with
    // it, which is exactly backwards for a governance record.
    const { agent, decision } = await withTenantTransaction(pool, tenantId, async (client) => {
      const agent = await requireAgent(client, agentId, "DRAFT");
      const tenantRules = await getTenantPolicyRules(client, tenantId);
      const policyInput = { actionType: "AGENT_SANDBOX", riskLevel: toRiskLevel(agent.security_level), agentId };
      const decision = evaluatePolicy(policyInput, tenantRules);
      await recordPolicyDecision(client, tenantId, policyInput, decision);
      return { agent, decision };
    });

    if (decision.decision !== "ALLOW") {
      throw new AgentFactoryError(
        "POLICY_BLOCKED",
        `Agent ${agentId} cannot enter SANDBOX automatically: ${decision.decision} (${decision.reason})`,
      );
    }

    await withTenantTransaction(pool, tenantId, async (client) => {
      const allowedTools = Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [];
      if (allowedTools.length > 0) {
        const { rows } = await client.query<{ tool_id: string }>(
          "SELECT tool_id FROM tool_registry WHERE tool_id = ANY($1::text[]) AND enabled = true",
          [allowedTools],
        );
        const resolved = new Set(rows.map((r) => r.tool_id));
        const missing = allowedTools.filter((toolId) => !resolved.has(toolId as string));
        if (missing.length > 0) {
          throw new AgentFactoryError(
            "SANDBOX_VALIDATION_FAILED",
            `Agent ${agentId} references unknown or disabled tools: ${missing.join(", ")}`,
          );
        }
      }

      await client.query("UPDATE agent_registry SET lifecycle_state = 'SANDBOX', updated_at = now() WHERE agent_id = $1", [
        agentId,
      ]);
    });
  });
}

/** SANDBOX -> TESTED. Validates input_schema/output_schema are well-formed
 * JSON Schema documents (Ajv compile, no data validated, no network). */
export async function advanceToTested(pool: Pool, tenantId: string, agentId: string): Promise<void> {
  await withSpan(logger, `advanceToTested(${agentId})`, () =>
    withTenantTransaction(pool, tenantId, async (client) => {
      const agent = await requireAgent(client, agentId, "SANDBOX");

      const inputResult = validateJsonSchemaShape(agent.input_schema, "input_schema");
      const outputResult = validateJsonSchemaShape(agent.output_schema, "output_schema");
      const errors = [...inputResult.errors, ...outputResult.errors];
      if (errors.length > 0) {
        throw new AgentFactoryError("SCHEMA_VALIDATION_FAILED", `Agent ${agentId} schema validation failed: ${errors.join("; ")}`);
      }

      await client.query("UPDATE agent_registry SET lifecycle_state = 'TESTED', updated_at = now() WHERE agent_id = $1", [
        agentId,
      ]);
    }),
  );
}

/** TESTED -> EVALUATED. Computes and persists the completeness score. */
export async function advanceToEvaluated(pool: Pool, tenantId: string, agentId: string): Promise<number> {
  return withSpan(logger, `advanceToEvaluated(${agentId})`, () =>
    withTenantTransaction(pool, tenantId, async (client) => {
      const agent = await requireAgent(client, agentId, "TESTED");
      const score = computeEvaluationScore(agent);

      await client.query(
        "UPDATE agent_registry SET evaluation_score = $1, lifecycle_state = 'EVALUATED', updated_at = now() WHERE agent_id = $2",
        [score, agentId],
      );
      return score;
    }),
  );
}

/** EVALUATED -> APPROVED. A quality gate, distinct from the human
 * AGENT_ACTIVATE governance approval control-plane-api's
 * POST /agents/{id}/versions/{v}/activate already requires (Phase 2) —
 * this only says the specification is complete enough to be worth a
 * human's time; it does not put the agent into production. */
export async function advanceToApproved(
  pool: Pool,
  tenantId: string,
  agentId: string,
  minScore = 60,
): Promise<void> {
  await withSpan(logger, `advanceToApproved(${agentId})`, () =>
    withTenantTransaction(pool, tenantId, async (client) => {
      const agent = await requireAgent(client, agentId, "EVALUATED");
      const score = agent.evaluation_score === null ? 0 : Number(agent.evaluation_score);

      if (score < minScore) {
        throw new AgentFactoryError(
          "QUALITY_GATE_FAILED",
          `Agent ${agentId} scored ${score}, below the ${minScore} threshold required to reach APPROVED.`,
        );
      }

      await client.query("UPDATE agent_registry SET lifecycle_state = 'APPROVED', updated_at = now() WHERE agent_id = $1", [
        agentId,
      ]);
    }),
  );
}

export interface PipelineResult {
  agentId: string;
  reachedState: string;
  evaluationScore: number | null;
  stoppedAt?: { step: string; error: string };
}

/**
 * Runs every automated step in order, stopping at (not throwing past) the
 * first failure — each step already committed its own transaction, so
 * partial progress from earlier steps is preserved, matching how a real
 * background worker retrying one step at a time would behave.
 */
export async function runFullPipeline(pool: Pool, tenantId: string, agentId: string): Promise<PipelineResult> {
  let evaluationScore: number | null = null;

  const steps: { name: string; run: () => Promise<void> }[] = [
    { name: "advanceToSandbox", run: () => advanceToSandbox(pool, tenantId, agentId) },
    { name: "advanceToTested", run: () => advanceToTested(pool, tenantId, agentId) },
    {
      name: "advanceToEvaluated",
      run: async () => {
        evaluationScore = await advanceToEvaluated(pool, tenantId, agentId);
      },
    },
    { name: "advanceToApproved", run: () => advanceToApproved(pool, tenantId, agentId) },
  ];

  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`pipeline stopped at ${step.name}`, { agentId, error: message });
      const state = await currentLifecycleState(pool, tenantId, agentId);
      return { agentId, reachedState: state, evaluationScore, stoppedAt: { step: step.name, error: message } };
    }
  }

  const state = await currentLifecycleState(pool, tenantId, agentId);
  return { agentId, reachedState: state, evaluationScore };
}

async function currentLifecycleState(pool: Pool, tenantId: string, agentId: string): Promise<string> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ lifecycle_state: string }>(
      "SELECT lifecycle_state FROM agent_registry WHERE agent_id = $1",
      [agentId],
    );
    return rows[0]?.lifecycle_state ?? "UNKNOWN";
  });
}
