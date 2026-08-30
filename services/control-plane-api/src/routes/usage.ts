import { Router } from "express";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { camelizeRows } from "../row-mapper.js";

export const usageRouter = Router();

usageRouter.get(
  "/usage",
  ah(async (req, res) => {
    const { project_id, agent_id, from, to } = req.query as Record<string, string | undefined>;

    const rows = await withRequestTenant(async (client) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (project_id) {
        values.push(project_id);
        conditions.push(`project_id = $${values.length}`);
      }
      if (agent_id) {
        values.push(agent_id);
        conditions.push(`agent_id = $${values.length}`);
      }
      if (from) {
        values.push(from);
        conditions.push(`event_time >= $${values.length}`);
      }
      if (to) {
        values.push(to);
        conditions.push(`event_time <= $${values.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await client.query(
        `SELECT * FROM usage_events ${where} ORDER BY event_time DESC LIMIT 500`,
        values,
      );
      return rows;
    });

    res.status(200).json(camelizeRows(rows));
  }),
);
