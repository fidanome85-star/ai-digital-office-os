import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { runBenchmarkSuite } from "@ai-office/model-router-gateway";
import { ah } from "../async-handler.js";
import { pool, withRequestTenant } from "../db.js";
import { withIdempotentWrite } from "../idempotency.js";
import { ApiError } from "../errors.js";
import { camelizeRow, camelizeRows } from "../row-mapper.js";

export const modelsRouter = Router();

interface CandidateModelRow {
  model_id: string;
  provider_id: string;
}

/**
 * Rule-based capability routing: walks the agent's preferred model then its
 * fallback_models in order, picking the first ACTIVE model whose
 * capabilities include required_capability. This is intentionally simple —
 * the full model-router-gateway service (build-order step 6) will replace
 * it with cost/latency-aware routing; this closes the API contract now
 * with a real, working (if unsophisticated) implementation.
 */
modelsRouter.post(
  "/models/route",
  ah(async (req, res) => {
    const { task_id, agent_id, required_capability } = req.body ?? {};
    if (!task_id || !agent_id || !required_capability) {
      throw ApiError.validation("task_id, agent_id and required_capability are required.");
    }

    const tenantId = getCurrentTenantId()!;
    const decision = await withRequestTenant(async (client) => {
      const agentRes = await client.query(
        "SELECT preferred_model, fallback_models FROM agent_registry WHERE agent_id = $1",
        [agent_id],
      );
      if (agentRes.rows.length === 0) throw ApiError.notFound(`Agent ${agent_id} not found.`);
      const agent = agentRes.rows[0];

      const candidateModelIds: string[] = [
        ...(agent.preferred_model ? [agent.preferred_model] : []),
        ...(Array.isArray(agent.fallback_models) ? agent.fallback_models : []),
      ];

      let selected: CandidateModelRow | undefined;
      for (const modelId of candidateModelIds) {
        const { rows } = await client.query<CandidateModelRow>(
          `SELECT model_id, provider_id FROM model_registry
           WHERE model_id = $1 AND availability = 'ACTIVE' AND capabilities @> $2::jsonb`,
          [modelId, JSON.stringify([required_capability])],
        );
        if (rows.length > 0) {
          selected = rows[0];
          break;
        }
      }

      const policyResult = selected ? "ALLOW" : "DENY";
      const reason = selected
        ? `Selected ${selected.model_id} (capability '${required_capability}' matched).`
        : `No ACTIVE model among [${candidateModelIds.join(", ") || "none configured"}] supports capability '${required_capability}'.`;

      const { rows: recordRows } = await client.query(
        `INSERT INTO routing_decision_records
           (tenant_id, task_id, agent_id, selected_provider, selected_model, candidate_models, reason, policy_result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          task_id,
          agent_id,
          selected?.provider_id ?? null,
          selected?.model_id ?? null,
          JSON.stringify(candidateModelIds),
          reason,
          policyResult,
        ],
      );

      return { record: recordRows[0], selected, policyResult, reason };
    });

    if (decision.policyResult === "DENY") {
      throw ApiError.policyDenied(decision.reason);
    }

    res.status(200).json({
      taskId: task_id,
      agentId: agent_id,
      selectedProvider: decision.selected!.provider_id,
      selectedModel: decision.selected!.model_id,
      reason: decision.reason,
      policyResult: decision.policyResult,
      fallbackChainUsed: [],
      decidedAt: decision.record.created_at,
    });
  }),
);

modelsRouter.get(
  "/models",
  ah(async (req, res) => {
    const capability = typeof req.query["capability"] === "string" ? req.query["capability"] : undefined;
    const rows = await withRequestTenant(async (client) => {
      const { rows } = capability
        ? await client.query("SELECT * FROM model_registry WHERE capabilities @> $1::jsonb ORDER BY model_name", [
            JSON.stringify([capability]),
          ])
        : await client.query("SELECT * FROM model_registry ORDER BY model_name");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);

/**
 * Runs @ai-office/model-router-gateway's real runBenchmarkSuite (a fixed
 * set of real prompts through the real executeModelRun path — real
 * retries, real model_runs/usage_events rows) instead of the old
 * placeholder that just carried model_registry.evaluation_score forward.
 * The score this persists is execution reliability (did the real calls
 * succeed), not answer correctness — see docs/decisions/0011 for why that
 * distinction matters and why this doesn't try to grade correctness.
 * Per-metric rows (success_rate, avg_latency_ms, avg_output_tokens) go to
 * model_evaluation_metrics, the table that existed for exactly this and
 * was unused until now.
 */
modelsRouter.post(
  "/models/evaluate",
  ah(async (req, res) => {
    const { model_id, benchmark_suite, evaluator_version, prompts } = req.body ?? {};
    if (!model_id || !benchmark_suite) throw ApiError.validation("model_id and benchmark_suite are required.");

    const tenantId = getCurrentTenantId()!;
    const result = await withRequestTenant((client) =>
      withIdempotentWrite(
        client,
        { tenantId, idempotencyKey: req.idempotencyKey!, method: "POST", path: "/models/evaluate" },
        async () => {
          const model = await client.query("SELECT model_id, provider_id FROM model_registry WHERE model_id = $1", [
            model_id,
          ]);
          if (model.rows.length === 0) throw ApiError.notFound(`Model ${model_id} not found.`);
          const providerId = model.rows[0].provider_id;

          const suiteResult = await runBenchmarkSuite(pool, {
            tenantId,
            providerId,
            modelId: model_id,
            ...(Array.isArray(prompts) ? { prompts } : {}),
          });

          const { rows } = await client.query(
            `INSERT INTO model_evaluation_runs (provider_id, model_id, benchmark_suite, evaluator_version, score, results)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
              providerId,
              model_id,
              benchmark_suite,
              evaluator_version ?? null,
              suiteResult.score,
              JSON.stringify({
                note: "score measures execution reliability (fraction of real prompts that completed without error), not answer correctness — see docs/decisions/0011",
                cases: suiteResult.cases,
              }),
            ],
          );
          const evaluationId = rows[0].evaluation_id;

          const metrics: [string, number, string][] = [
            ["success_rate", suiteResult.successRate, "ratio"],
            ["avg_latency_ms", suiteResult.averageLatencyMs, "ms"],
            ["avg_output_tokens", suiteResult.averageOutputTokens, "tokens"],
          ];
          for (const [metricName, metricValue, unit] of metrics) {
            await client.query(
              "INSERT INTO model_evaluation_metrics (evaluation_id, metric_name, metric_value, unit) VALUES ($1, $2, $3, $4)",
              [evaluationId, metricName, metricValue, unit],
            );
          }

          return { status: 202, body: camelizeRow(rows[0]) };
        },
      ),
    );
    res.status(result.status).json(result.body);
  }),
);

modelsRouter.get(
  "/models/evaluations",
  ah(async (req, res) => {
    const modelId = typeof req.query["model_id"] === "string" ? req.query["model_id"] : undefined;
    const rows = await withRequestTenant(async (client) => {
      const { rows } = modelId
        ? await client.query("SELECT * FROM model_evaluation_runs WHERE model_id = $1 ORDER BY executed_at DESC", [
            modelId,
          ])
        : await client.query("SELECT * FROM model_evaluation_runs ORDER BY executed_at DESC");
      return rows;
    });
    res.status(200).json(camelizeRows(rows));
  }),
);
