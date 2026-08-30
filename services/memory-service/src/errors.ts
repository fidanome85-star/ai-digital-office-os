export type MemoryServiceErrorCode = "NOT_FOUND" | "PROVIDER_UNREACHABLE" | "INVALID_RESPONSE" | "RATE_LIMITED" | "PROVIDER_ERROR" | "TIMEOUT";

export class MemoryServiceError extends Error {
  readonly code: MemoryServiceErrorCode;
  readonly retryable: boolean;

  constructor(code: MemoryServiceErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "MemoryServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}
