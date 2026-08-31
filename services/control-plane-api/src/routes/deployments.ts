import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { advanceDeployment, HttpHealthChecker, rollbackDeployment } from "@ai-office/deployment-orchestrator";
import { ah } from "../async-handler.js";
import { withRequestTenant, pool, type PoolClient } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow } from "../row-mapper.js";

export const deploymentsRouter = Router();

const healthChecker = new HttpHealthChecker();

/**
 * `health_check_url` is an additive, optional field beyond the v1.4
 * OpenAPI DeploymentCreateRequest schema (also documented there now — see
 * docs/decisions/0007) — a deployment created without one behaves exactly
 * as it did before this phase: it's just an IN_PROGRESS row with no live
 * infra to check (same honest gap as every network-touching piece since
 * ADR 0004). When a caller does supply one, this endpoint now runs a
 * real health check via @ai-office/deployment-orchestrator immediately
 * after creation.
 */
deploymentsRouter.post(
  "/deployments",
  ah(async (req, res) => {
    const { project_id, release_id, environment, strategy, health_check_url } = req.body ?? {};
    if (!project_id || !release_id || !environment || !strategy) {
      throw ApiError.validation("project_id, release_id, environment and strategy are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/deployments" },
        async () => {
          // No /releases endpoint exists in the v1.4 OpenAPI contract (a
          // gap in the spec itself, not this implementation), so a
          // release must already exist for this deployment to reference —
          // returning a clear validation error beats silently
          // auto-creating a release_registry row behind the caller's back.
          const release = await client.query("SELECT release_id FROM release_registry WHERE release_id = $1", [
            release_id,
          ]);
          if (release.rows.length === 0) {
            throw ApiError.validation(
              `release_id ${release_id} does not exist. release_registry has no creation endpoint in the v1.4 contract yet — seed it directly for now.`,
            );
          }

          const deploymentId = generateId("depl");
          const { rows } = await client.query(
            `INSERT INTO deployment_registry
               (deployment_id, tenant_id, project_id, release_id, environment, strategy, status, approval_request_id, health_check_url, started_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, $8, now())
             RETURNING *`,
            [
              deploymentId,
              tenantId,
              project_id,
              release_id,
              environment,
              strategy,
              req.body.approval_request_id ?? null,
              health_check_url ?? null,
            ],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );

    // Runs only after the creating transaction above has fully committed —
    // advanceDeployment opens its own transaction against deployment_registry
    // (via the shared `pool`, a separate connection from `client` above) and
    // must see a durably-committed row, not one still inside an open
    // transaction (see docs/decisions/0007). Skipped for a replayed
    // idempotent request (nothing new happened) and for a deployment
    // created without a health_check_url. The idempotency-cached response
    // body still reflects the pre-check IN_PROGRESS snapshot; only this
    // first response and a subsequent GET reflect the live outcome.
    let body = result.body as Record<string, unknown>;
    if (!result.replayed && typeof health_check_url === "string" && health_check_url.length > 0) {
      const advanceResult = await advanceDeployment(
        pool,
        tenantId,
        body["deploymentId"] as string,
        healthChecker,
        health_check_url,
      );
      body = { ...body, status: advanceResult.status };
    }

    res.status(result.status).json(body);
  }),
);

async function requireDeployment(client: PoolClient, deploymentId: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query("SELECT * FROM deployment_registry WHERE deployment_id = $1", [deploymentId]);
  if (rows.length === 0) throw ApiError.notFound(`Deployment ${deploymentId} not found.`);
  return rows[0];
}

deploymentsRouter.get(
  "/deployments/:deploymentId",
  ah(async (req, res) => {
    const row = await withRequestTenant((client) => requireDeployment(client, req.params["deploymentId"]!));
    res.status(200).json(camelizeRow(row));
  }),
);

deploymentsRouter.post(
  "/deployments/:deploymentId/rollback",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const deploymentId = req.params["deploymentId"]!;

    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: req.path },
        async () => {
          const deployment = await requireDeployment(client, deploymentId);
          if (!deployment["rollback_target"]) {
            throw ApiError.validation(`Deployment ${deploymentId} has no recorded rollback_target.`);
          }

          const healthCheckUrl = deployment["health_check_url"] as string | null;
          if (healthCheckUrl) {
            // Real, health-checked rollback via @ai-office/deployment-orchestrator
            // (Phase 6) — only marks the original deployment ROLLED_BACK once
            // the replacement is confirmed healthy (see docs/decisions/0006
            // §4, 0007). Runs its own transactions against the shared `pool`;
            // safe here because the row it reads was already committed by a
            // prior request — this branch never writes to deployment_registry
            // directly itself.
            const outcome = await rollbackDeployment(pool, tenantId, deploymentId, healthChecker, healthCheckUrl);
            const { rows } = await client.query("SELECT * FROM deployment_registry WHERE deployment_id = $1", [
              outcome.rollbackDeploymentId,
            ]);
            return { status: 202, body: camelizeRow(rows[0]) };
          }

          // No health_check_url recorded for this deployment — fall back to
          // an unchecked rollback (documented gap, unchanged from Phase 2).
          const rollbackId = generateId("depl");
          const { rows } = await client.query(
            `INSERT INTO deployment_registry
               (deployment_id, tenant_id, project_id, release_id, environment, strategy, status, rollback_target, started_at)
             SELECT $1, tenant_id, project_id, release_id, environment, strategy, 'IN_PROGRESS', deployment_id, now()
             FROM deployment_registry WHERE deployment_id = $2
             RETURNING *`,
            [rollbackId, deploymentId],
          );
          await client.query("UPDATE deployment_registry SET status = 'ROLLED_BACK' WHERE deployment_id = $1", [
            deploymentId,
          ]);
          return { status: 202, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);
