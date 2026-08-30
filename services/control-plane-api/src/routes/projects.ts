import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow, camelizeRows } from "../row-mapper.js";

export const projectsRouter = Router();

const MUTABLE_PROJECT_FIELDS = new Set([
  "project_name",
  "constitution_version",
  "lifecycle_state",
  "risk_level",
  "owner_user_id",
  "repository_ref",
  "environment_policy",
]);

projectsRouter.post(
  "/projects",
  ah(async (req, res) => {
    const { project_name, project_type, constitution_version, owner_user_id, repository_ref, environment_policy } =
      req.body ?? {};
    if (!project_name || !project_type) {
      throw ApiError.validation("project_name and project_type are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/projects" },
        async () => {
          const projectId: string = req.body?.project_id ?? generateId("proj");
          const { rows } = await client.query(
            `INSERT INTO project_registry
               (project_id, tenant_id, project_name, project_type, constitution_version, owner_user_id, repository_ref, environment_policy)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              projectId,
              tenantId,
              project_name,
              project_type,
              constitution_version ?? null,
              owner_user_id ?? null,
              repository_ref ?? null,
              environment_policy ? JSON.stringify(environment_policy) : null,
            ],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

projectsRouter.get(
  "/projects",
  ah(async (req, res) => {
    const lifecycleState = typeof req.query["lifecycle_state"] === "string" ? req.query["lifecycle_state"] : undefined;
    const rows = await withRequestTenant(async (client) => {
      const { rows } = lifecycleState
        ? await client.query("SELECT * FROM project_registry WHERE lifecycle_state = $1 ORDER BY created_at DESC", [
            lifecycleState,
          ])
        : await client.query("SELECT * FROM project_registry ORDER BY created_at DESC");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

projectsRouter.get(
  "/projects/:projectId",
  ah(async (req, res) => {
    const row = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM project_registry WHERE project_id = $1", [
        req.params["projectId"],
      ]);
      return rows[0];
    });
    if (!row) throw ApiError.notFound(`Project ${req.params["projectId"]} not found.`);
    res.status(200).json(camelizeRow(row));
  }),
);

projectsRouter.patch(
  "/projects/:projectId",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const updates = req.body ?? {};
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!MUTABLE_PROJECT_FIELDS.has(key)) continue;
      values.push(key === "environment_policy" ? JSON.stringify(value) : value);
      setClauses.push(`${key} = $${values.length}`);
    }
    if (setClauses.length === 0) {
      throw ApiError.validation(
        `No mutable fields provided. Allowed: ${[...MUTABLE_PROJECT_FIELDS].join(", ")}.`,
      );
    }
    setClauses.push("updated_at = now()");

    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "PATCH", path: req.path },
        async () => {
          values.push(req.params["projectId"]);
          const { rows } = await client.query(
            `UPDATE project_registry SET ${setClauses.join(", ")} WHERE project_id = $${values.length} RETURNING *`,
            values,
          );
          if (rows.length === 0) throw ApiError.notFound(`Project ${req.params["projectId"]} not found.`);
          return { status: 200, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);
