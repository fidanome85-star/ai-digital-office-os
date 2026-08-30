import type { CompletionRequest } from "@ai-office/model-router-gateway";

export interface ModelCallStep {
  type: "model_call";
  stepId: string;
  providerId: string;
  modelId: string;
  request: CompletionRequest;
  taskId?: string;
  agentId?: string;
}

export interface ToolCallStep {
  type: "tool_call";
  stepId: string;
  agentId: string;
  toolId: string;
  action: string;
  arguments: Record<string, unknown>;
}

export interface CreateArtifactStep {
  type: "create_artifact";
  stepId: string;
  projectId: string;
  taskId?: string;
  artifactType: string;
  storageUri: string;
  /** stepId of an earlier step whose result is hashed to produce content_hash. */
  contentFromStep: string;
}

export type WorkflowStep = ModelCallStep | ToolCallStep | CreateArtifactStep;

export interface WorkflowDefinition {
  steps: WorkflowStep[];
}

export interface StartWorkflowInput {
  projectId: string;
  workflowType: string;
  definitionVersion: string;
  definition: WorkflowDefinition;
}

export interface StepRunResult {
  ranStep: boolean;
  stepId?: string;
  stepStatus?: "completed" | "failed";
  workflowStatus: string;
  reason?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  finalStatus: string;
  completedSteps: string[];
  stoppedReason?: string;
}
