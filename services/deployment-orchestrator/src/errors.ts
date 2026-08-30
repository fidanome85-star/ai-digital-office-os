export type DeploymentOrchestratorErrorCode = "NOT_FOUND" | "INVALID_STATE" | "NO_ROLLBACK_TARGET";

export class DeploymentOrchestratorError extends Error {
  readonly code: DeploymentOrchestratorErrorCode;

  constructor(code: DeploymentOrchestratorErrorCode, message: string) {
    super(message);
    this.name = "DeploymentOrchestratorError";
    this.code = code;
  }
}
