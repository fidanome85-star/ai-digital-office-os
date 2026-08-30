import type { Pool, PoolClient } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { withSpan } from "@ai-office/observability";
import { DeploymentOrchestratorError } from "./errors.js";
import type { HealthChecker } from "./health-checker.js";
import { logger } from "./logger.js";

interface DeploymentRow {
  deployment_id: string;
  project_id: string;
  release_id: string;
  environment: string;
  strategy: string;
  status: string;
  rollback_target: string | null;
}

async function requireDeployment(client: PoolClient, deploymentId: string): Promise<DeploymentRow> {
  const { rows } = await client.query<DeploymentRow>("SELECT * FROM deployment_registry WHERE deployment_id = $1", [
    deploymentId,
  ]);
  const row = rows[0];
  if (!row) throw new DeploymentOrchestratorError("NOT_FOUND", `Deployment ${deploymentId} not found.`);
  return row;
}

async function auditDeployment(
  pool: Pool,
  tenantId: string,
  eventType: string,
  deploymentId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await withTenantTransaction(pool, tenantId, (client) =>
    client.query(
      `INSERT INTO audit_events (tenant_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, 'SERVICE', $3, $4)`,
      [tenantId, eventType, deploymentId, JSON.stringify({ deploymentId, ...payload })],
    ),
  );
}

export interface AdvanceDeploymentResult {
  status: "HEALTHY" | "FAILED";
  detail: string;
}

/** Runs a real health check against an IN_PROGRESS deployment and
 * transitions it to HEALTHY or FAILED based on the actual result — never
 * assumes success. Every outcome is audited. */
export async function advanceDeployment(
  pool: Pool,
  tenantId: string,
  deploymentId: string,
  healthChecker: HealthChecker,
  healthCheckUrl: string,
): Promise<AdvanceDeploymentResult> {
  return withSpan(logger, `advanceDeployment(${deploymentId})`, async () => {
    const deployment = await withTenantTransaction(pool, tenantId, (client) => requireDeployment(client, deploymentId));
    if (deployment.status !== "IN_PROGRESS") {
      throw new DeploymentOrchestratorError(
        "INVALID_STATE",
        `Deployment ${deploymentId} is ${deployment.status}, expected IN_PROGRESS.`,
      );
    }

    const result = await healthChecker.check(healthCheckUrl);
    const newStatus = result.healthy ? "HEALTHY" : "FAILED";

    await withTenantTransaction(pool, tenantId, (client) =>
      client.query("UPDATE deployment_registry SET status = $1, completed_at = now() WHERE deployment_id = $2", [
        newStatus,
        deploymentId,
      ]),
    );
    await auditDeployment(pool, tenantId, result.healthy ? "DEPLOYMENT_HEALTHY" : "DEPLOYMENT_FAILED", deploymentId, {
      detail: result.detail,
    });

    logger.info("deployment advanced", { deploymentId, status: newStatus, detail: result.detail });
    return { status: newStatus, detail: result.detail };
  });
}

export interface RollbackDeploymentResult {
  rollbackDeploymentId: string;
  status: "HEALTHY" | "FAILED";
  detail: string;
}

/**
 * Creates a new deployment_registry row targeting the recorded
 * rollback_target, health-checks it for real, and only marks the
 * original deployment ROLLED_BACK once the rollback itself is
 * confirmed healthy — a rollback that fails its own health check leaves
 * the original deployment's status untouched, because nothing was
 * actually rolled back yet.
 */
export async function rollbackDeployment(
  pool: Pool,
  tenantId: string,
  deploymentId: string,
  healthChecker: HealthChecker,
  healthCheckUrl: string,
): Promise<RollbackDeploymentResult> {
  return withSpan(logger, `rollbackDeployment(${deploymentId})`, async () => {
    const deployment = await withTenantTransaction(pool, tenantId, (client) => requireDeployment(client, deploymentId));
    if (!deployment.rollback_target) {
      throw new DeploymentOrchestratorError("NO_ROLLBACK_TARGET", `Deployment ${deploymentId} has no recorded rollback_target.`);
    }

    const rollbackDeploymentId = await withTenantTransaction(pool, tenantId, async (client) => {
      const { rows } = await client.query<{ deployment_id: string }>(
        `INSERT INTO deployment_registry (deployment_id, tenant_id, project_id, release_id, environment, strategy, status, started_at)
         SELECT gen_random_uuid()::text, tenant_id, project_id, release_id, environment, strategy, 'IN_PROGRESS', now()
         FROM deployment_registry WHERE deployment_id = $1
         RETURNING deployment_id`,
        [deployment.rollback_target],
      );
      return rows[0]!.deployment_id;
    });

    const result = await healthChecker.check(healthCheckUrl);
    const newStatus = result.healthy ? "HEALTHY" : "FAILED";

    await withTenantTransaction(pool, tenantId, async (client) => {
      await client.query("UPDATE deployment_registry SET status = $1, completed_at = now() WHERE deployment_id = $2", [
        newStatus,
        rollbackDeploymentId,
      ]);
      if (result.healthy) {
        await client.query("UPDATE deployment_registry SET status = 'ROLLED_BACK' WHERE deployment_id = $1", [deploymentId]);
      }
    });
    await auditDeployment(pool, tenantId, result.healthy ? "DEPLOYMENT_ROLLED_BACK" : "DEPLOYMENT_ROLLBACK_FAILED", deploymentId, {
      rollbackDeploymentId,
      detail: result.detail,
    });

    logger.info("rollback attempted", { deploymentId, rollbackDeploymentId, status: newStatus, detail: result.detail });
    return { rollbackDeploymentId, status: newStatus, detail: result.detail };
  });
}
