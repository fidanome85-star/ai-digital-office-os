export type PolicyEngineServiceErrorCode = "INVALID_RULES" | "NOT_FOUND";

export class PolicyEngineServiceError extends Error {
  readonly code: PolicyEngineServiceErrorCode;

  constructor(code: PolicyEngineServiceErrorCode, message: string) {
    super(message);
    this.name = "PolicyEngineServiceError";
    this.code = code;
  }
}
