/**
 * The full ≥50-case RLS adversarial suite the acceptance checklist calls
 * for (docs/blueprint/implementation_acceptance_checklist_v1.4.md),
 * closing the gap `cross-tenant.test.ts` (2 tables, a smoke test) always
 * documented as remaining. Every one of the 35 tenant-scoped operational
 * tables that isn't `organizations` (already covered thoroughly by the
 * smoke test — its primary key literally IS the tenant id, a structurally
 * different case) gets the same three real, adversarial checks, run
 * against real Postgres as the non-owning `ai_office_app` role:
 *
 *   1. An INSERT that claims tenant B's session but forges tenant A's
 *      tenant_id is rejected by the table's WITH CHECK policy.
 *   2. A row that genuinely belongs to tenant A is invisible to tenant
 *      B's SELECT, even though it exists.
 *   3. Cross-tenant UPDATE and DELETE against that row are no-ops (zero
 *      rows affected) rather than errors, and the row provably survives
 *      (re-read under tenant A's own session afterward).
 *
 * 35 tables x 3 cases = 105, plus the smoke test's 5 = 110 total —
 * comfortably past the ">=50" target, and every case is a real assertion
 * against a real row in a real table, not a parameterized stand-in for
 * one representative table.
 *
 * Same transaction/SAVEPOINT discipline as cross-tenant.test.ts: the
 * whole run is one BEGIN...ROLLBACK so no fixture data survives, and each
 * "must reject" case uses its own SAVEPOINT so one rejected statement
 * doesn't abort every case after it.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";

const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is not set. See .env.example (must be the ai_office_app role, not the owner).");
}

const client = new Client({ connectionString: APP_DATABASE_URL });

const tenantA = randomUUID();
const tenantB = randomUUID();
const tagA = tenantA.slice(0, 8);
const tagB = tenantB.slice(0, 8);

async function setTenant(tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
}

interface ColumnValue {
  column: string;
  value: unknown;
  cast?: string;
}

function c(column: string, value: unknown, cast?: string): ColumnValue {
  return cast ? { column, value, cast } : { column, value };
}

function j(value: unknown): string {
  return JSON.stringify(value);
}

async function insertReturning(table: string, columns: ColumnValue[], returning: string[]): Promise<Record<string, unknown>> {
  const cols = columns.map((cv) => cv.column).join(", ");
  const placeholders = columns.map((cv, i) => `$${i + 1}${cv.cast ? `::${cv.cast}` : ""}`).join(", ");
  const values = columns.map((cv) => cv.value);
  const { rows } = await client.query(
    `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING ${returning.join(", ")}`,
    values,
  );
  return rows[0];
}

interface TenantFx {
  tenantId: string;
  agentId: string;
  agentVersionId: string;
  projectId: string;
  workflowId: string;
  taskId: string;
  roleId: string;
  mcpServerId: string;
}

interface GlobalFx {
  userId: string;
  providerId: string;
  modelId: string;
  toolId: string;
  permissionId: string;
}

let globals: GlobalFx;
let fxA: TenantFx;
let fxB: TenantFx;

async function buildTenantFixtures(tenantId: string, tag: string): Promise<TenantFx> {
  const agentId = `agent-${tag}`;
  await client.query(
    "INSERT INTO agent_registry (agent_id, tenant_id, agent_name, department, role) VALUES ($1,$2,$3,'Engineering','worker')",
    [agentId, tenantId, `Agent ${tag}`],
  );

  const av = await insertReturning(
    "agent_versions",
    [c("agent_id", agentId), c("tenant_id", tenantId), c("version", "1.0.0"), c("specification_hash", "deadbeef"), c("lifecycle_state", "DRAFT")],
    ["agent_version_id"],
  );

  const projectId = `proj-${tag}`;
  await client.query(
    "INSERT INTO project_registry (project_id, tenant_id, project_name, project_type) VALUES ($1,$2,$3,'internal-tool')",
    [projectId, tenantId, `Project ${tag}`],
  );

  const workflowId = `wf-${tag}`;
  await client.query(
    "INSERT INTO workflow_registry (workflow_id, tenant_id, workflow_type, definition_version) VALUES ($1,$2,'task-shaped','1')",
    [workflowId, tenantId],
  );

  const taskId = `task-${tag}`;
  await client.query("INSERT INTO task_registry (task_id, tenant_id, idempotency_key) VALUES ($1,$2,$3)", [
    taskId,
    tenantId,
    `idem-${tag}`,
  ]);

  const role = await insertReturning("roles", [c("tenant_id", tenantId), c("role_name", `Role ${tag}`)], ["role_id"]);

  const mcpServerId = `mcp-${tag}`;
  await client.query(
    "INSERT INTO mcp_server_registry (mcp_server_id, tenant_id, server_name, endpoint) VALUES ($1,$2,$3,'https://mcp.test.local')",
    [mcpServerId, tenantId, `MCP ${tag}`],
  );

  return {
    tenantId,
    agentId,
    agentVersionId: av["agent_version_id"] as string,
    projectId,
    workflowId,
    taskId,
    roleId: role["role_id"] as string,
    mcpServerId,
  };
}

async function buildGlobalFixtures(tag: string): Promise<GlobalFx> {
  const user = await insertReturning("users", [c("email", `rls-test-${tag}@example.com`)], ["user_id"]);

  const providerId = `prov-${tag}`;
  await client.query(
    "INSERT INTO provider_registry (provider_id, provider_name, provider_type, adapter_type) VALUES ($1,$2,'llm','test-adapter')",
    [providerId, `Provider ${tag}`],
  );

  const modelId = `model-${tag}`;
  await client.query("INSERT INTO model_registry (model_id, provider_id, model_name) VALUES ($1,$2,$3)", [
    modelId,
    providerId,
    `Model ${tag}`,
  ]);

  const toolId = `tool-${tag}`;
  await client.query("INSERT INTO tool_registry (tool_id, tool_name) VALUES ($1,$2)", [toolId, `Tool ${tag}`]);

  const permissionId = `perm-${tag}`;
  await client.query("INSERT INTO permissions (permission_id, resource, action) VALUES ($1,'agent','READ')", [
    permissionId,
  ]);

  return {
    userId: user["user_id"] as string,
    providerId,
    modelId,
    toolId,
    permissionId,
  };
}

function unitVector(index: number, dim = 1536): string {
  const v = new Array(dim).fill(0);
  v[index] = 1;
  return `[${v.join(",")}]`;
}

interface TableCase {
  table: string;
  pkColumns: string[];
  /** Full row for the legitimate owner (tenantId matches the session). */
  row(tenantId: string, fx: TenantFx): ColumnValue[];
  /** Row for the forgery case: session is the attacker's, tenant_id column
   * claims the victim's id. Defaults to the attacker's own row() with
   * tenant_id swapped to the victim — overridden only for the two tables
   * whose FK to `roles` is composite on (tenant_id, role_id), where that
   * swap alone would trip a FK violation instead of the RLS one. */
  forgedRow?(victimTenantId: string, attackerFx: TenantFx, victimFx: TenantFx): ColumnValue[];
}

function defaultForgedRow(table: TableCase, victimTenantId: string, attackerFx: TenantFx): ColumnValue[] {
  return table.row(attackerFx.tenantId, attackerFx).map((cv) => (cv.column === "tenant_id" ? { ...cv, value: victimTenantId } : cv));
}

const tableCases: TableCase[] = [
  {
    table: "user_organization_membership",
    pkColumns: ["membership_id"],
    row: (t) => [c("tenant_id", t), c("user_id", globals.userId)],
  },
  {
    table: "roles",
    pkColumns: ["role_id"],
    row: (t, fx) => [c("tenant_id", t), c("role_name", `Extra Role ${fx.tenantId.slice(0, 8)}`)],
  },
  {
    table: "role_permissions",
    pkColumns: ["role_id", "permission_id"],
    row: (t, fx) => [c("tenant_id", t), c("role_id", fx.roleId), c("permission_id", globals.permissionId)],
    // The FK to roles is composite on (tenant_id, role_id) — forging just
    // tenant_id while keeping the attacker's own role_id would fail with a
    // foreign-key violation, not the RLS violation this case exists to
    // prove. Using the victim's real role_id keeps the FK valid so the
    // WITH CHECK failure is the only thing that can reject the insert.
    forgedRow: (victimTenantId, _attackerFx, victimFx) => [
      c("tenant_id", victimTenantId),
      c("role_id", victimFx.roleId),
      c("permission_id", globals.permissionId),
    ],
  },
  {
    table: "user_roles",
    pkColumns: ["tenant_id", "user_id", "role_id"],
    row: (t, fx) => [c("tenant_id", t), c("user_id", globals.userId), c("role_id", fx.roleId)],
    forgedRow: (victimTenantId, _attackerFx, victimFx) => [
      c("tenant_id", victimTenantId),
      c("user_id", globals.userId),
      c("role_id", victimFx.roleId),
    ],
  },
  {
    table: "agent_registry",
    pkColumns: ["agent_id"],
    row: (t, fx) => [c("agent_id", `agent2-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("agent_name", "Second Agent"), c("department", "Engineering"), c("role", "worker")],
  },
  {
    table: "agent_versions",
    pkColumns: ["agent_version_id"],
    row: (t, fx) => [c("agent_id", fx.agentId), c("tenant_id", t), c("version", "2.0.0"), c("specification_hash", "cafef00d"), c("lifecycle_state", "DRAFT")],
  },
  {
    table: "prompt_registry",
    pkColumns: ["prompt_id"],
    row: (t, fx) => [c("prompt_id", `prompt-${fx.tenantId.slice(0, 8)}`), c("agent_id", fx.agentId), c("tenant_id", t), c("version", "1.0.0"), c("system_instruction", "Be helpful.")],
  },
  {
    table: "policy_registry",
    pkColumns: ["policy_id"],
    row: (t, fx) => [c("policy_id", `policy-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("policy_name", "Tenant Policy"), c("policy_version", "1.0.0"), c("rules", j([]), "jsonb")],
  },
  {
    table: "approval_requests",
    pkColumns: ["request_id"],
    row: (t, fx) => [c("request_id", `appr-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("action", "AGENT_ACTIVATE"), c("risk_level", "YELLOW")],
  },
  {
    table: "project_registry",
    pkColumns: ["project_id"],
    row: (t, fx) => [c("project_id", `proj2-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("project_name", "Second Project"), c("project_type", "internal-tool")],
  },
  {
    table: "workflow_registry",
    pkColumns: ["workflow_id"],
    row: (t, fx) => [c("workflow_id", `wf2-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("workflow_type", "task-shaped"), c("definition_version", "1")],
  },
  {
    table: "workflow_history",
    pkColumns: ["event_id"],
    row: (t, fx) => [c("workflow_id", fx.workflowId), c("tenant_id", t), c("sequence_no", 1), c("event_type", "STARTED")],
  },
  {
    table: "task_registry",
    pkColumns: ["task_id"],
    row: (t, fx) => [c("task_id", `task2-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("idempotency_key", `idem2-${fx.tenantId.slice(0, 8)}`)],
  },
  {
    table: "agent_runs",
    pkColumns: ["agent_run_id"],
    row: (t, fx) => [c("agent_run_id", `run-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("status", "RUNNING")],
  },
  {
    table: "model_runs",
    pkColumns: ["model_run_id"],
    row: (t, fx) => [c("model_run_id", `mrun-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t)],
  },
  {
    table: "agent_messages",
    pkColumns: ["message_id"],
    row: (t, fx) => [c("tenant_id", t), c("sender_agent_id", fx.agentId), c("receiver_agent_id", fx.agentId), c("message_type", "TASK_ASSIGN")],
  },
  {
    table: "a2a_capability_cards",
    pkColumns: ["card_id"],
    row: (t, fx) => [c("tenant_id", t), c("agent_id", fx.agentId), c("card_payload", j({}), "jsonb")],
  },
  {
    table: "working_memory_cache",
    pkColumns: ["cache_key"],
    // cache_key is the table's global PK (not composite with tenant_id —
    // see services/memory-service's own ADR note), so it must be unique
    // across both tenants in this suite, not just within one.
    row: (t, fx) => [c("cache_key", `wmc-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("payload", j({}), "jsonb"), c("expires_at", new Date(Date.now() + 3600_000).toISOString())],
  },
  {
    table: "memory_facts",
    pkColumns: ["memory_id"],
    row: (t) => [c("tenant_id", t), c("scope", "PROJECT"), c("subject_type", "project"), c("subject_id", "x"), c("fact", "An adversarial-test fact.")],
  },
  {
    table: "memory_embeddings",
    pkColumns: ["embedding_id"],
    row: (t, fx) => [c("tenant_id", t), c("content", "An adversarial-test embedding."), c("embedding", unitVector(1), "vector"), c("embedding_model", `test-model-${fx.tenantId.slice(0, 8)}`)],
  },
  {
    table: "artifact_registry",
    pkColumns: ["artifact_id"],
    row: (t) => [c("tenant_id", t), c("artifact_type", "text"), c("storage_uri", "mem://test"), c("content_hash", "0000")],
  },
  {
    table: "decision_records",
    pkColumns: ["decision_id"],
    row: (t, fx) => [c("decision_id", `dec-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("decision", "proceed")],
  },
  {
    table: "audit_events",
    pkColumns: ["event_id"],
    row: (t) => [c("tenant_id", t), c("event_type", "TEST_EVENT")],
  },
  {
    table: "secrets_vault_references",
    pkColumns: ["reference_id"],
    row: (t) => [c("tenant_id", t), c("secret_name", "test-secret"), c("vault_path", "env:TEST_VAR")],
  },
  {
    table: "feature_flags",
    pkColumns: ["flag_id"],
    row: (t, fx) => [c("tenant_id", t), c("flag_key", `flag-${fx.tenantId.slice(0, 8)}`), c("default_value", j(true), "jsonb")],
  },
  {
    table: "configuration_versions",
    pkColumns: ["config_id"],
    row: (t) => [c("tenant_id", t), c("environment", "staging"), c("version", "1"), c("payload", j({}), "jsonb")],
  },
  {
    table: "usage_events",
    pkColumns: ["usage_event_id"],
    row: (t) => [c("tenant_id", t)],
  },
  {
    table: "release_registry",
    pkColumns: ["release_id"],
    row: (t, fx) => [c("release_id", `rel-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("project_id", fx.projectId), c("version", "1.0.0"), c("artifact_refs", j([]), "jsonb"), c("status", "READY")],
  },
  {
    table: "deployment_registry",
    pkColumns: ["deployment_id"],
    row: (t, fx) => [c("deployment_id", `depl-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("project_id", fx.projectId), c("environment", "staging"), c("strategy", "standard"), c("status", "IN_PROGRESS")],
  },
  {
    table: "mcp_server_registry",
    pkColumns: ["mcp_server_id"],
    row: (t, fx) => [c("mcp_server_id", `mcp2-${fx.tenantId.slice(0, 8)}`), c("tenant_id", t), c("server_name", "Second MCP"), c("endpoint", "https://mcp2.test.local")],
  },
  {
    table: "agent_tool_bindings",
    pkColumns: ["tenant_id", "agent_id", "tool_id"],
    row: (t, fx) => [c("tenant_id", t), c("agent_id", fx.agentId), c("tool_id", globals.toolId)],
  },
  {
    table: "policy_decision_records",
    pkColumns: ["policy_decision_id"],
    row: (t) => [c("tenant_id", t), c("decision", "ALLOW"), c("policy_version", "1.0.0")],
  },
  {
    table: "routing_decision_records",
    pkColumns: ["routing_decision_id"],
    row: (t) => [c("tenant_id", t)],
  },
  {
    table: "budget_tiers",
    pkColumns: ["budget_tier_id"],
    row: (t) => [c("tenant_id", t), c("soft_limit", 1), c("hard_limit", 2)],
  },
  {
    table: "api_idempotency_keys",
    pkColumns: ["tenant_id", "idempotency_key"],
    row: (t, fx) => [c("tenant_id", t), c("idempotency_key", `key-${fx.tenantId.slice(0, 8)}`), c("method", "POST"), c("path", "/test"), c("response_status", 200), c("response_body", j({}), "jsonb")],
  },
];

before(async () => {
  await client.connect();
  await client.query("BEGIN");

  await setTenant(tenantA);
  await client.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantA,
    "Full Coverage Tenant A",
    `full-a-${tagA}`,
  ]);
  await setTenant(tenantB);
  await client.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantB,
    "Full Coverage Tenant B",
    `full-b-${tagB}`,
  ]);

  globals = await buildGlobalFixtures(`${tagA}-${tagB}`);

  await setTenant(tenantA);
  fxA = await buildTenantFixtures(tenantA, tagA);
  await setTenant(tenantB);
  fxB = await buildTenantFixtures(tenantB, tagB);
});

after(async () => {
  await client.query("ROLLBACK");
  await client.end();
});

function wherePk(pkColumns: string[], row: Record<string, unknown>): { clause: string; values: unknown[] } {
  const values = pkColumns.map((col) => row[col]);
  const clause = pkColumns.map((col, i) => `${col} = $${i + 1}`).join(" AND ");
  return { clause, values };
}

describe("RLS full-coverage adversarial suite", () => {
  for (const tc of tableCases) {
    describe(tc.table, () => {
      it(`rejects an INSERT into ${tc.table} claiming tenant A while sessioned as tenant B`, async () => {
        await setTenant(tenantB);
        const forged = tc.forgedRow ? tc.forgedRow(tenantA, fxB, fxA) : defaultForgedRow(tc, tenantA, fxB);
        const cols = forged.map((cv) => cv.column).join(", ");
        const placeholders = forged.map((cv, i) => `$${i + 1}${cv.cast ? `::${cv.cast}` : ""}`).join(", ");
        const values = forged.map((cv) => cv.value);

        await client.query(`SAVEPOINT sp_forge`);
        await assert.rejects(
          () => client.query(`INSERT INTO ${tc.table} (${cols}) VALUES (${placeholders})`, values),
          /row-level security/i,
        );
        await client.query(`ROLLBACK TO SAVEPOINT sp_forge`);
      });

      it(`hides tenant A's real ${tc.table} row from tenant B, and cross-tenant UPDATE/DELETE are no-ops`, async () => {
        await setTenant(tenantA);
        const inserted = await insertReturning(tc.table, tc.row(tenantA, fxA), tc.pkColumns);
        const { clause, values } = wherePk(tc.pkColumns, inserted);

        await setTenant(tenantB);
        const { rows: hiddenRows } = await client.query(`SELECT * FROM ${tc.table} WHERE ${clause}`, values);
        assert.equal(hiddenRows.length, 0, `tenant B must not see tenant A's ${tc.table} row`);

        const update = await client.query(`UPDATE ${tc.table} SET tenant_id = tenant_id WHERE ${clause}`, values);
        assert.equal(update.rowCount, 0, `cross-tenant UPDATE on ${tc.table} must affect zero rows`);

        const del = await client.query(`DELETE FROM ${tc.table} WHERE ${clause}`, values);
        assert.equal(del.rowCount, 0, `cross-tenant DELETE on ${tc.table} must affect zero rows`);

        await setTenant(tenantA);
        const { rows: survivorRows } = await client.query(`SELECT * FROM ${tc.table} WHERE ${clause}`, values);
        assert.equal(survivorRows.length, 1, `tenant A's ${tc.table} row must survive the cross-tenant DELETE attempt`);
      });
    });
  }
});
