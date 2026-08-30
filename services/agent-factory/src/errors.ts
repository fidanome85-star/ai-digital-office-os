export type AgentFactoryErrorCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "POLICY_BLOCKED"
  | "SANDBOX_VALIDATION_FAILED"
  | "SCHEMA_VALIDATION_FAILED"
  | "QUALITY_GATE_FAILED";

export class AgentFactoryError extends Error {
  readonly code: AgentFactoryErrorCode;

  constructor(code: AgentFactoryErrorCode, message: string) {
    super(message);
    this.name = "AgentFactoryError";
    this.code = code;
  }
}
