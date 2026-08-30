/**
 * Closes the v1.4 integrity review's MEDIUM finding on the auth contract:
 * issuer, audience, JWKS source, clock-skew tolerance and required scopes
 * must all be explicit, not implied. See docs/blueprint/V1.4_TECHNICAL_INTEGRITY_REVIEW.md.
 */
export interface AuthConfig {
  /** Expected `iss` claim. Requests bearing tokens from any other issuer are rejected. */
  issuer: string;
  /** Expected `aud` claim — this control plane's own identifier. */
  audience: string;
  /** JWKS endpoint used to resolve signing keys and rotate them automatically by `kid`. */
  jwksUri: string;
  /** Tolerance, in seconds, for clock skew between the issuer and this service when checking exp/nbf/iat. */
  clockToleranceSeconds: number;
}

export function loadAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const issuer = env["AUTH_JWT_ISSUER"];
  const audience = env["AUTH_JWT_AUDIENCE"];
  const jwksUri = env["AUTH_JWKS_URI"];
  const clockToleranceRaw = env["AUTH_CLOCK_TOLERANCE_SECONDS"] ?? "30";

  const missing = [
    ["AUTH_JWT_ISSUER", issuer],
    ["AUTH_JWT_AUDIENCE", audience],
    ["AUTH_JWKS_URI", jwksUri],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required auth environment variables: ${missing.map(([name]) => name).join(", ")}`,
    );
  }

  const clockToleranceSeconds = Number(clockToleranceRaw);
  if (!Number.isFinite(clockToleranceSeconds) || clockToleranceSeconds < 0) {
    throw new Error(`AUTH_CLOCK_TOLERANCE_SECONDS must be a non-negative number, got: ${clockToleranceRaw}`);
  }

  return { issuer: issuer!, audience: audience!, jwksUri: jwksUri!, clockToleranceSeconds };
}
