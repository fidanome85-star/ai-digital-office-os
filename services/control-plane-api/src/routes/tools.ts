import { Router } from "express";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { camelizeRows } from "../row-mapper.js";

export const toolsRouter = Router();

// tool_registry has no tenant_id (platform catalog); agent_tool_bindings is
// the tenant-scoped, policy-checkable binding surface (clause 67), but this
// endpoint lists the catalog of tools a tenant *could* be bound to.
toolsRouter.get(
  "/tools",
  ah(async (_req, res) => {
    const rows = await withRequestTenant(async (client) => {
      const { rows } = await client.query("SELECT * FROM tool_registry WHERE enabled = true ORDER BY tool_name");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);
