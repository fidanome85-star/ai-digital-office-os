import { Router } from "express";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { camelizeRows } from "../row-mapper.js";

export const mcpRouter = Router();

mcpRouter.get(
  "/mcp/servers",
  ah(async (_req, res) => {
    // RLS returns this tenant's own servers plus platform-wide (tenant_id
    // IS NULL) ones automatically.
    const rows = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM mcp_server_registry ORDER BY server_name");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);
