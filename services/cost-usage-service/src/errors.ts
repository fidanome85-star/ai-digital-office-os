export type CostUsageErrorCode = "INVALID_PERIOD";

export class CostUsageError extends Error {
  readonly code: CostUsageErrorCode;

  constructor(code: CostUsageErrorCode, message: string) {
    super(message);
    this.name = "CostUsageError";
    this.code = code;
  }
}
