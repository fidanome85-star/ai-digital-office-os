import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import { withSpan } from "@ai-office/observability";
import { WorkflowEngineError } from "./errors.js";
import { type ExecuteStepDeps, executeStep } from "./execute-step.js";
import { appendEvent, replayState } from "./history.js";
import { generateId } from "./ids.js";
import { logger } from "./logger.js";
import type { StartWorkflowInput, StepRunResult, WorkflowRunResult } from "./types.js";

export async function startWorkflow(pool: Pool, tenantId: string, input: StartWorkflowInput): Promise<{ workflowId: string }> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const project = await client.query("SELECT 1 FROM project_registry WHERE project_id = $1", [input.projectId]);
    if (project.rows.length === 0) {
      throw new WorkflowEngineError("NOT_FOUND", `project_id ${input.projectId} does not exist.`);
    }

    const workflowId = generateId("wf");
    await client.query(
      `INSERT INTO workflow_registry
         (workflow_id, tenant_id, project_id, workflow_type, definition_version, current_state, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING')`,
      [
        workflowId,
        tenantId,
        input.projectId,
        input.workflowType,
        input.definitionVersion,
        JSON.stringify({ definition: input.definition, completedSteps: [], stepResults: {} }),
      ],
    );
    await appendEvent(client, tenantId, workflowId, "STARTED", { definition: input.definition });

    return { workflowId };
  });
}

/**
 * Executes exactly the next pending step, or does nothing if the workflow
 * isn't RUNNING (paused/cancelled/already finished) or has no steps left.
 * State is re-derived from workflow_history on every call (see
 * history.ts) — not cached in memory — which is what makes this safe to
 * call again after a crash, and what lets a concurrent PAUSE (e.g. from
 * control-plane-api's POST /workflows/{id}/pause) take effect on the very
 * next call without this service needing to know about that request at all.
 */
export async function runNextStep(pool: Pool, tenantId: string, workflowId: string, deps: ExecuteStepDeps = {}): Promise<StepRunResult> {
  return withSpan(logger, `runNextStep(${workflowId})`, async () => {
    const { workflowStatus, replayed } = await withTenantTransaction(pool, tenantId, async (client) => {
      const { rows } = await client.query<{ status: string }>("SELECT status FROM workflow_registry WHERE workflow_id = $1", [
        workflowId,
      ]);
      const wf = rows[0];
      if (!wf) throw new WorkflowEngineError("NOT_FOUND", `Workflow ${workflowId} not found.`);
      return { workflowStatus: wf.status, replayed: await replayState(client, workflowId) };
    });

    if (workflowStatus !== "RUNNING") {
      return { ranStep: false, workflowStatus, reason: `workflow is ${workflowStatus}, not RUNNING` };
    }
    if (!replayed.definition) {
      return { ranStep: false, workflowStatus, reason: "no STARTED event in workflow_history — malformed history" };
    }

    const nextStep = replayed.definition.steps.find((s) => !replayed.completedSteps.includes(s.stepId));
    if (!nextStep) {
      await withTenantTransaction(pool, tenantId, async (client) => {
        await client.query(
          "UPDATE workflow_registry SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE workflow_id = $1",
          [workflowId],
        );
        await appendEvent(client, tenantId, workflowId, "COMPLETED", {});
      });
      return { ranStep: false, workflowStatus: "COMPLETED", reason: "all steps completed" };
    }

    await withTenantTransaction(pool, tenantId, (client) =>
      appendEvent(client, tenantId, workflowId, "STEP_STARTED", { stepId: nextStep.stepId }),
    );

    let result: unknown;
    try {
      result = await executeStep(pool, tenantId, nextStep, replayed.stepResults, deps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await withTenantTransaction(pool, tenantId, async (client) => {
        await appendEvent(client, tenantId, workflowId, "STEP_FAILED", { stepId: nextStep.stepId, error: message });
        await client.query(
          "UPDATE workflow_registry SET status = 'FAILED', completed_at = now(), updated_at = now() WHERE workflow_id = $1",
          [workflowId],
        );
      });
      logger.error("workflow step failed", { workflowId, stepId: nextStep.stepId, error: message });
      return { ranStep: true, stepId: nextStep.stepId, stepStatus: "failed", workflowStatus: "FAILED", reason: message };
    }

    await withTenantTransaction(pool, tenantId, async (client) => {
      await appendEvent(client, tenantId, workflowId, "STEP_COMPLETED", { stepId: nextStep.stepId, result });
      const newState = {
        definition: replayed.definition,
        completedSteps: [...replayed.completedSteps, nextStep.stepId],
        stepResults: { ...replayed.stepResults, [nextStep.stepId]: result },
      };
      await client.query("UPDATE workflow_registry SET current_state = $1, updated_at = now() WHERE workflow_id = $2", [
        JSON.stringify(newState),
        workflowId,
      ]);
    });

    return { ranStep: true, stepId: nextStep.stepId, stepStatus: "completed", workflowStatus: "RUNNING" };
  });
}

/** Drives runNextStep in a loop until nothing is left to run, the
 * workflow leaves RUNNING (paused/cancelled/completed), or a step fails. */
export async function runToCompletion(pool: Pool, tenantId: string, workflowId: string, deps: ExecuteStepDeps = {}): Promise<WorkflowRunResult> {
  const completedSteps: string[] = [];

  for (;;) {
    const result = await runNextStep(pool, tenantId, workflowId, deps);

    if (result.stepId && result.stepStatus === "completed") {
      completedSteps.push(result.stepId);
    }

    if (!result.ranStep) {
      return { workflowId, finalStatus: result.workflowStatus, completedSteps, ...(result.reason !== undefined ? { stoppedReason: result.reason } : {}) };
    }
    if (result.stepStatus === "failed") {
      return { workflowId, finalStatus: result.workflowStatus, completedSteps, stoppedReason: `step ${result.stepId} failed: ${result.reason}` };
    }
  }
}
