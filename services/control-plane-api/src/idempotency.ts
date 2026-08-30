import type { NextFunction, Request, Response } from "express";
import type { PoolClient } from "@ai-office/db";
import { sendError } from "./errors.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "DELETE"]);

/**
 * The OpenAPI Idempotency-Key parameter description says it is "required
 * on every state-changing (POST/PATCH/DELETE) request", but only some
 * operations actually reference it via $ref — a spec-internal
 * inconsistency (see docs/decisions for the Phase 2 ADR). This adopts the
 * stated global intent: every POST/PATCH/DELETE must carry the header.
 */
export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }
  const key = req.header("Idempotency-Key");
  if (!key) {
    sendError(res, req, 400, "VALIDATION_ERROR", "Missing required Idempotency-Key header.");
    return;
  }
  req.idempotencyKey = key;
  next();
}

interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Wraps a write operation so a retried request (same tenant + key) returns
 * the original result instead of re-executing. Runs inside the same
 * transaction as the operation itself, so a failed operation never poisons
 * the idempotency store — only a committed success is cached.
 */
export async function withIdempotentWrite<T>(
  client: PoolClient,
  params: { tenantId: string; idempotencyKey: string; method: string; path: string },
  fn: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const existing = await client.query<{ response_status: number; response_body: T }>(
    "SELECT response_status, response_body FROM api_idempotency_keys WHERE tenant_id = $1 AND idempotency_key = $2",
    [params.tenantId, params.idempotencyKey],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    return { status: row.response_status, body: row.response_body, replayed: true };
  }

  const { status, body } = await fn();

  await client.query(
    `INSERT INTO api_idempotency_keys
       (tenant_id, idempotency_key, method, path, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.tenantId, params.idempotencyKey, params.method, params.path, status, JSON.stringify(body)],
  );

  return { status, body, replayed: false };
}
