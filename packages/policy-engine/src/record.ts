import type { PoolClient } from "pg";
import type { PolicyDecision, PolicyInput } from "./types.js";

/**
 * Persists a policy_decision_records row. Takes a PoolClient rather than
 * owning a pool itself — the caller controls the transaction boundary
 * (usually @ai-office/db's withTenantTransaction), so this write
 * participates in whatever larger operation triggered the policy check
 * and rolls back with it on failure.
 */
export async function recordPolicyDecision(
  client: PoolClient,
  tenantId: string,
  input: PolicyInput,
  decision: PolicyDecision,
): Promise<void> {
  await client.query(
    `INSERT INTO policy_decision_records
       (tenant_id, task_id, agent_id, tool_id, model_id, provider_id, decision, policy_version, alternatives, rejection_reasons)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tenantId,
      input.taskId ?? null,
      input.agentId ?? null,
      input.toolId ?? null,
      input.modelId ?? null,
      input.providerId ?? null,
      decision.decision,
      decision.policyVersion,
      decision.matchedRule ? JSON.stringify([decision.matchedRule]) : null,
      decision.decision === "DENY" || decision.decision === "REQUIRE_ESCALATION"
        ? JSON.stringify({ reason: decision.reason })
        : null,
    ],
  );
}
