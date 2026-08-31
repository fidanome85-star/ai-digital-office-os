# ADR 0010 — Session management boundary

**Status:** Accepted
**Date:** 2026-08-31

## Context

`docs/blueprint/V1.4_TECHNICAL_INTEGRITY_REVIEW.md`'s MEDIUM finding
"Session management is mentioned but not modeled" asked for one of two
things: either add a `session_registry`/refresh-token/revocation model,
or explicitly delegate sessions to the external identity provider and
document that boundary. `packages/auth` has been stateless bearer-JWT
verification since Phase 1 — no session table, no refresh endpoint, no
revocation list — which is already the second option, correctly
implemented. What was missing was the explicit documentation the finding
asked for: nowhere in the repo said, in so many words, "this is
intentional, here is the boundary."

## Decision

**Sessions are entirely the issuing identity provider's responsibility.**
`packages/auth` verifies a bearer JWT per request (issuer, audience,
signature via JWKS, expiry, clock skew) and derives a request-scoped
principal from its claims — that's the whole contract. It never:

- issues, stores, or refreshes tokens,
- maintains a session or refresh-token table,
- offers a way to revoke a specific still-valid token early.

Login, refresh, and revocation all happen upstream, at whatever IdP signs
these tokens. This codebase's only lever over session lifetime is token
expiry and `AUTH_CLOCK_TOLERANCE_SECONDS` (`.env.example`) — a token is
valid until it expires, full stop, matching the stateless-verification
architecture every service in this repo has used since `createTokenVerifier`
was first built.

## Consequences

- No `session_registry` table exists or is planned — adding one would
  contradict this decision, not complete it.
- Early revocation (a compromised token, a fired employee) is out of this
  codebase's reach by design. A real deployment needing it should keep
  access-token lifetimes short and pair them with a refresh flow at the
  IdP, or have the IdP consult a revocation list before minting — neither
  requires any change here, since this package only ever verifies what
  it's handed.
- This closes the integrity review's MEDIUM finding via documentation,
  not new code — the architecture was already correct; the finding was
  that the boundary had never been written down.
