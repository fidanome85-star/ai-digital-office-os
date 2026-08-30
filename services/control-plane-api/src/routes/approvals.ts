import { Router } from "express";
import { getCurrentTenantId, requireCurrentPrincipal } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { generateId } from "../ids.js";
import { camelizeRow, camelizeRows } from "../row-mapper.js";

export const approvalsRouter = Router();

function principalIdentifier(): string {
  const principal = requireCurrentPrincipal();
  return principal.principalType === "human" ? principal.userId : principal.serviceId;
}

approvalsRouter.post(
  "/approvals",
  ah(async (req, res) => {
    const { action, risk_level, task_id, agent_id, reason } = req.body ?? {};
    if (!action || !risk_level) throw ApiError.validation("action and risk_level are required.");

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/approvals" },
        async () => {
          const requestId = generateId("appr");
          const { rows } = await client.query(
            `INSERT INTO approval_requests
               (request_id, tenant_id, task_id, requester, agent_id, action, risk_level, reason, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '7 days')
             RETURNING *`,
            [requestId, tenantId, task_id ?? null, principalIdentifier(), agent_id ?? null, action, risk_level, reason ?? null],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

approvalsRouter.get(
  "/approvals",
  ah(async (req, res) => {
    const riskLevel = typeof req.query["risk_level"] === "string" ? req.query["risk_level"] : undefined;
    const rows = await withRequestTenant(async (client) => {
      const { rows } = riskLevel
        ? await client.query(
            "SELECT * FROM approval_requests WHERE decision IS NULL AND risk_level = $1 ORDER BY created_at DESC",
            [riskLevel],
          )
        : await client.query("SELECT * FROM approval_requests WHERE decision IS NULL ORDER BY created_at DESC");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

approvalsRouter.post(
  "/approvals/:requestId/decision",
  ah(async (req, res) => {
    const { decision, reason } = req.body ?? {};
    if (decision !== "APPROVED" && decision !== "DENIED") {
      throw ApiError.validation("decision must be APPROVED or DENIED.");
    }

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: req.path },
        async () => {
          const { rows } = await client.query(
            `UPDATE approval_requests
             SET decision = $1, approver = $2, reason = COALESCE($3, reason), decided_at = now()
             WHERE request_id = $4 AND decision IS NULL
             RETURNING *`,
            [decision, principalIdentifier(), reason ?? null, req.params["requestId"]],
          );
          if (rows.length === 0) {
            throw ApiError.notFound(
              `Approval request ${req.params["requestId"]} not found or already decided.`,
            );
          }
          return { status: 200, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);
