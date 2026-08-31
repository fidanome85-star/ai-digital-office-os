/**
 * Session management boundary (integrity review MEDIUM finding, closed by
 * this comment + docs/decisions/0010): this package verifies a bearer JWT
 * per request and is entirely stateless — there is no session store, no
 * refresh-token issuance, and no session_registry table. Session
 * lifecycle (login, refresh, revocation) is explicitly delegated to
 * whatever external identity provider issues these tokens; this codebase
 * only ever verifies what it's handed. Revocation is therefore bounded by
 * token expiry (`AUTH_JWT_*` config, `clockToleranceSeconds`) — there is
 * no server-side "log this token out early" mechanism, by design, not
 * oversight. A production deployment needing early revocation would add
 * that at the IdP (a short-lived access token + refresh flow, or a
 * revocation list the IdP checks before minting), not here.
 */
export * from "./config.js";
export * from "./claims.js";
export * from "./errors.js";
export * from "./verifier.js";
export * from "./tenant-context.js";
export * from "./middleware.js";
