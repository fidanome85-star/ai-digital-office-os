/**
 * Real cross-tenant adversarial test against the RLS policies in
 * packages/db/migrations/0021_row_level_security_full.sql. Connects as
 * ai_office_app (see migration 0022) — a non-owning, non-superuser role —
 * because Postgres exempts table owners and superusers from RLS. Running
 * this against the migration-owner role would pass vacuously.
 *
 * The whole run happens inside one BEGIN ... ROLLBACK so no seed data
 * survives (Postgres rolls back plain SET, not just SET LOCAL, when the
 * transaction that issued it aborts). Individual "must reject" cases use
 * SAVEPOINT/ROLLBACK TO SAVEPOINT — a plain INSERT failure aborts the
 * whole enclosing transaction in Postgres, so a savepoint is the only way
 * to recover and keep using fixture rows inserted earlier in the same run.
 *
 * This is a smoke test covering two representative tables (organizations —
 * the tenant root — and project_registry, a dependent table). It is not
 * the full ≥50-case suite the acceptance checklist calls for; that belongs
 * in a later phase once every service that writes tenant data exists.
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

async function setTenant(tenantId: string): Promise<void> {
  // `SET` does not accept bound parameters; set_config() does and is the
  // standard way to set a session GUC from application code. `false` means
  // session-scoped (not SET LOCAL), which is what lets it participate in —
  // and roll back with — the enclosing transaction (see file header).
  await client.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
}

before(async () => {
  await client.connect();
  await client.query("BEGIN");

  await setTenant(tenantA);
  await client.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantA,
    "Tenant A Inc",
    `tenant-a-${tenantA.slice(0, 8)}`,
  ]);

  await setTenant(tenantB);
  await client.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantB,
    "Tenant B Inc",
    `tenant-b-${tenantB.slice(0, 8)}`,
  ]);
});

after(async () => {
  await client.query("ROLLBACK");
  await client.end();
});

describe("RLS cross-tenant isolation", () => {
  it("rejects an insert claiming a different tenant than the session (WITH CHECK)", async () => {
    await setTenant(tenantA);
    await client.query("SAVEPOINT sp_forged_org");
    await assert.rejects(
      () =>
        client.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
          tenantB,
          "Tenant B Inc (forged)",
          `tenant-b-forged-${tenantB.slice(0, 8)}`,
        ]),
      /row-level security/i,
    );
    await client.query("ROLLBACK TO SAVEPOINT sp_forged_org");
  });

  it("hides another tenant's row from SELECT even though it exists", async () => {
    await setTenant(tenantA);
    const { rows } = await client.query("SELECT tenant_id FROM organizations WHERE tenant_id = $1", [tenantB]);
    assert.equal(rows.length, 0, "tenant A must not be able to read tenant B's organization row");
  });

  it("makes UPDATE and DELETE no-ops across tenants, not errors", async () => {
    await setTenant(tenantA);
    const update = await client.query("UPDATE organizations SET org_name = 'hacked' WHERE tenant_id = $1", [
      tenantB,
    ]);
    assert.equal(update.rowCount, 0, "cross-tenant UPDATE must affect zero rows");

    const del = await client.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantB]);
    assert.equal(del.rowCount, 0, "cross-tenant DELETE must affect zero rows");

    // Prove the row actually survives (RLS filtered it out of the DELETE's
    // row set, it wasn't just silently no-op'd on an already-gone row) by
    // switching to tenant B's own session and reading it back.
    await setTenant(tenantB);
    const { rows } = await client.query("SELECT tenant_id FROM organizations WHERE tenant_id = $1", [tenantB]);
    assert.equal(rows.length, 1, "tenant B's organization row must still exist after the cross-tenant DELETE");
  });

  it("enforces isolation on a dependent table (project_registry) too", async () => {
    await setTenant(tenantA);
    await client.query(
      "INSERT INTO project_registry (project_id, tenant_id, project_name, project_type) VALUES ($1, $2, $3, $4)",
      [`proj-a-${tenantA.slice(0, 8)}`, tenantA, "Tenant A Project", "internal-tool"],
    );

    await setTenant(tenantB);
    const { rows } = await client.query("SELECT project_id FROM project_registry WHERE tenant_id = $1", [tenantA]);
    assert.equal(rows.length, 0, "tenant B must not see tenant A's projects");
  });

  it("rejects a project insert forging another tenant's id even with a valid tenant session", async () => {
    await setTenant(tenantB);
    await client.query("SAVEPOINT sp_forged_project");
    await assert.rejects(
      () =>
        client.query(
          "INSERT INTO project_registry (project_id, tenant_id, project_name, project_type) VALUES ($1, $2, $3, $4)",
          [`proj-forged-${tenantB.slice(0, 8)}`, tenantA, "Forged Project", "internal-tool"],
        ),
      /row-level security/i,
    );
    await client.query("ROLLBACK TO SAVEPOINT sp_forged_project");
  });
});
