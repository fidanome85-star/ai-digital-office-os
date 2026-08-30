import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow } from "../row-mapper.js";

export const tasksRouter = Router();

tasksRouter.post(
  "/tasks",
  ah(async (req, res) => {
    const body = req.body ?? {};
    const { project_id, required_capability, input, idempotency_key } = body;
    if (!project_id || !required_capability || input === undefined || !idempotency_key) {
      throw ApiError.validation("project_id, required_capability, input and idempotency_key are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const row = await withRequestTenant(async (client) => {
      // task_registry has its own dedicated UNIQUE(tenant_id, idempotency_key) — a retried
      // create returns the original row instead of the generic api_idempotency_keys path.
      const existing = await client.query("SELECT * FROM task_registry WHERE tenant_id = $1 AND idempotency_key = $2", [
        tenantId,
        idempotency_key,
      ]);
      if (existing.rows.length > 0) return existing.rows[0];

      const taskId = generateId("task");
      const { rows } = await client.query(
        `INSERT INTO task_registry
           (task_id, tenant_id, project_id, workflow_id, parent_task_id, required_capability, priority,
            risk_level, security_level, dependencies, input, expected_output, idempotency_key, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          taskId,
          tenantId,
          project_id,
          body.workflow_id ?? null,
          body.parent_task_id ?? null,
          required_capability,
          body.priority ?? "NORMAL",
          body.risk_level ?? "GREEN",
          body.security_level ?? null,
          JSON.stringify(body.dependencies ?? []),
          JSON.stringify(input),
          body.expected_output ? JSON.stringify(body.expected_output) : null,
          idempotency_key,
          body.deadline ?? null,
        ],
      );
      return rows[0];
    });

    res.status(201).json(camelizeRow(row));
  }),
);

tasksRouter.get(
  "/tasks/:taskId",
  ah(async (req, res) => {
    const row = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM task_registry WHERE task_id = $1", [req.params["taskId"]]);
      return rows[0];
    });
    if (!row) throw ApiError.notFound(`Task ${req.params["taskId"]} not found.`);
    res.status(200).json(camelizeRow(row));
  }),
);
