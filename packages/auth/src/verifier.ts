import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AuthConfig } from "./config.js";
import type { AuthenticatedPrincipal } from "./claims.js";
import { AuthError } from "./errors.js";

export interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedPrincipal>;
}

/**
 * `keyResolver` defaults to a remote JWKS client that caches keys and
 * re-fetches automatically on an unrecognized `kid` — this is what makes
 * key rotation (the other half of the integrity review's auth finding)
 * transparent to callers. Tests inject a local JWKS instead (see
 * test/verifier.test.ts) so verification logic is exercised without a
 * network-hosted JWKS endpoint.
 */
export function createTokenVerifier(config: AuthConfig, keyResolver?: JWTVerifyGetKey): TokenVerifier {
  const resolveKey = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUri));

  return {
    async verify(token: string): Promise<AuthenticatedPrincipal> {
      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, resolveKey, {
          issuer: config.issuer,
          audience: config.audience,
          clockTolerance: config.clockToleranceSeconds,
        });
        payload = result.payload;
      } catch (err) {
        if (err instanceof Error && err.name === "JWTExpired") {
          throw new AuthError("TOKEN_EXPIRED", "Access token has expired.");
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new AuthError("TOKEN_INVALID", `Access token failed verification: ${message}`);
      }

      return toPrincipal(payload);
    },
  };
}

function toPrincipal(payload: JWTPayload): AuthenticatedPrincipal {
  const subject = payload.sub;
  if (!subject) {
    throw new AuthError("CLAIMS_INVALID", "Token is missing the required 'sub' claim.");
  }

  const tenantId = payload["tenant_id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new AuthError("CLAIMS_INVALID", "Token is missing the required 'tenant_id' claim.");
  }

  const principalType = payload["principal_type"];
  if (principalType !== "human" && principalType !== "service") {
    throw new AuthError(
      "CLAIMS_INVALID",
      "Token 'principal_type' claim must be exactly 'human' or 'service'.",
    );
  }

  const scopeClaim = payload["scope"];
  const scopes = typeof scopeClaim === "string" && scopeClaim.length > 0 ? scopeClaim.split(" ") : [];

  const issuer = payload.iss ?? "";
  const audience = Array.isArray(payload.aud) ? (payload.aud[0] ?? "") : (payload.aud ?? "");
  const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(0);
  const issuedAt = payload.iat ? new Date(payload.iat * 1000) : new Date(0);

  const base = { subject, tenantId, scopes, issuer, audience, expiresAt, issuedAt };

  if (principalType === "human") {
    const userId = payload["user_id"];
    if (typeof userId !== "string" || userId.length === 0) {
      throw new AuthError("CLAIMS_INVALID", "Human tokens must carry a 'user_id' claim.");
    }
    return { ...base, principalType: "human", userId };
  }

  const serviceId = payload["service_id"];
  if (typeof serviceId !== "string" || serviceId.length === 0) {
    throw new AuthError("CLAIMS_INVALID", "Service tokens must carry a 'service_id' claim.");
  }
  return { ...base, principalType: "service", serviceId };
}
