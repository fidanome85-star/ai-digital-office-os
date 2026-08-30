import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { closeAppDbPool, createOwnerClient, signTestToken, startTestServer, stopTestServer } from "./test-helpers.js";

let server: Server;
let baseUrl: string;
let owner: Client;
const tenantId = randomUUID();

before(async () => {
  ({ server, baseUrl } = await startTestServer());
  owner = createOwnerClient();
  await owner.connect();
  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Control Plane Test Tenant",
    `cp-test-${tenantId.slice(0, 8)}`,
  ]);
});

after(async () => {
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
  await stopTestServer(server);
  await closeAppDbPool();
});

describe("GET /tenants/current", () => {
  it("returns the caller's own tenant record end-to-end (auth -> tenant context -> RLS -> db)", async () => {
    const token = await signTestToken({ tenantId });
    const res = await fetch(`${baseUrl}/tenants/current`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.tenantId, tenantId);
    assert.equal(body.orgName, "Control Plane Test Tenant");
  });

  it("rejects a request with no bearer token", async () => {
    const res = await fetch(`${baseUrl}/tenants/current`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error_code, "AUTHORIZATION_ERROR");
    assert.ok(body.correlation_id);
  });

  it("never returns another tenant's organization row", async () => {
    const otherTenantId = randomUUID();
    const token = await signTestToken({ tenantId: otherTenantId });
    const res = await fetch(`${baseUrl}/tenants/current`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);
  });
});
