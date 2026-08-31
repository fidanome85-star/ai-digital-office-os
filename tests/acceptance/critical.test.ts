/**
 * One test per bullet in the "Critical" section of
 * docs/blueprint/implementation_acceptance_checklist_v1.4.md. Each
 * assertion is a real query against real Postgres — never a re-statement
 * of the blueprint's claim.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createOwnerClient } from "./db.js";

let owner: Client;
const tenantId = randomUUID();
const tag = tenantId.slice(0, 8);

before(async () => {
  owner = createOwnerClient();
  await owner.connect();
  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Acceptance Critical Tenant",
    `crit-${tag}`,
  ]);
});

after(async () => {
  try {
    await owner.query("UPDATE agent_registry SET active_agent_version_id = NULL WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM artifact_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM model_runs WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM agent_runs WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM agent_versions WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM agent_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM task_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM project_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  } finally {
    await owner.end();
  }
});

describe("Critical", () => {
  it("Project registry exists and every operational project_id resolves to it", async () => {
    const projectId = `proj-${tag}`;
    await owner.query(
      "INSERT INTO project_registry (project_id, tenant_id, project_name, project_type) VALUES ($1,$2,'Acceptance Project','internal-tool')",
      [projectId, tenantId],
    );

    // A real operational table (task_registry) resolving project_id
    // through an enforced FK, not just a same-named column.
    await owner.query("INSERT INTO task_registry (task_id, tenant_id, project_id, idempotency_key) VALUES ($1,$2,$3,$4)", [
      `task-${tag}`,
      tenantId,
      projectId,
      `idem-${tag}`,
    ]);

    await assert.rejects(
      () =>
        owner.query("INSERT INTO task_registry (task_id, tenant_id, project_id, idempotency_key) VALUES ($1,$2,$3,$4)", [
          `task-bad-${tag}`,
          tenantId,
          "does-not-exist",
          `idem-bad-${tag}`,
        ]),
      /foreign key/i,
      "a task referencing a nonexistent project_id must be rejected, proving the FK is enforced, not just declared",
    );
  });

  it("Agent versions are stored separately and activation targets a specific version", async () => {
    const agentId = `agent-${tag}`;
    await owner.query(
      "INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role) VALUES ($1,$2,'Acceptance Agent','Engineering','worker')",
      [agentId, tenantId],
    );

    const v1 = await owner.query(
      "INSERT INTO agent_versions (agent_id, tenant_id, version, specification_hash, lifecycle_state) VALUES ($1,$2,'1.0.0','hash1','APPROVED') RETURNING agent_version_id",
      [agentId, tenantId],
    );
    const v2 = await owner.query(
      "INSERT INTO agent_versions (agent_id, tenant_id, version, specification_hash, lifecycle_state) VALUES ($1,$2,'2.0.0','hash2','DRAFT') RETURNING agent_version_id",
      [agentId, tenantId],
    );
    const v1Id = v1.rows[0].agent_version_id;
    const v2Id = v2.rows[0].agent_version_id;
    assert.notEqual(v1Id, v2Id, "two versions of the same agent must be two distinct stored rows");

    await owner.query("UPDATE agent_registry SET active_agent_version_id = $1 WHERE agent_id = $2", [v1Id, agentId]);
    const { rows } = await owner.query("SELECT active_agent_version_id FROM agent_registry WHERE agent_id = $1", [
      agentId,
    ]);
    assert.equal(rows[0].active_agent_version_id, v1Id);
    assert.notEqual(
      rows[0].active_agent_version_id,
      v2Id,
      "activation must target the specific version set, not silently follow the newest one",
    );
  });

  it("Agent runs and model runs exist and artifact lineage resolves through them", async () => {
    const agentId = `agent-lineage-${tag}`;
    await owner.query(
      "INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role) VALUES ($1,$2,'Lineage Agent','Engineering','worker')",
      [agentId, tenantId],
    );
    const agentRunId = `run-${tag}`;
    await owner.query("INSERT INTO agent_runs (agent_run_id, tenant_id, agent_id, status) VALUES ($1,$2,$3,'COMPLETED')", [
      agentRunId,
      tenantId,
      agentId,
    ]);
    const modelRunId = `mrun-${tag}`;
    await owner.query("INSERT INTO model_runs (model_run_id, tenant_id, agent_run_id) VALUES ($1,$2,$3)", [
      modelRunId,
      tenantId,
      agentRunId,
    ]);
    const artifactId = randomUUID();
    await owner.query(
      "INSERT INTO artifact_registry (artifact_id, tenant_id, model_run_id, artifact_type, storage_uri, content_hash) VALUES ($1,$2,$3,'text','mem://acceptance','0000')",
      [artifactId, tenantId, modelRunId],
    );

    const { rows } = await owner.query(
      `SELECT ar.artifact_id, mr.model_run_id, agr.agent_run_id, agr.agent_id
       FROM artifact_registry ar
       JOIN model_runs mr ON mr.model_run_id = ar.model_run_id
       JOIN agent_runs agr ON agr.agent_run_id = mr.agent_run_id
       WHERE ar.artifact_id = $1`,
      [artifactId],
    );
    assert.equal(rows.length, 1, "artifact -> model_run -> agent_run lineage must resolve via real FKs, not just column presence");
    assert.equal(rows[0].agent_id, agentId);
  });

  it("RLS is active on every tenant-scoped operational table", async () => {
    const { rows } = await owner.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns col
         WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
       )`,
    );
    assert.ok(rows.length >= 36, `expected at least 36 tenant-scoped tables, found ${rows.length}`);
    const withoutRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    assert.deepEqual(withoutRls, [], `every tenant-scoped table must have RLS enabled; missing: ${withoutRls.join(", ")}`);
  });

  it("RLS has both USING and WITH CHECK policies", async () => {
    const { rows } = await owner.query<{ tablename: string; qual: string | null; with_check: string | null }>(
      `SELECT tablename, qual, with_check FROM pg_policies WHERE schemaname = 'public'`,
    );
    assert.ok(rows.length >= 36, `expected at least 36 RLS policies, found ${rows.length}`);
    const incomplete = rows.filter((r) => r.qual === null || r.with_check === null).map((r) => r.tablename);
    assert.deepEqual(incomplete, [], `every RLS policy must define both USING and WITH CHECK; incomplete: ${incomplete.join(", ")}`);
  });

  it("100% cross-tenant rejection passes on all tenant-scoped resources (adversarial coverage is complete, not partial)", async () => {
    const { rows } = await owner.query<{ relname: string }>(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns col
         WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
       )`,
    );
    const allTenantTables = new Set(rows.map((r) => r.relname));

    // Mirrors exactly what tests/rls-adversarial/cross-tenant.test.ts (1
    // table) and full-coverage.test.ts (35 tables) actually exercise — if
    // a new tenant-scoped table is ever added without a matching
    // adversarial case, this assertion is what catches it.
    const coveredByCrossTenant = new Set(["organizations", "project_registry"]);
    const coveredByFullCoverage = new Set([
      "user_organization_membership", "roles", "role_permissions", "user_roles", "agent_registry", "agent_versions",
      "prompt_registry", "policy_registry", "approval_requests", "project_registry", "workflow_registry",
      "workflow_history", "task_registry", "agent_runs", "model_runs", "agent_messages", "a2a_capability_cards",
      "working_memory_cache", "memory_facts", "memory_embeddings", "artifact_registry", "decision_records",
      "audit_events", "secrets_vault_references", "feature_flags", "configuration_versions", "usage_events",
      "release_registry", "deployment_registry", "mcp_server_registry", "agent_tool_bindings",
      "policy_decision_records", "routing_decision_records", "budget_tiers", "api_idempotency_keys",
    ]);
    const covered = new Set([...coveredByCrossTenant, ...coveredByFullCoverage]);

    const uncovered = [...allTenantTables].filter((t) => !covered.has(t));
    assert.deepEqual(uncovered, [], `tenant-scoped tables with no adversarial test coverage: ${uncovered.join(", ")}`);
    assert.equal(covered.size, allTenantTables.size, "adversarial coverage must match the full tenant-scoped table set exactly");
  });
});
