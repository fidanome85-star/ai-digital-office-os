import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant, type PoolClient } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { camelizeRow, camelizeRows } from "../row-mapper.js";

export const artifactsRouter = Router();

artifactsRouter.get(
  "/artifacts",
  ah(async (req, res) => {
    const projectId = req.query["project_id"];
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw ApiError.validation("project_id query parameter is required.");
    }
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;

    const rows = await withRequestTenant(async (client) => {
      const { rows } = status
        ? await client.query(
            "SELECT * FROM artifact_registry WHERE project_id = $1 AND status = $2 ORDER BY created_at DESC",
            [projectId, status],
          )
        : await client.query("SELECT * FROM artifact_registry WHERE project_id = $1 ORDER BY created_at DESC", [
            projectId,
          ]);
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

artifactsRouter.post(
  "/artifacts",
  ah(async (req, res) => {
    const { project_id, artifact_type, storage_uri, content_hash } = req.body ?? {};
    if (!project_id || !artifact_type || !storage_uri || !content_hash) {
      throw ApiError.validation("project_id, artifact_type, storage_uri and content_hash are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/artifacts" },
        async () => {
          const { rows } = await client.query(
            `INSERT INTO artifact_registry
               (tenant_id, project_id, task_id, agent_run_id, model_run_id, artifact_type, storage_uri, content_hash, version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              tenantId,
              project_id,
              req.body.task_id ?? null,
              req.body.agent_run_id ?? null,
              req.body.model_run_id ?? null,
              artifact_type,
              storage_uri,
              content_hash,
              req.body.version ?? "1.0.0",
            ],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

async function requireArtifact(client: PoolClient, artifactId: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query("SELECT * FROM artifact_registry WHERE artifact_id = $1", [artifactId]);
  if (rows.length === 0) throw ApiError.notFound(`Artifact ${artifactId} not found.`);
  return rows[0];
}

artifactsRouter.get(
  "/artifacts/:artifactId",
  ah(async (req, res) => {
    const row = await withRequestTenant((client) => requireArtifact(client, req.params["artifactId"]!));
    res.status(200).json(camelizeRow(row));
  }),
);

artifactsRouter.get(
  "/artifacts/:artifactId/lineage",
  ah(async (req, res) => {
    const lineage = await withRequestTenant(async (client) => {
      const artifact = await requireArtifact(client, req.params["artifactId"]!);

      const [agentRun, modelRun, task, workflow, parentChain] = await Promise.all([
        artifact["agent_run_id"]
          ? client.query("SELECT * FROM agent_runs WHERE agent_run_id = $1", [artifact["agent_run_id"]])
          : Promise.resolve({ rows: [] }),
        artifact["model_run_id"]
          ? client.query("SELECT * FROM model_runs WHERE model_run_id = $1", [artifact["model_run_id"]])
          : Promise.resolve({ rows: [] }),
        artifact["task_id"]
          ? client.query("SELECT * FROM task_registry WHERE task_id = $1", [artifact["task_id"]])
          : Promise.resolve({ rows: [] }),
        artifact["task_id"]
          ? client.query(
              `SELECT w.* FROM workflow_registry w
               JOIN task_registry t ON t.workflow_id = w.workflow_id
               WHERE t.task_id = $1`,
              [artifact["task_id"]],
            )
          : Promise.resolve({ rows: [] }),
        artifact["parent_artifact_id"]
          ? client.query(
              `WITH RECURSIVE chain AS (
                 SELECT * FROM artifact_registry WHERE artifact_id = $1
                 UNION ALL
                 SELECT a.* FROM artifact_registry a JOIN chain c ON a.artifact_id = c.parent_artifact_id
               )
               SELECT * FROM chain WHERE artifact_id != $2`,
              [artifact["parent_artifact_id"], artifact["artifact_id"]],
            )
          : Promise.resolve({ rows: [] }),
      ]);

      return {
        artifact: camelizeRow(artifact),
        agentRun: agentRun.rows[0] ? camelizeRow(agentRun.rows[0]) : null,
        modelRun: modelRun.rows[0] ? camelizeRow(modelRun.rows[0]) : null,
        task: task.rows[0] ? camelizeRow(task.rows[0]) : null,
        workflow: workflow.rows[0] ? camelizeRow(workflow.rows[0]) : null,
        parentChain: camelizeRows(parentChain.rows),
      };
    });
    res.status(200).json(lineage);
  }),
);
