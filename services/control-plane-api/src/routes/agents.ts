import { createHash } from "node:crypto";
import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow, camelizeRows } from "../row-mapper.js";

export const agentsRouter = Router();

agentsRouter.post(
  "/agents",
  ah(async (req, res) => {
    const body = req.body ?? {};
    const { agent_name, department, role, purpose, capabilities } = body;
    if (!agent_name || !department || !role || !purpose || !Array.isArray(capabilities)) {
      throw ApiError.validation("agent_name, department, role, purpose and capabilities are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const row = await withRequestTenant(async (client) => {
      const agentId = generateId("agent");
      // Lands in DRAFT, never ACTIVE — production activation is a separate,
      // approval-gated step (POST /agents/{id}/versions/{v}/activate).
      const { rows } = await client.query(
        `INSERT INTO agent_registry
           (agent_id, tenant_id, agent_name, department, role, purpose, capabilities, allowed_tools,
            permissions, data_access, input_schema, output_schema, security_level, lifecycle_state, status, parent_agent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT', 'INACTIVE', $14)
         RETURNING *`,
        [
          agentId,
          tenantId,
          agent_name,
          department,
          role,
          purpose,
          JSON.stringify(capabilities),
          JSON.stringify(body.allowed_tools ?? []),
          JSON.stringify(body.permissions ?? []),
          JSON.stringify(body.data_access ?? []),
          body.input_schema ? JSON.stringify(body.input_schema) : null,
          body.output_schema ? JSON.stringify(body.output_schema) : null,
          body.security_level ?? "GREEN",
          body.parent_agent_id ?? null,
        ],
      );
      return rows[0];
    });

    res.status(202).json(camelizeRow(row));
  }),
);

agentsRouter.get(
  "/agents",
  ah(async (req, res) => {
    const lifecycleState = typeof req.query["lifecycle_state"] === "string" ? req.query["lifecycle_state"] : undefined;
    const department = typeof req.query["department"] === "string" ? req.query["department"] : undefined;

    const rows = await withRequestTenant(async (client) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (lifecycleState) {
        values.push(lifecycleState);
        conditions.push(`lifecycle_state = $${values.length}`);
      }
      if (department) {
        values.push(department);
        conditions.push(`department = $${values.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await client.query(
        `SELECT * FROM agent_registry ${where} ORDER BY created_at DESC`,
        values,
      );
      return rows;
    });

    res.status(200).json(camelizeRows(rows));
  }),
);

agentsRouter.get(
  "/agents/:agentId",
  ah(async (req, res) => {
    const row = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM agent_registry WHERE agent_id = $1", [
        req.params["agentId"],
      ]);
      return rows[0];
    });
    if (!row) throw ApiError.notFound(`Agent ${req.params["agentId"]} not found.`);
    res.status(200).json(camelizeRow(row));
  }),
);

agentsRouter.get(
  "/agents/:agentId/messages",
  ah(async (req, res) => {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const rows = await withRequestTenant(async (client) => {
      const values: unknown[] = [req.params["agentId"]];
      let query =
        "SELECT * FROM agent_messages WHERE (sender_agent_id = $1 OR receiver_agent_id = $1)";
      if (status) {
        values.push(status);
        query += ` AND status = $${values.length}`;
      }
      query += " ORDER BY created_at DESC";
      const { rows } = await client.query(query, values);
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

agentsRouter.post(
  "/agents/:agentId/messages",
  ah(async (req, res) => {
    const { receiver_agent_id, message_type, input_payload } = req.body ?? {};
    if (!receiver_agent_id || !message_type) {
      throw ApiError.validation("receiver_agent_id and message_type are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: req.path },
        async () => {
          const existing = await client.query(
            "SELECT message_id FROM agent_messages WHERE tenant_id = $1 AND idempotency_key = $2",
            [tenantId, req.idempotencyKey],
          );
          if (existing.rows.length > 0) {
            return { status: 202, body: { messageId: existing.rows[0].message_id, replayed: true } };
          }

          const messageId = generateId("msg");
          await client.query(
            `INSERT INTO agent_messages
               (message_id, tenant_id, sender_agent_id, receiver_agent_id, message_type, input_payload, status, idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7)`,
            [
              messageId,
              tenantId,
              req.params["agentId"],
              receiver_agent_id,
              message_type,
              input_payload ? JSON.stringify(input_payload) : null,
              req.idempotencyKey,
            ],
          );
          return { status: 202, body: { messageId, replayed: false } };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

agentsRouter.post(
  "/agents/:agentId/versions",
  ah(async (req, res) => {
    const body = req.body ?? {};
    const tenantId = getCurrentTenantId()!;

    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: req.path },
        async () => {
          const agent = await client.query("SELECT agent_id FROM agent_registry WHERE agent_id = $1", [
            req.params["agentId"],
          ]);
          if (agent.rows.length === 0) throw ApiError.notFound(`Agent ${req.params["agentId"]} not found.`);

          const version: string = body.version ?? "1.0.0";
          // No hash supplied by the caller: derive one from the version payload itself so
          // it's still a real content fingerprint, not a placeholder constant.
          const specificationHash: string =
            body.specification_hash ?? createHash("sha256").update(JSON.stringify(body)).digest("hex");

          const { rows } = await client.query(
            `INSERT INTO agent_versions
               (tenant_id, agent_id, version, specification_hash, prompt_version, model_policy, permissions_snapshot, lifecycle_state)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              tenantId,
              req.params["agentId"],
              version,
              specificationHash,
              body.prompt_version ?? null,
              body.model_policy ? JSON.stringify(body.model_policy) : null,
              body.permissions_snapshot ? JSON.stringify(body.permissions_snapshot) : null,
              body.lifecycle_state ?? "DRAFT",
            ],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

agentsRouter.get(
  "/agents/:agentId/versions",
  ah(async (req, res) => {
    const rows = await withRequestTenant(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM agent_versions WHERE agent_id = $1 ORDER BY created_at DESC",
        [req.params["agentId"]],
      );
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

agentsRouter.post(
  "/agents/:agentId/versions/:agentVersionId/activate",
  ah(async (req, res) => {
    const { agentId, agentVersionId } = req.params;
    const tenantId = getCurrentTenantId()!;

    await withRequestTenant(async (client) => {
      const version = await client.query(
        "SELECT agent_version_id FROM agent_versions WHERE agent_version_id = $1 AND agent_id = $2",
        [agentVersionId, agentId],
      );
      if (version.rows.length === 0) {
        throw ApiError.notFound(`Version ${agentVersionId} of agent ${agentId} not found.`);
      }

      // Blueprint clause 45/60: activation requires a prior APPROVED
      // AGENT_ACTIVATE approval request for this agent.
      const approval = await client.query(
        `SELECT request_id FROM approval_requests
         WHERE tenant_id = $1 AND agent_id = $2 AND action = 'AGENT_ACTIVATE' AND decision = 'APPROVED'
         ORDER BY decided_at DESC LIMIT 1`,
        [tenantId, agentId],
      );
      if (approval.rows.length === 0) {
        throw ApiError.policyDenied(
          `No APPROVED AGENT_ACTIVATE approval request found for agent ${agentId}. Create one via POST /approvals first.`,
        );
      }

      await client.query("UPDATE agent_versions SET lifecycle_state = 'ACTIVE' WHERE agent_version_id = $1", [
        agentVersionId,
      ]);
      await client.query(
        "UPDATE agent_registry SET active_agent_version_id = $1, lifecycle_state = 'ACTIVE', status = 'ACTIVE', updated_at = now() WHERE agent_id = $2",
        [agentVersionId, agentId],
      );
    });

    res.status(200).json({ agentId, activeAgentVersionId: agentVersionId, lifecycleState: "ACTIVE" });
  }),
);
