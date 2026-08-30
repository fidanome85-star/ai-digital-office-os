import type { NextFunction, Request, Response } from "express";
import { AuthError, runWithPrincipal, type TokenVerifier } from "@ai-office/auth";
import { sendError } from "./errors.js";

/**
 * Deliberately not @ai-office/auth's own requireAuth/requireScopes — those
 * use a generic error envelope meant to be reusable by any future service.
 * This control plane's OpenAPI contract has its own ErrorResponse shape
 * (error_code enum, correlation_id, retryable), so it adapts AuthError
 * itself rather than fighting a mismatched generic envelope.
 */
export function requireAuth(verifier: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      sendError(res, req, 401, "AUTHORIZATION_ERROR", "Missing or malformed Authorization header.");
      return;
    }
    const token = header.slice("Bearer ".length).trim();

    try {
      const principal = await verifier.verify(token);
      req.principal = principal;
      runWithPrincipal(principal, () => next());
    } catch (err) {
      if (err instanceof AuthError) {
        sendError(res, req, 401, "AUTHORIZATION_ERROR", err.message);
        return;
      }
      next(err);
    }
  };
}

export function requireScopes(...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      sendError(res, req, 401, "AUTHORIZATION_ERROR", "requireAuth() must run before requireScopes().");
      return;
    }
    const missing = scopes.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      sendError(res, req, 403, "AUTHORIZATION_ERROR", `Missing required scope(s): ${missing.join(", ")}`);
      return;
    }
    next();
  };
}
