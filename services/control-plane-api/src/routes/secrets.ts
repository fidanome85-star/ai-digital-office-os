import { Router } from "express";
import { getCurrentTenantId, requireCurrentPrincipal } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";

export const secretsRouter = Router();

secretsRouter.post(
  "/secrets/:referenceId/rotate",
  ah(async (req, res) => {
    const tenantId = getCurrentTenantId()!;
    const principal = requireCurrentPrincipal();

    const result = await withRequestTenant((client) =>
      withIdempotentWrite<{ referenceId: string; rotationTriggeredAt: string }>(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: req.path },
        async () => {
          const secret = await client.query(
            "SELECT reference_id FROM secrets_vault_references WHERE reference_id = $1",
            [req.params["referenceId"]],
          );
          if (secret.rows.length === 0) {
            throw ApiError.notFound(`Secret reference ${req.params["referenceId"]} not found.`);
          }

          // Never touches (or even sees) the raw secret value — only the
          // vault pointer's rotation bookkeeping. The actual key-material
          // rotation happens in the external KMS/Vault this row points to.
          await client.query(
            "UPDATE secrets_vault_references SET last_rotated_at = now() WHERE reference_id = $1",
            [req.params["referenceId"]],
          );
          await client.query(
            `INSERT INTO audit_events (tenant_id, event_type, actor_type, actor_id, payload)
             VALUES ($1, 'SECRET_ROTATION_TRIGGERED', $2, $3, $4)`,
            [
              tenantId,
              principal.principalType.toUpperCase(),
              principal.principalType === "human" ? principal.userId : principal.serviceId,
              JSON.stringify({ reference_id: req.params["referenceId"] }),
            ],
          );

          return {
            status: 202,
            body: { referenceId: req.params["referenceId"]!, rotationTriggeredAt: new Date().toISOString() },
          };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);
