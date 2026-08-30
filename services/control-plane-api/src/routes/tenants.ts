import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { ApiError } from "../errors.js";
import { camelizeRow } from "../row-mapper.js";

export const tenantsRouter = Router();

tenantsRouter.get(
  "/tenants/current",
  ah(async (_req, res) => {
    const tenantId = getCurrentTenantId();
    const tenant = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM organizations WHERE tenant_id = $1", [tenantId]);
      return rows[0];
    });
    if (!tenant) throw ApiError.notFound("Tenant record not found for the calling token's tenant_id.");
    res.status(200).json(camelizeRow(tenant));
  }),
);
