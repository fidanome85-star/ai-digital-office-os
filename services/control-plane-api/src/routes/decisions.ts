import { Router } from "express";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { camelizeRows } from "../row-mapper.js";

export const decisionsRouter = Router();

decisionsRouter.get(
  "/policy-decisions",
  ah(async (req, res) => {
    const { task_id, agent_id } = req.query as Record<string, string | undefined>;
    const rows = await withRequestTenant(async (client) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (task_id) {
        values.push(task_id);
        conditions.push(`task_id = $${values.length}`);
      }
      if (agent_id) {
        values.push(agent_id);
        conditions.push(`agent_id = $${values.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await client.query(
        `SELECT * FROM policy_decision_records ${where} ORDER BY created_at DESC LIMIT 500`,
        values,
      );
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

decisionsRouter.get(
  "/routing-decisions",
  ah(async (req, res) => {
    const taskId = typeof req.query["task_id"] === "string" ? req.query["task_id"] : undefined;
    const rows = await withRequestTenant(async (client) => {
      const { rows } = taskId
        ? await client.query(
            "SELECT * FROM routing_decision_records WHERE task_id = $1 ORDER BY created_at DESC LIMIT 500",
            [taskId],
          )
        : await client.query("SELECT * FROM routing_decision_records ORDER BY created_at DESC LIMIT 500");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);
