import { createHash } from "node:crypto";
import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { executeModelRun, type ExecuteModelRunOptions } from "@ai-office/model-router-gateway";
import { callTool } from "@ai-office/tool-gateway-mcp";
import { WorkflowEngineError } from "./errors.js";
import type { WorkflowStep } from "./types.js";

export interface ExecuteStepDeps {
  modelRouterOptions?: ExecuteModelRunOptions;
}

/**
 * The point of this whole service: dispatches one workflow step to the
 * real service that owns it — model-router-gateway for a model call,
 * tool-gateway-mcp for a tool call — rather than reimplementing either.
 * Returns a plain-JSON-serializable result (it gets stored verbatim in
 * workflow_history.payload and workflow_registry.current_state).
 */
export async function executeStep(
  pool: Pool,
  tenantId: string,
  step: WorkflowStep,
  priorResults: Record<string, unknown>,
  deps: ExecuteStepDeps = {},
): Promise<unknown> {
  switch (step.type) {
    case "model_call": {
      const run = await executeModelRun(
        pool,
        {
          tenantId,
          ...(step.taskId !== undefined ? { taskId: step.taskId } : {}),
          ...(step.agentId !== undefined ? { agentId: step.agentId } : {}),
          providerId: step.providerId,
          modelId: step.modelId,
          request: step.request,
        },
        deps.modelRouterOptions,
      );
      return { modelRunId: run.modelRunId, content: run.completion.content, estimatedCost: run.estimatedCost };
    }

    case "tool_call": {
      const result = await callTool(pool, {
        tenantId,
        agentId: step.agentId,
        toolId: step.toolId,
        action: step.action,
        arguments: step.arguments,
      });
      return { content: result.content, isError: result.isError };
    }

    case "create_artifact": {
      const source = priorResults[step.contentFromStep];
      if (source === undefined) {
        throw new WorkflowEngineError(
          "MISSING_STEP_INPUT",
          `create_artifact step "${step.stepId}" references step "${step.contentFromStep}", which has no recorded result.`,
        );
      }
      const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(source)).digest("hex")}`;

      return withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<{ artifact_id: string }>(
          `INSERT INTO artifact_registry
             (tenant_id, project_id, task_id, artifact_type, storage_uri, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING artifact_id`,
          [tenantId, step.projectId, step.taskId ?? null, step.artifactType, step.storageUri, contentHash],
        );
        return { artifactId: rows[0]!.artifact_id, contentHash };
      });
    }

    default: {
      const unknownStep = step as { type: string };
      throw new WorkflowEngineError("UNKNOWN_STEP_TYPE", `Unknown step type: ${unknownStep.type}`);
    }
  }
}
