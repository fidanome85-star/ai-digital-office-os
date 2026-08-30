import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant, type PoolClient } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow } from "../row-mapper.js";

export const deploymentsRouter = Router();

deploymentsRouter.post(
  "/deployments",
  ah(async (req, res) => {
    const { project_id, release_id, environment, strategy } = req.body ?? {};
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
               (deployment_id, tenant_id, project_id, release_id, environment, strategy, status, approval_request_id, started_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, now())
             RETURNING *`,
            [deploymentId, tenantId, project_id, release_id, environment, strategy, req.body.approval_request_id ?? null],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
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

          const rollbackId = generateId("depl");
          const { rows } = await client.query(
            `INSERT INTO deployment_registry
               (deployment_id, tenant_id, project_id, release_id, environment, strategy, status, rollback_target, started_at)
             SELECT $1, tenant_id, project_id, release_id, environment, strategy, 'IN_PROGRESS', deployment_id, now()
             FROM deployment_registry WHERE deployment_id = $2
             RETURNING *`,
            [rollbackId, deployment["rollback_target"]],
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
