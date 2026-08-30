import type { AuthenticatedPrincipal } from "./claims.js";
import { hasAllScopes } from "./claims.js";
import { AuthError } from "./errors.js";
import { runWithPrincipal } from "./tenant-context.js";
import type { TokenVerifier } from "./verifier.js";

/**
 * Structural, framework-agnostic request/response shapes — deliberately
 * not an Express dependency, so this package works unmodified with
 * Express, Fastify-with-adapter, or a hand-rolled router.
 */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: AuthenticatedPrincipal;
}

export interface MinimalResponse {
  status(code: number): this;
  json(body: unknown): this;
}

export type NextFn = (err?: unknown) => void;

function extractBearerToken(req: AuthenticatedRequest): string | undefined {
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

export function requireAuth(verifier: TokenVerifier) {
  return async (req: AuthenticatedRequest, res: MinimalResponse, next: NextFn): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "TOKEN_MISSING", message: "Missing or malformed Authorization header." });
      return;
    }

    try {
      const principal = await verifier.verify(token);
      req.principal = principal;
      runWithPrincipal(principal, () => next());
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(401).json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  };
}

export function requireScopes(...scopes: string[]) {
  return (req: AuthenticatedRequest, res: MinimalResponse, next: NextFn): void => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({
        error: "TOKEN_MISSING",
        message: "requireAuth() middleware must run before requireScopes().",
      });
      return;
    }
    if (!hasAllScopes(principal, scopes)) {
      res.status(403).json({
        error: "INSUFFICIENT_SCOPE",
        message: `Missing required scope(s): ${scopes.join(", ")}`,
      });
      return;
    }
    next();
  };
}
