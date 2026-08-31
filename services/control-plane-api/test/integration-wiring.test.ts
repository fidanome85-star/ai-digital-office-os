/**
 * Phase 7 integration pass: proves the four placeholder endpoints wired to
 * services/memory-service, services/cost-usage-service,
 * services/deployment-orchestrator, and services/policy-engine-service
 * (Phase 6) actually call through to that real, already-tested logic —
 * not just that the old placeholder behavior still passes unchanged
 * (golden-path.test.ts already covers that). Each case here exercises a
 * path that could ONLY pass if the wiring is real: a budget threshold
 * that requires cost-usage-service's computeBudgetStatus, a health check
 * that requires deployment-orchestrator's HttpHealthChecker, a semantic
 * search result that requires memory-service's real pgvector query, and
 * an EXPIRED decision that requires policy-engine-service's sweep.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { closeAppDbPool, createOwnerClient, signTestToken, startTestServer, stopTestServer } from "./test-helpers.js";
import { sendJson, startMockServer, stopMockServer } from "./mock-server.js";

let server: Server;
let baseUrl: string;
let owner: Client;

const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const projectId = `proj-${runTag}`;
const releaseId = `rel-${runTag}`;

let token: string;

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
}

function post(path: string, body: unknown, idempotencyKey = randomUUID()): Promise<Response> {
  return authed(path, { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": idempotencyKey } });
}

async function json(res: Response): Promise<Record<string, any>> {
  return res.json() as Promise<Record<string, any>>;
}

function unitVector(index: number, dim = 1536): number[] {
  const v = new Array(dim).fill(0);
  v[index] = 1;
  return v;
}

before(async () => {
  ({ server, baseUrl } = await startTestServer());
  token = await signTestToken({ tenantId, scopes: ["*"] });

  owner = createOwnerClient();
  await owner.connect();

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Integration Wiring Tenant",
    `wiring-${runTag}`,
  ]);
  await owner.query(
    `INSERT INTO project_registry (project_id, tenant_id, project_name, project_type) VALUES ($1, $2, 'Test Project', 'internal-tool')`,
    [projectId, tenantId],
  );
  await owner.query(
    `INSERT INTO release_registry (release_id, tenant_id, project_id, version, artifact_refs, status)
     VALUES ($1, $2, $3, '1.0.0', '[]'::jsonb, 'READY')`,
    [releaseId, tenantId, projectId],
  );
});

after(async () => {
  try {
    await owner.query("UPDATE deployment_registry SET rollback_target = NULL WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM api_idempotency_keys WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM deployment_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM approval_requests WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM memory_embeddings WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM memory_facts WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM secrets_vault_references WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM usage_events WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM budget_tiers WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM release_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM project_registry WHERE tenant_id = $1", [tenantId]);
    await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  } finally {
    await stopTestServer(server);
    await closeAppDbPool();
    await owner.end();
  }
});

describe("GET /costs — real budget_status via cost-usage-service", () => {
  it("progresses OK -> WARNING -> SOFT_LIMIT -> HARD_LIMIT as usage grows against a configured budget_tiers row", async () => {
    await owner.query(
      `INSERT INTO budget_tiers (tenant_id, period, currency, soft_limit, hard_limit) VALUES ($1, 'MONTHLY', 'USD', 1.0, 2.0)`,
      [tenantId],
    );

    const noneRes = await authed("/costs");
    assert.equal((await json(noneRes)).budgetStatus, "OK");
    assert.equal((await authed("/costs").then(json)).budgetTier.softLimit, 1);

    await owner.query(
      `INSERT INTO usage_events (tenant_id, actual_cost, currency) VALUES ($1, 0.85, 'USD')`,
      [tenantId],
    );
    assert.equal((await authed("/costs").then(json)).budgetStatus, "WARNING");

    await owner.query(
      `INSERT INTO usage_events (tenant_id, actual_cost, currency) VALUES ($1, 0.65, 'USD')`,
      [tenantId],
    );
    assert.equal((await authed("/costs").then(json)).budgetStatus, "SOFT_LIMIT");

    await owner.query(
      `INSERT INTO usage_events (tenant_id, actual_cost, currency) VALUES ($1, 1.0, 'USD')`,
      [tenantId],
    );
    const finalBody = await authed("/costs").then(json);
    assert.equal(finalBody.budgetStatus, "HARD_LIMIT");
    assert.ok(finalBody.totalCost >= 2.5);
  });
});

describe("POST /deployments + rollback — real health checks via deployment-orchestrator", () => {
  it("creates a deployment with a health_check_url and advances it to HEALTHY for real", async () => {
    const { baseUrl: mockUrl, server: mockServer } = await startMockServer((_req, res) => sendJson(res, 200, { ok: true }));
    let body: Record<string, any>;
    try {
      const res = await post("/deployments", {
        project_id: projectId,
        release_id: releaseId,
        environment: "staging",
        strategy: "standard",
        health_check_url: mockUrl,
      });
      assert.equal(res.status, 201);
      body = await json(res);
    } finally {
      await stopMockServer(mockServer);
    }

    assert.equal(body.status, "HEALTHY");
    const { rows } = await owner.query("SELECT status FROM deployment_registry WHERE deployment_id = $1", [
      body.deploymentId,
    ]);
    assert.equal(rows[0].status, "HEALTHY");
  });

  it("rolls back to a healthy target for real and marks the original ROLLED_BACK only once confirmed", async () => {
    const { baseUrl: mockUrl, server: mockServer } = await startMockServer((_req, res) => sendJson(res, 200, { ok: true }));
    let deploymentId: string;
    let targetId: string;
    try {
      const targetRes = await post("/deployments", {
        project_id: projectId,
        release_id: releaseId,
        environment: "staging",
        strategy: "standard",
        health_check_url: mockUrl,
      });
      targetId = (await json(targetRes)).deploymentId;

      const currentRes = await post("/deployments", {
        project_id: projectId,
        release_id: releaseId,
        environment: "staging",
        strategy: "standard",
        health_check_url: mockUrl,
      });
      deploymentId = (await json(currentRes)).deploymentId;
      await owner.query("UPDATE deployment_registry SET rollback_target = $1 WHERE deployment_id = $2", [
        targetId,
        deploymentId,
      ]);

      const rollbackRes = await post(`/deployments/${deploymentId}/rollback`, {});
      assert.equal(rollbackRes.status, 202);
      const rollbackBody = await json(rollbackRes);
      assert.equal(rollbackBody.status, "HEALTHY");
    } finally {
      await stopMockServer(mockServer);
    }

    const { rows } = await owner.query("SELECT status FROM deployment_registry WHERE deployment_id = $1", [
      deploymentId,
    ]);
    assert.equal(rows[0].status, "ROLLED_BACK");
  });

  it("falls back to an unchecked rollback when no health_check_url was recorded (unchanged Phase 2 behavior)", async () => {
    const createRes = await post("/deployments", {
      project_id: projectId,
      release_id: releaseId,
      environment: "staging",
      strategy: "standard",
    });
    const deploymentId = (await json(createRes)).deploymentId;
    await owner.query("UPDATE deployment_registry SET status = 'HEALTHY', rollback_target = deployment_id WHERE deployment_id = $1", [
      deploymentId,
    ]);

    const rollbackRes = await post(`/deployments/${deploymentId}/rollback`, {});
    assert.equal(rollbackRes.status, 202);
  });
});

describe("POST /memory/query — real Tier 3 semantic search via memory-service", () => {
  it("returns a pgvector-ranked semantic result once an embedding-provider secret is configured", async () => {
    const { rows } = await owner.query(
      `INSERT INTO secrets_vault_references (tenant_id, secret_name, vault_path) VALUES ($1, 'memory-embedding-provider', 'env:TEST_EMBEDDING_KEY') RETURNING reference_id`,
      [tenantId],
    );
    assert.ok(rows[0].reference_id);
    process.env["TEST_EMBEDDING_KEY"] = "fake-test-key";

    const queryVector = unitVector(42);
    await owner.query(
      `INSERT INTO memory_embeddings (tenant_id, content, embedding, embedding_model)
       VALUES ($1, $2, $3::vector, 'text-embedding-3-small')`,
      [tenantId, "The wired semantic memory fact.", `[${queryVector.join(",")}]`],
    );

    const { baseUrl: mockUrl, server: mockServer } = await startMockServer((_req, res) =>
      sendJson(res, 200, { data: [{ embedding: queryVector }] }),
    );
    process.env["EMBEDDING_PROVIDER_BASE_URL"] = mockUrl;

    let bodyArr: any[];
    try {
      const res = await post("/memory/query", { query_text: "irrelevant text, mock always returns the same vector" });
      assert.equal(res.status, 200);
      bodyArr = (await res.json()) as any[];
    } finally {
      await stopMockServer(mockServer);
      delete process.env["EMBEDDING_PROVIDER_BASE_URL"];
      delete process.env["TEST_EMBEDDING_KEY"];
      // Remove the configured secret so the next test's "no secret
      // configured" case actually exercises that path, rather than
      // finding this row still present and failing to resolve an env var
      // that's already been deleted above.
      await owner.query("DELETE FROM secrets_vault_references WHERE tenant_id = $1 AND secret_name = 'memory-embedding-provider'", [
        tenantId,
      ]);
    }

    const semanticHit = bodyArr.find((r) => r.content === "The wired semantic memory fact.");
    assert.ok(semanticHit, "expected the real pgvector semantic result to be present");
    assert.ok(semanticHit.similarity > 0.99, `expected near-1.0 cosine similarity, got ${semanticHit.similarity}`);
  });

  it("skips Tier 3 entirely (Tier 2 only) when no embedding-provider secret is configured — unchanged Phase 2 behavior", async () => {
    await owner.query(
      `INSERT INTO memory_facts (tenant_id, scope, subject_type, subject_id, fact) VALUES ($1, 'PROJECT', 'project', $2, 'A plain text-matched fact.')`,
      [tenantId, projectId],
    );

    const res = await post("/memory/query", { query_text: "plain text-matched" });
    assert.equal(res.status, 200);
    const bodyArr = (await res.json()) as any[];
    assert.ok(bodyArr.some((r) => r.content === "A plain text-matched fact."));
  });
});

describe("GET /approvals — real expiry sweep via policy-engine-service", () => {
  it("flips an overdue undecided approval to EXPIRED before listing, and omits it from the pending list", async () => {
    const { rows } = await owner.query(
      `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, expires_at)
       VALUES ($1, $2, 'AGENT_ACTIVATE', 'YELLOW', now() - interval '1 hour') RETURNING request_id`,
      [`appr-${randomUUID()}`, tenantId],
    );
    const requestId = rows[0].request_id;

    const res = await authed("/approvals");
    assert.equal(res.status, 200);
    const list = (await res.json()) as any[];
    assert.ok(list.every((a) => a.requestId !== requestId), "expired approval must not appear in the pending list");

    const { rows: dbRows } = await owner.query("SELECT decision FROM approval_requests WHERE request_id = $1", [
      requestId,
    ]);
    assert.equal(dbRows[0].decision, "EXPIRED");
  });
});
