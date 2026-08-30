export type WorkflowEngineErrorCode = "NOT_FOUND" | "UNKNOWN_STEP_TYPE" | "MISSING_STEP_INPUT";

export class WorkflowEngineError extends Error {
  readonly code: WorkflowEngineErrorCode;

  constructor(code: WorkflowEngineErrorCode, message: string) {
    super(message);
    this.name = "WorkflowEngineError";
    this.code = code;
  }
}
