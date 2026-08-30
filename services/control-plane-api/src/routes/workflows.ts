import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant, type PoolClient } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow } from "../row-mapper.js";

export const workflowsRouter = Router();

async function appendHistory(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { rows } = await client.query(
    "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM workflow_history WHERE workflow_id = $1",
    [workflowId],
  );
  await client.query(
    "INSERT INTO workflow_history (tenant_id, workflow_id, sequence_no, event_type, payload) VALUES ($1, $2, $3, $4, $5)",
    [tenantId, workflowId, rows[0].next, eventType, JSON.stringify(payload)],
  );
}

async function requireWorkflow(client: PoolClient, workflowId: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query("SELECT * FROM workflow_registry WHERE workflow_id = $1", [workflowId]);
  if (rows.length === 0) throw ApiError.notFound(`Workflow ${workflowId} not found.`);
  return rows[0];
}

async function transition(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  fromStatuses: string[],
  toStatus: string,
  eventType: string,
): Promise<Record<string, unknown>> {
  const workflow = await requireWorkflow(client, workflowId);
  if (!fromStatuses.includes(workflow["status"] as string)) {
    throw ApiError.conflict(
      `Workflow ${workflowId} is ${workflow["status"] as string}; expected one of [${fromStatuses.join(", ")}] for this transition.`,
    );
  }
  const completed = toStatus === "COMPLETED" || toStatus === "CANCELLED" ? ", completed_at = now()" : "";
  const { rows } = await client.query(
    `UPDATE workflow_registry SET status = $1, updated_at = now()${completed} WHERE workflow_id = $2 RETURNING *`,
    [toStatus, workflowId],
  );
  await appendHistory(client, tenantId, workflowId, eventType, { from: workflow["status"], to: toStatus });
  return rows[0];
}

workflowsRouter.post(
  "/workflows",
  ah(async (req, res) => {
    const { project_id, workflow_type, definition_version } = req.body ?? {};
    if (!project_id || !workflow_type || !definition_version) {
      throw ApiError.validation("project_id, workflow_type and definition_version are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/workflows" },
        async () => {
          const project = await client.query("SELECT 1 FROM project_registry WHERE project_id = $1", [project_id]);
          if (project.rows.length === 0) throw ApiError.validation(`project_id ${project_id} does not exist.`);

          const workflowId = generateId("wf");
          const { rows } = await client.query(
            `INSERT INTO workflow_registry (workflow_id, tenant_id, project_id, workflow_type, definition_version)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [workflowId, tenantId, project_id, workflow_type, definition_version],
          );
          await appendHistory(client, tenantId, workflowId, "STARTED", { workflow_type, definition_version });
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

workflowsRouter.get(
  "/workflows/:workflowId",
  ah(async (req, res) => {
    const row = await withRequestTenant((client) => requireWorkflow(client, req.params["workflowId"]!));
    res.status(200).json(camelizeRow(row));
  }),
);

workflowsRouter.post(
  "/workflows/:workflowId/pause",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const row = await withRequestTenant((client) =>
      transition(client, tenantId, req.params["workflowId"]!, ["RUNNING"], "PAUSED", "PAUSED"),
    );
    res.status(200).json(camelizeRow(row));
  }),
);

workflowsRouter.post(
  "/workflows/:workflowId/resume",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const row = await withRequestTenant((client) =>
      transition(client, tenantId, req.params["workflowId"]!, ["PAUSED"], "RUNNING", "RESUMED"),
    );
    res.status(200).json(camelizeRow(row));
  }),
);

workflowsRouter.post(
  "/workflows/:workflowId/cancel",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const row = await withRequestTenant((client) =>
      transition(
        client,
        tenantId,
        req.params["workflowId"]!,
        ["RUNNING", "PAUSED", "FAILED", "ESCALATED"],
        "CANCELLED",
        "ROLLED_BACK",
      ),
    );
    res.status(200).json(camelizeRow(row));
  }),
);

workflowsRouter.post(
  "/workflows/:workflowId/retry",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const row = await withRequestTenant((client) =>
      transition(client, tenantId, req.params["workflowId"]!, ["FAILED"], "RUNNING", "RETRY"),
    );
    res.status(200).json(camelizeRow(row));
  }),
);

workflowsRouter.post(
  "/workflows/:workflowId/escalate",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const workflowId = req.params["workflowId"]!;

    const approval = await withRequestTenant(async (client) => {
      await requireWorkflow(client, workflowId);
      const updated = await transition(client, tenantId, workflowId, ["RUNNING", "PAUSED", "FAILED"], "ESCALATED", "ESCALATED");

      const requestId = generateId("appr");
      const { rows } = await client.query(
        `INSERT INTO approval_requests (request_id, tenant_id, action, risk_level, reason)
         VALUES ($1, $2, 'WORKFLOW_ESCALATE', 'RED', $3)
         RETURNING *`,
        [requestId, tenantId, `Workflow ${workflowId} escalated from status ${updated["status"] as string}.`],
      );
      return rows[0];
    });

    res.status(200).json(camelizeRow(approval));
  }),
);
