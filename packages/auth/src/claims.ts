/**
 * The blueprint distinguishes human and service (agent/machine-to-machine)
 * callers throughout — approvals, audit_events and policy decisions all
 * need to know which kind of principal acted. That distinction has to be
 * carried on the token itself as a custom claim, not inferred later.
 */
export type PrincipalType = "human" | "service";

interface BasePrincipal {
  /** Raw `sub` claim. */
  subject: string;
  /** Custom `tenant_id` claim — required on every token, human or service. */
  tenantId: string;
  /** Parsed from the space-delimited OAuth2 `scope` claim. */
  scopes: string[];
  issuer: string;
  audience: string;
  expiresAt: Date;
  issuedAt: Date;
}

export interface HumanPrincipal extends BasePrincipal {
  principalType: "human";
  userId: string;
}

export interface ServicePrincipal extends BasePrincipal {
  principalType: "service";
  serviceId: string;
}

export type AuthenticatedPrincipal = HumanPrincipal | ServicePrincipal;

export function hasScope(principal: AuthenticatedPrincipal, scope: string): boolean {
  return principal.scopes.includes(scope);
}

export function hasAllScopes(principal: AuthenticatedPrincipal, scopes: readonly string[]): boolean {
  return scopes.every((scope) => hasScope(principal, scope));
}
