import { Router } from "express";
import { getCurrentTenantId, requireCurrentPrincipal } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { camelizeRow, camelizeRows } from "../row-mapper.js";

export const featureFlagsRouter = Router();

featureFlagsRouter.get(
  "/feature-flags",
  ah(async (_req, res) => {
    // RLS's own USING clause already returns this tenant's overrides
    // together with the global (tenant_id IS NULL) defaults.
    const rows = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM feature_flags ORDER BY flag_key");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

featureFlagsRouter.post(
  "/feature-flags",
  ah(async (req, res) => {
    const { flag_key, default_value } = req.body ?? {};
    if (!flag_key || default_value === undefined) {
      throw ApiError.validation("flag_key and default_value are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const environment: string = req.body.environment ?? "production";
    const principal = requireCurrentPrincipal();

    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/feature-flags" },
        async () => {
          const { rows } = await client.query(
            `INSERT INTO feature_flags (tenant_id, flag_key, flag_type, default_value, tenant_override_value, environment, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (tenant_id, flag_key, environment)
             DO UPDATE SET tenant_override_value = EXCLUDED.tenant_override_value, updated_at = now()
             RETURNING *`,
            [
              tenantId,
              flag_key,
              req.body.flag_type ?? "BOOLEAN",
              JSON.stringify(default_value),
              req.body.tenant_override_value !== undefined ? JSON.stringify(req.body.tenant_override_value) : null,
              environment,
              principal.principalType === "human" ? principal.userId : principal.serviceId,
            ],
          );
          return { status: 201, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);
