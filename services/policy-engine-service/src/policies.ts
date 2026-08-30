import { randomUUID } from "node:crypto";
import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { withSpan } from "@ai-office/observability";
import { PolicyEngineError, type PolicyRule, parsePolicyRules } from "@ai-office/policy-engine";
import { PolicyEngineServiceError } from "./errors.js";
import { logger } from "./logger.js";

export interface UpsertPolicyInput {
  /** Omit to create a new tenant policy; pass an existing policy_id to update it in place. */
  policyId?: string;
  policyName: string;
  policyVersion: string;
  rules: PolicyRule[];
  status?: "ACTIVE" | "INACTIVE";
}

export interface PolicyRecord {
  policyId: string;
  tenantId: string;
  policyName: string;
  policyVersion: string;
  rules: PolicyRule[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PolicyRow {
  policy_id: string;
  tenant_id: string;
  policy_name: string;
  policy_version: string;
  rules: unknown;
  status: string;
  created_at: string;
  updated_at: string;
}

function toRecord(row: PolicyRow): PolicyRecord {
  return {
    policyId: row.policy_id,
    tenantId: row.tenant_id,
    policyName: row.policy_name,
    policyVersion: row.policy_version,
    rules: parsePolicyRules(row.rules),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates the given rules through @ai-office/policy-engine's own parser
 * before ever writing them — a malformed rule set must never reach
 * policy_registry, because evaluatePolicy has no way to reject a bad rule
 * at decision time; it can only fail closed on the whole policy. Rejecting
 * here, at write time, is the only place a clear error can be given back
 * to whoever is authoring the policy.
 *
 * Every policy this service writes is tenant-scoped (RLS's WITH CHECK
 * requires tenant_id to match the caller's tenant on every write) — the
 * NULL-tenant global defaults in policy_registry can only be seeded by the
 * migration-owner role, never through this service.
 */
export async function upsertPolicy(pool: Pool, tenantId: string, input: UpsertPolicyInput): Promise<PolicyRecord> {
  return withSpan(logger, "upsertPolicy", async () => {
    try {
      parsePolicyRules(input.rules);
    } catch (err) {
      const message = err instanceof PolicyEngineError ? err.message : String(err);
      throw new PolicyEngineServiceError("INVALID_RULES", message);
    }

    const policyId = input.policyId ?? `pol-${randomUUID()}`;
    const status = input.status ?? "ACTIVE";

    const row = await withTenantTransaction(pool, tenantId, async (client) => {
      const { rows } = await client.query<PolicyRow>(
        `INSERT INTO policy_registry (policy_id, tenant_id, policy_name, policy_version, rules, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (policy_id) DO UPDATE SET
           policy_name = EXCLUDED.policy_name,
           policy_version = EXCLUDED.policy_version,
           rules = EXCLUDED.rules,
           status = EXCLUDED.status,
           updated_at = now()
         RETURNING *`,
        [policyId, tenantId, input.policyName, input.policyVersion, JSON.stringify(input.rules), status],
      );
      return rows[0]!;
    });

    logger.info("policy upserted", { tenantId, policyId, status });
    return toRecord(row);
  });
}

/** Tenant-scoped policy lookup (never the NULL-tenant global default row — that's DEFAULT_RULES's job at evaluation time). */
export async function listPolicies(pool: Pool, tenantId: string): Promise<PolicyRecord[]> {
  const rows = await withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<PolicyRow>(
      "SELECT * FROM policy_registry WHERE tenant_id = $1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows;
  });
  return rows.map(toRecord);
}

export async function getPolicy(pool: Pool, tenantId: string, policyId: string): Promise<PolicyRecord> {
  const row = await withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<PolicyRow>(
      "SELECT * FROM policy_registry WHERE tenant_id = $1 AND policy_id = $2",
      [tenantId, policyId],
    );
    return rows[0];
  });
  if (!row) throw new PolicyEngineServiceError("NOT_FOUND", `Policy ${policyId} not found for this tenant.`);
  return toRecord(row);
}
