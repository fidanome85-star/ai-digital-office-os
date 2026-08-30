import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { withSpan } from "@ai-office/observability";
import { createAdapter } from "./adapters/index.js";
import { ModelRouterError } from "./errors.js";
import { generateId } from "./ids.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";
import { EnvSecretResolver, type SecretResolver } from "./secrets.js";
import type { CompletionRequest, CompletionResult } from "./types.js";

export interface ExecuteModelRunInput {
  tenantId: string;
  taskId?: string;
  agentId?: string;
  providerId: string;
  modelId: string;
  request: CompletionRequest;
}

export interface ExecuteModelRunOptions {
  secretResolver?: SecretResolver;
  /** Test-only: overrides the resolved adapter's HTTP base URL to point at a local mock server. */
  adapterBaseUrl?: string;
}

export interface ExecuteModelRunResult {
  modelRunId: string;
  completion: CompletionResult;
  estimatedCost: number;
}

interface ProviderRow {
  provider_id: string;
  adapter_type: string;
}

interface ModelRow {
  model_id: string;
  cost_profile: unknown;
}

function isRetryableError(err: unknown): boolean {
  return err instanceof ModelRouterError && err.retryable;
}

/**
 * cost_profile has no fixed shape documented in the schema (JSONB,
 * blueprint-agnostic on purpose). This assumes
 * `{ input_per_1k: number, output_per_1k: number }` in USD and defaults to
 * 0 for anything else — an explicit, documented assumption rather than a
 * silent one, and safe (never overcounts cost when the shape is
 * unexpected).
 */
function estimateCost(costProfile: unknown, inputTokens: number, outputTokens: number): number {
  const profile = (costProfile ?? {}) as { input_per_1k?: number; output_per_1k?: number };
  const inputRate = typeof profile.input_per_1k === "number" ? profile.input_per_1k : 0;
  const outputRate = typeof profile.output_per_1k === "number" ? profile.output_per_1k : 0;
  return Number(((inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate).toFixed(8));
}

/**
 * Looks up the provider/model, creates a model_runs row, resolves the
 * provider's API key (via secrets_vault_references + SecretResolver — see
 * ADR 0004), calls the adapter with retry/backoff on transient failures,
 * then records the outcome in model_runs and usage_events. Every DB write
 * happens in its own transaction (same pattern as agent-factory, ADR
 * 0003 §4) so a failed call still leaves a FAILED model_runs row on
 * record instead of losing the attempt entirely.
 */
export async function executeModelRun(
  pool: Pool,
  input: ExecuteModelRunInput,
  options: ExecuteModelRunOptions = {},
): Promise<ExecuteModelRunResult> {
  const secretResolver = options.secretResolver ?? new EnvSecretResolver();

  return withSpan(logger, `executeModelRun(${input.modelId})`, async () => {
    const { providerRow, modelRow, modelRunId } = await withTenantTransaction(pool, input.tenantId, async (client) => {
      const providerRes = await client.query<ProviderRow>("SELECT * FROM provider_registry WHERE provider_id = $1", [
        input.providerId,
      ]);
      const providerRow = providerRes.rows[0];
      if (!providerRow) throw new ModelRouterError("NOT_FOUND", `Provider ${input.providerId} not found.`);

      const modelRes = await client.query<ModelRow>(
        "SELECT * FROM model_registry WHERE model_id = $1 AND provider_id = $2",
        [input.modelId, input.providerId],
      );
      const modelRow = modelRes.rows[0];
      if (!modelRow) {
        throw new ModelRouterError("NOT_FOUND", `Model ${input.modelId} not found for provider ${input.providerId}.`);
      }

      const modelRunId = generateId("mrun");
      await client.query(
        `INSERT INTO model_runs (model_run_id, tenant_id, provider_id, model_id, routing_reason, started_at, status)
         VALUES ($1, $2, $3, $4, $5, now(), 'RUNNING')`,
        [modelRunId, input.tenantId, input.providerId, input.modelId, "executeModelRun"],
      );

      return { providerRow, modelRow, modelRunId };
    });

    let completion: CompletionResult;
    try {
      const secretRes = await withTenantTransaction(pool, input.tenantId, (client) =>
        client.query<{ vault_path: string }>(
          `SELECT vault_path FROM secrets_vault_references
           WHERE tenant_id = $1 AND scope_provider_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [input.tenantId, input.providerId],
        ),
      );
      const vaultPath = secretRes.rows[0]?.vault_path;
      const apiKey = vaultPath ? await secretResolver.resolve(vaultPath) : "";

      const adapter = createAdapter(providerRow.adapter_type, options.adapterBaseUrl);
      completion = await withRetry(() => adapter.complete(input.request, apiKey), isRetryableError, { maxAttempts: 3 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await withTenantTransaction(pool, input.tenantId, (client) =>
        client.query("UPDATE model_runs SET status = 'FAILED', completed_at = now() WHERE model_run_id = $1", [
          modelRunId,
        ]),
      );
      logger.error("model run failed", { modelRunId, providerId: input.providerId, modelId: input.modelId, error: message });
      throw err;
    }

    const estimatedCost = estimateCost(modelRow.cost_profile, completion.inputTokens, completion.outputTokens);

    await withTenantTransaction(pool, input.tenantId, async (client) => {
      await client.query(
        `UPDATE model_runs
         SET status = 'COMPLETED', completed_at = now(), input_tokens = $1, output_tokens = $2, estimated_cost = $3
         WHERE model_run_id = $4`,
        [completion.inputTokens, completion.outputTokens, estimatedCost, modelRunId],
      );
      await client.query(
        `INSERT INTO usage_events (tenant_id, task_id, agent_id, provider_id, model_id, input_tokens, output_tokens, actual_cost, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'USD')`,
        [
          input.tenantId,
          input.taskId ?? null,
          input.agentId ?? null,
          input.providerId,
          input.modelId,
          completion.inputTokens,
          completion.outputTokens,
          estimatedCost,
        ],
      );
    });

    return { modelRunId, completion, estimatedCost };
  });
}
