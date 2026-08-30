import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger.js";

/** Matches components.schemas.ErrorResponse.error_code in the OpenAPI contract exactly. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "POLICY_ERROR"
  | "TOOL_ERROR"
  | "MODEL_ERROR"
  | "PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "DATABASE_ERROR"
  | "ARTIFACT_ERROR"
  | "DEPLOYMENT_ERROR"
  | "UNKNOWN_ERROR";

export class ApiError extends Error {
  readonly httpStatus: number;
  readonly errorCode: ErrorCode;
  readonly retryable: boolean;

  constructor(httpStatus: number, errorCode: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.retryable = retryable;
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, "VALIDATION_ERROR", message);
  }

  static validation(message: string): ApiError {
    return new ApiError(400, "VALIDATION_ERROR", message);
  }

  static policyDenied(message: string): ApiError {
    return new ApiError(403, "POLICY_ERROR", message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, "VALIDATION_ERROR", message);
  }
}

export function sendError(
  res: Response,
  req: Request,
  httpStatus: number,
  errorCode: ErrorCode,
  message: string,
  retryable = false,
): void {
  res.status(httpStatus).json({
    error_code: errorCode,
    message,
    correlation_id: req.correlationId ?? randomUUID(),
    retryable,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendError(res, req, err.httpStatus, err.errorCode, err.message, err.retryable);
    return;
  }
  logger.error("Unhandled error", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  sendError(res, req, 500, "UNKNOWN_ERROR", "An unexpected error occurred.", true);
}
