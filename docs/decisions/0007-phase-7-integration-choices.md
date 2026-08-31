# ADR 0007 — Phase 7 integration choices

**Status:** Accepted
**Date:** 2026-08-31

## Context

Phase 6 built four library services (memory-service, cost-usage-service,
deployment-orchestrator, policy-engine-service) with real, tested logic
but no HTTP surface of their own — control-plane-api's Phase 2 placeholder
handlers for `/costs`, `/memory/query`, `/deployments`, and `/deployments/
{id}/rollback` still contained their original placeholder logic
(`budget_status` hardcoded to `"OK"`, `/memory/query` doing only an inline
ILIKE match, deployment rollback marking `ROLLED_BACK` with no health
check). Phase 7 wires these together — the last non-optional gap left
between "the services exist" and "the platform actually behaves the way
the blueprint describes."

## Decisions

1. **`getCostSummary` fully replaces the inline `/costs` query.**
   `costs.ts` now calls `@ai-office/cost-usage-service` directly instead
   of duplicating the aggregation SQL — the real four-state
   `budget_status` progression (OK/WARNING/SOFT_LIMIT/HARD_LIMIT) is now
   live over HTTP, not just inside cost-usage-service's own test suite.
   `CostSummary`'s OpenAPI schema gained a `budget_tier` field to expose
   what the status was actually judged against.

2. **`/memory/query` calls `recallFacts` for Tier 2 unconditionally, and
   `semanticSearch` for Tier 3 only when the tenant has actually
   configured an embedding-provider secret.** A `secrets_vault_references`
   row with a fixed `secret_name = "memory-embedding-provider"` (unscoped
   by agent/provider/tool — those columns stay NULL) is the convention;
   its `vault_path` resolves through the same `env:VAR_NAME` pattern every
   other service uses. No such secret exists in this environment by
   design (ADR 0004 §1, ADR 0006 §1) — the endpoint keeps working exactly
   as it did in Phase 2 (Tier 2 only) until one is configured, rather than
   ever calling a fabricated embedding. When a secret is present, this is
   the same `OpenAiEmbeddingAdapter` + `semanticSearch` code path already
   proven against a mock server in memory-service's own suite — this
   phase only adds the wiring, not new adapter logic. A test-only
   `EMBEDDING_PROVIDER_BASE_URL` env override (mirroring
   model-router-gateway's `ExecuteModelRunOptions.adapterBaseUrl`) lets
   `integration-wiring.test.ts` point the adapter at a local mock server
   without touching production code paths.

3. **`health_check_url` is a new, optional, additive column on
   `deployment_registry` (migration 0025) and field on
   `DeploymentCreateRequest`** — not present in the original v1.4 OpenAPI
   contract, added and documented in the spec itself (same "additive,
   documented extension" discipline as Phase 2's global Idempotency-Key
   enforcement, ADR 0002 §2). A deployment created without one behaves
   exactly as it always has: an IN_PROGRESS row with no live infrastructure
   to check (same honest gap as every network-touching piece since ADR
   0004). Supplying one makes both `POST /deployments` and
   `POST /deployments/{id}/rollback` call through to
   `@ai-office/deployment-orchestrator`'s real, health-checked
   `advanceDeployment`/`rollbackDeployment` — the same functions already
   proven in deployment-orchestrator's own suite.

4. **`advanceDeployment` is called only after the creating transaction has
   fully committed, using the shared `pool` — never nested inside the
   `withRequestTenant`/`withIdempotentWrite` transaction that inserted the
   row.** `advanceDeployment` opens its own transaction on a separate
   connection; under READ COMMITTED, that connection cannot see a row
   still inside another open transaction. Sequencing the call after
   `withRequestTenant(...)`'s promise resolves — which only happens after
   `COMMIT` — avoids a spurious `NOT_FOUND`. One consequence is accepted
   deliberately: the idempotency-cache row written by `withIdempotentWrite`
   still reflects the pre-advance IN_PROGRESS snapshot, since caching
   happens before the health check runs. A retried (replayed) `POST
   /deployments` with the same Idempotency-Key returns that original
   snapshot rather than the live status; the first response and a
   subsequent `GET /deployments/{id}` both reflect the real outcome. This
   mirrors ADR 0005 §5's stance that no transaction should wrap a call
   whose duration is unbounded (there, a model/tool call; here, an HTTP
   health check).

5. **`POST /deployments/{id}/rollback` reads `health_check_url` off the
   already-committed deployment row being rolled back**, not from the
   rollback request body — the check target is a property of the
   environment being deployed to, not of the rollback action itself. Since
   the row was committed in an earlier, separate request, calling
   `rollbackDeployment(pool, ...)` from inside this request's transaction
   has none of point 4's visibility concern — there's no need to defer it
   to after commit. When no `health_check_url` was recorded, the endpoint
   falls back to the original Phase 2 unchecked-rollback logic, unchanged.

6. **`GET /approvals` sweeps overdue undecided approvals to `EXPIRED` via
   `@ai-office/policy-engine-service`'s `expirePendingApprovals` before
   building its response** — lazy, at-read-time expiry, the same "no cron
   needed for correctness" pattern memory-service's working-memory TTL
   already established. This closes the real `EXPIRED`-enum gap noted in
   ADR 0006 §6 by actually calling the function from an HTTP path, not
   just proving it works in isolation.

7. **`policy-engine-service`'s `upsertPolicy`/`listPolicies`/`getPolicy`
   remain library-only — no `/policies` route was added.** The v1.4
   OpenAPI contract has no `/policies` path at all (only `/policy-decisions`,
   a different, already-implemented read of `policy_decision_records`).
   Adding an endpoint with no spec basis would be scope invention, not
   integration; this gap is tracked honestly below rather than papered
   over by inventing a path.

## Consequences

- All four Phase 6 services are now genuinely reachable over HTTP, not
  just tested in isolation — `integration-wiring.test.ts` proves each
  wired path with an assertion that could only pass if the real service
  logic ran (a budget threshold, a real HTTP health check flipping status,
  a pgvector-ranked semantic result, a swept `EXPIRED` decision), not just
  that the old placeholder behavior didn't regress (golden-path.test.ts
  continues to cover that separately, unchanged).
- `purgeExpiredWorkingMemory` (memory-service) remains unwired — Tier 1
  working memory has no HTTP surface in the OpenAPI contract to sweep
  from, unlike approvals' `GET /approvals`. Still a documented gap, not a
  regression.
- The formal ≥50-case RLS adversarial suite and a dedicated
  `tests/acceptance` directory (build-order item 9 in the original
  scaffold) were not built in this phase — this phase's scope was wiring,
  not expanding adversarial/acceptance test coverage beyond what already
  exists (5-case RLS smoke suite, golden-path + integration-wiring as the
  closest present equivalent to "acceptance tests"). Tracked honestly in
  PHASE_STATUS.md rather than claimed as done.
- No live OpenAI embeddings call and no live deployment infrastructure
  exist in this environment — same posture as every phase since ADR 0004.
  Nothing about `/costs`, `/memory/query`, or `/deployments*` needs to
  change when real credentials/infrastructure become available.
