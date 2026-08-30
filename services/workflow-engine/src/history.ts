import type { PoolClient } from "@ai-office/db";
import type { WorkflowDefinition } from "./types.js";

export interface ReplayedState {
  definition: WorkflowDefinition | null;
  completedSteps: string[];
  stepResults: Record<string, unknown>;
  lastSequenceNo: number;
}

/** Append-only — matches packages/db/migrations/0004's own comment: "on
 * process restart, replay this to reconstruct workflow_registry.current_state
 * rather than trusting only the mutable row." sequence_no is computed
 * from the current max within the same transaction as the caller's other
 * writes, so it stays gap-free per workflow. */
export async function appendEvent(
  client: PoolClient,
  tenantId: string,
  workflowId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { rows } = await client.query<{ next: number }>(
    "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM workflow_history WHERE workflow_id = $1",
    [workflowId],
  );
  await client.query(
    "INSERT INTO workflow_history (tenant_id, workflow_id, sequence_no, event_type, payload) VALUES ($1, $2, $3, $4, $5)",
    [tenantId, workflowId, rows[0]!.next, eventType, JSON.stringify(payload)],
  );
}

/**
 * The actual "replay" — folds every workflow_history event for this
 * workflow, in order, into a state object. This is the source of truth
 * runNextStep consults before deciding what to do next; workflow_registry.
 * current_state is written alongside it purely as a fast-read cache for
 * other callers (e.g. GET /workflows), never trusted here.
 */
export async function replayState(client: PoolClient, workflowId: string): Promise<ReplayedState> {
  const { rows } = await client.query<{ sequence_no: string; event_type: string; payload: unknown }>(
    "SELECT sequence_no, event_type, payload FROM workflow_history WHERE workflow_id = $1 ORDER BY sequence_no ASC",
    [workflowId],
  );

  let definition: WorkflowDefinition | null = null;
  const completedSteps: string[] = [];
  const stepResults: Record<string, unknown> = {};
  let lastSequenceNo = 0;

  for (const row of rows) {
    lastSequenceNo = Number(row.sequence_no);
    if (row.event_type === "STARTED") {
      definition = (row.payload as { definition: WorkflowDefinition }).definition;
    } else if (row.event_type === "STEP_COMPLETED") {
      const payload = row.payload as { stepId: string; result: unknown };
      completedSteps.push(payload.stepId);
      stepResults[payload.stepId] = payload.result;
    }
  }

  return { definition, completedSteps, stepResults, lastSequenceNo };
}
