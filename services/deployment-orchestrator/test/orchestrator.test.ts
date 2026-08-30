import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { DeploymentOrchestratorError } from "../src/errors.js";
import { HttpHealthChecker } from "../src/health-checker.js";
import { advanceDeployment, rollbackDeployment } from "../src/orchestrator.js";
import { startMockHealthServer, stopMockHealthServer } from "./mock-health-server.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);
const projectId = `proj-${runTag}`;
const releaseId = `rel-${runTag}`;
const checker = new HttpHealthChecker();

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Deployment Orchestrator Test Tenant",
    `dep-test-${runTag}`,
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
  await appPool.end();
  await owner.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM deployment_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM release_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM project_registry WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

async function seedDeployment(status = "IN_PROGRESS", rollbackTarget: string | null = null): Promise<string> {
  const deploymentId = `depl-${randomUUID()}`;
  await owner.query(
    `INSERT INTO deployment_registry (deployment_id, tenant_id, project_id, release_id, environment, strategy, status, rollback_target, started_at)
     VALUES ($1, $2, $3, $4, 'staging', 'standard', $5, $6, now())`,
    [deploymentId, tenantId, projectId, releaseId, status, rollbackTarget],
  );
  return deploymentId;
}

describe("deployment-orchestrator", () => {
  it("advances an IN_PROGRESS deployment to HEALTHY on a successful health check", async () => {
    const deploymentId = await seedDeployment();
    const { url, server } = await startMockHealthServer(200);
    try {
      const result = await advanceDeployment(appPool, tenantId, deploymentId, checker, url);
      assert.equal(result.status, "HEALTHY");
    } finally {
      await stopMockHealthServer(server);
    }

    const { rows } = await owner.query("SELECT status FROM deployment_registry WHERE deployment_id = $1", [deploymentId]);
    assert.equal(rows[0].status, "HEALTHY");

    const { rows: auditRows } = await owner.query(
      "SELECT event_type FROM audit_events WHERE tenant_id = $1 AND event_type = 'DEPLOYMENT_HEALTHY'",
      [tenantId],
    );
    assert.equal(auditRows.length, 1);
  });

  it("marks a deployment FAILED when the health check returns a non-2xx status", async () => {
    const deploymentId = await seedDeployment();
    const { url, server } = await startMockHealthServer(503);
    try {
      const result = await advanceDeployment(appPool, tenantId, deploymentId, checker, url);
      assert.equal(result.status, "FAILED");
    } finally {
      await stopMockHealthServer(server);
    }

    const { rows } = await owner.query("SELECT status FROM deployment_registry WHERE deployment_id = $1", [deploymentId]);
    assert.equal(rows[0].status, "FAILED");
  });

  it("refuses to advance a deployment that isn't IN_PROGRESS", async () => {
    const deploymentId = await seedDeployment("HEALTHY");
    await assert.rejects(
      () => advanceDeployment(appPool, tenantId, deploymentId, checker, "http://unused"),
      (err: unknown) => {
        assert.ok(err instanceof DeploymentOrchestratorError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
  });

  it("throws NOT_FOUND for an unknown deployment", async () => {
    await assert.rejects(
      () => advanceDeployment(appPool, tenantId, "does-not-exist", checker, "http://unused"),
      (err: unknown) => {
        assert.ok(err instanceof DeploymentOrchestratorError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });

  it("rolls back to a healthy target and marks the original ROLLED_BACK", async () => {
    const targetId = await seedDeployment("HEALTHY");
    const currentId = await seedDeployment("HEALTHY", targetId);

    const { url, server } = await startMockHealthServer(200);
    let result;
    try {
      result = await rollbackDeployment(appPool, tenantId, currentId, checker, url);
    } finally {
      await stopMockHealthServer(server);
    }

    assert.equal(result.status, "HEALTHY");
    const { rows: originalRows } = await owner.query("SELECT status FROM deployment_registry WHERE deployment_id = $1", [currentId]);
    assert.equal(originalRows[0].status, "ROLLED_BACK");
    const { rows: newRows } = await owner.query("SELECT status, release_id FROM deployment_registry WHERE deployment_id = $1", [
      result.rollbackDeploymentId,
    ]);
    assert.equal(newRows[0].status, "HEALTHY");
    assert.equal(newRows[0].release_id, releaseId);
  });

  it("does not mark the original ROLLED_BACK when the rollback itself fails its health check", async () => {
    const targetId = await seedDeployment("HEALTHY");
    const currentId = await seedDeployment("HEALTHY", targetId);

    const { url, server } = await startMockHealthServer(500);
    let result;
    try {
      result = await rollbackDeployment(appPool, tenantId, currentId, checker, url);
    } finally {
      await stopMockHealthServer(server);
    }

    assert.equal(result.status, "FAILED");
    const { rows: originalRows } = await owner.query("SELECT status FROM deployment_registry WHERE deployment_id = $1", [currentId]);
    assert.equal(originalRows[0].status, "HEALTHY", "original deployment must be untouched — nothing was actually rolled back");
  });

  it("throws NO_ROLLBACK_TARGET when the deployment has no rollback_target recorded", async () => {
    const deploymentId = await seedDeployment("HEALTHY", null);
    await assert.rejects(
      () => rollbackDeployment(appPool, tenantId, deploymentId, checker, "http://unused"),
      (err: unknown) => {
        assert.ok(err instanceof DeploymentOrchestratorError);
        assert.equal(err.code, "NO_ROLLBACK_TARGET");
        return true;
      },
    );
  });
});
