import { Router } from "express";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { camelizeRows } from "../row-mapper.js";

export const providersRouter = Router();

// provider_registry has no tenant_id column — it is a genuine platform-wide
// catalog (confirmed in Phase 1's RLS audit), so no tenant filtering here.

providersRouter.get(
  "/providers",
  ah(async (_req, res) => {
    const rows = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM provider_registry ORDER BY provider_name");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

providersRouter.get(
  "/providers/health",
  ah(async (_req, res) => {
    const rows = await withRequestTenant(async (client) => {
      const { rows } = await client.query(
        "SELECT provider_id, provider_name, health_status, availability, updated_at FROM provider_registry ORDER BY provider_name",
      );
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);
