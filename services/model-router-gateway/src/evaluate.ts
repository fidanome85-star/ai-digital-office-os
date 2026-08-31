import type { Pool } from "@ai-office/db";
import { withSpan } from "@ai-office/observability";
import { executeModelRun, type ExecuteModelRunOptions } from "./execute.js";
import { logger } from "./logger.js";

export interface BenchmarkCaseResult {
  prompt: string;
  success: boolean;
  latencyMs: number;
  outputTokens: number;
  error?: string;
}

export interface BenchmarkSuiteResult {
  /** 0-100. Execution-reliability score — see the doc comment on
   * runBenchmarkSuite for exactly what this does and does not measure. */
  score: number;
  successRate: number;
  averageLatencyMs: number;
  averageOutputTokens: number;
  cases: BenchmarkCaseResult[];
}

/** A small, fixed, generic prompt set — deliberately not specific to any
 * one capability (coding/reasoning/tool-use), since scoring here measures
 * whether the execution path works at all, not domain performance. */
const DEFAULT_BENCHMARK_PROMPTS: readonly string[] = [
  "Summarize the following in one sentence: The quick brown fox jumps over the lazy dog.",
  "What is 7 multiplied by 6?",
  "List three primary colors.",
];

export interface RunBenchmarkSuiteInput {
  tenantId: string;
  providerId: string;
  modelId: string;
  /** Overrides the default prompt set. */
  prompts?: string[];
}

/**
 * Runs a real set of prompts through the real `executeModelRun` path
 * (real retry/backoff, real `model_runs`/`usage_events` rows, real
 * adapter calls) and scores **execution reliability** — the fraction of
 * prompts that completed without error — not answer correctness.
 *
 * This is a deliberate choice, not a shortcut: judging whether a
 * response is actually *correct* would require a second, equally
 * fallible model to grade the first one's output, which is not a real
 * measurement — it would just be one placeholder score standing in for
 * another. Execution reliability is something concretely true and
 * directly observable: did the adapter/provider/retry path actually
 * complete for real prompts, including any transient-failure retries
 * `executeModelRun` already performs. See docs/decisions/0011.
 *
 * Every case's failure (including an unsupported/misconfigured
 * `adapter_type`) is caught and recorded rather than aborting the whole
 * suite — a benchmark run should always finish and report what it found.
 */
export async function runBenchmarkSuite(
  pool: Pool,
  input: RunBenchmarkSuiteInput,
  options: ExecuteModelRunOptions = {},
): Promise<BenchmarkSuiteResult> {
  return withSpan(logger, `runBenchmarkSuite(${input.modelId})`, async () => {
    const prompts = input.prompts && input.prompts.length > 0 ? input.prompts : DEFAULT_BENCHMARK_PROMPTS;
    const cases: BenchmarkCaseResult[] = [];

    for (const prompt of prompts) {
      const startedAt = Date.now();
      try {
        const result = await executeModelRun(
          pool,
          {
            tenantId: input.tenantId,
            providerId: input.providerId,
            modelId: input.modelId,
            request: { model: input.modelId, messages: [{ role: "user", content: prompt }] },
          },
          options,
        );
        cases.push({
          prompt,
          success: true,
          latencyMs: Date.now() - startedAt,
          outputTokens: result.completion.outputTokens,
        });
      } catch (err) {
        cases.push({
          prompt,
          success: false,
          latencyMs: Date.now() - startedAt,
          outputTokens: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const successCount = cases.filter((c) => c.success).length;
    const successRate = cases.length > 0 ? successCount / cases.length : 0;
    const averageLatencyMs = cases.reduce((sum, c) => sum + c.latencyMs, 0) / (cases.length || 1);
    const averageOutputTokens = cases.reduce((sum, c) => sum + c.outputTokens, 0) / (cases.length || 1);

    const suiteResult: BenchmarkSuiteResult = {
      score: Number((successRate * 100).toFixed(2)),
      successRate: Number(successRate.toFixed(4)),
      averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
      averageOutputTokens: Number(averageOutputTokens.toFixed(2)),
      cases,
    };
    logger.info("benchmark suite completed", {
      modelId: input.modelId,
      score: suiteResult.score,
      caseCount: cases.length,
    });
    return suiteResult;
  });
}
