export type ModelRouterErrorCode =
  | "SECRET_NOT_FOUND"
  | "UNSUPPORTED_ADAPTER_TYPE"
  | "PROVIDER_UNREACHABLE"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "TIMEOUT"
  | "NOT_FOUND";

export class ModelRouterError extends Error {
  readonly code: ModelRouterErrorCode;
  readonly retryable: boolean;

  constructor(code: ModelRouterErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ModelRouterError";
    this.code = code;
    this.retryable = retryable;
  }
}
