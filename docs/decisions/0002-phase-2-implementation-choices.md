# ADR 0002 — Phase 2 implementation choices

**Status:** Accepted
**Date:** 2026-08-30

## Context

Phase 2 implements all 40 OpenAPI paths / 48 operations in
`services/control-plane-api` against the Phase 1 schema, domain model and
auth package. Several gaps and inconsistencies in the v1.4 OpenAPI contract
itself had to be resolved to make a real, working implementation possible.

## Decisions

1. **Fixed a duplicate-YAML-key bug in the OpenAPI contract before
   implementing against it.** `/artifacts` and `/agents/{agent_id}/messages`
   were each declared twice — once for GET, once for POST — as separate
   top-level mapping keys. YAML does not define behavior for duplicate keys;
   most parsers (js-yaml, PyYAML) silently keep only the last occurrence,
   which would have made the GET operations disappear from any spec-driven
   tooling with no error anywhere. Merged into single path items; a
   `tests/openapi-coverage.test.ts` regression test now asserts every one
   of the resulting 48 operations has a bound Express route, and asserts
   the total is exactly 48 — so this class of bug cannot recur silently.

2. **Adopted the OpenAPI Idempotency-Key parameter's stated global intent
   over its inconsistent per-operation application.** The parameter's own
   description says it is "required on every state-changing (POST/PATCH/
   DELETE) request," but only about half of the actual operations reference
   it via `$ref`. Enforcing it only where explicitly `$ref`'d would silently
   contradict the contract's own stated intent. `requireIdempotencyKey`
   middleware in `services/control-plane-api/src/idempotency.ts` applies it
   uniformly; a new migration (`0023_api_idempotency.sql`) backs generic
   replay caching, while `POST /tasks` and `POST /agents/{id}/messages`
   reuse their tables' own existing `(tenant_id, idempotency_key)` uniqueness
   instead of the generic store.

3. **A shared runtime `withTenantTransaction` helper lives in
   `packages/db`, not duplicated per service.** Every future service needs
   the same pattern: pull a pooled connection, `SET LOCAL
   app.current_tenant_id` for that transaction only (never session-level —
   pooled connections are reused across unrelated requests, so a
   session-level `SET` would leak one request's tenant into the next),
   run the work, commit or roll back. Built once in Phase 1's `packages/db`
   scaffolding, used for the first time here.

4. **control-plane-api does not reuse `@ai-office/auth`'s
   `requireAuth`/`requireScopes` middleware verbatim.** That package's
   error envelope is intentionally generic (reusable by any future
   service); this control plane's OpenAPI contract defines its own
   `ErrorResponse` shape (`error_code` enum, `correlation_id`,
   `retryable`). `services/control-plane-api/src/auth-middleware.ts` uses
   `@ai-office/auth`'s `TokenVerifier` and `AuthError` directly and adapts
   them to the contract's own envelope, rather than fighting a mismatched
   generic one.

5. **Where a later build-order phase's subsystem doesn't exist yet, the
   endpoint is real (persists real rows, real SQL, real validation) but the
   "intelligence" is a documented, simple placeholder — never a fabricated
   result dressed up as sophisticated:**
   - `POST /models/route`: rule-based — walks the agent's preferred model
     then `fallback_models` in order, first ACTIVE model whose
     `capabilities` JSONB contains the required capability wins. Real
     cost/latency-aware routing is `model-router-gateway` (build-order
     step 6).
   - `POST /models/evaluate`: persists a real `model_evaluation_runs` row
     and carries forward the model's existing `evaluation_score` rather
     than fabricating a fresh one; `results.note` says explicitly that no
     benchmark harness exists yet.
   - `POST /memory/query`: Tier 2 (`memory_facts`) literal text search
     only. Tier 3 (`memory_embeddings`, pgvector/HNSW) genuinely exists and
     works at the schema level, but ranking by *semantic* similarity to
     arbitrary query text requires calling a real embedding model — no
     provider integration exists yet. A hash-based pseudo-embedding would
     produce meaningless similarity scores dressed up as real ones; that's
     worse than being explicit about the gap.
   - `GET /costs`: `budget_status` is always `"OK"` — no budget-tier table
     exists in the schema to compare consumption against yet.
   - `POST /deployments`: returns a clear `VALIDATION_ERROR` if `release_id`
     doesn't already exist, rather than silently auto-creating a
     `release_registry` row behind the caller's back — the v1.4 contract
     has no `/releases` endpoint at all (a gap in the spec itself).

6. **Declaration output (`declaration`/`declarationMap`) removed from
   `tsconfig.base.json`.** Nothing in this monorepo consumes compiled
   `.d.ts` files — every package imports another's `.ts` source directly
   via `tsx`, matching the pattern `packages/auth` and
   `packages/domain-model` already established in Phase 1. Declaration
   emit was only producing noisy "inferred type cannot be named without a
   reference to ..." errors on every exported Express `Router`, for a
   build artifact nothing reads.

## Consequences

- The five items in decision 5 are explicitly listed as TARGET, not
  VERIFIED, in `PHASE_STATUS.md` — they are real, tested endpoints with
  intentionally simple logic, not incomplete features pretending to be
  finished ones.
- `tests/golden-path.test.ts` is the primary integration proof: one
  sequential flow through project → agent → version → approval →
  activation → task → workflow → artifact lineage → routing → evaluation →
  catalogs → flags → secrets → usage/costs → deployment → memory, against
  a real running server and real Postgres. `tests/rls-adversarial/` still
  owns the dedicated cross-tenant security proof; the golden path proves
  the pieces work *together*, not tenant isolation depth.
