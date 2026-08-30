# ADR 0006 — Phase 6 implementation choices

**Status:** Accepted
**Date:** 2026-08-30

## Context

Phase 6 builds the last four build-order-8 services from the implementation
scaffold: `services/memory-service`, `services/cost-usage-service`,
`services/deployment-orchestrator`, and `services/policy-engine-service`.
Unlike Phases 2–5, none of these were previously scaffolded with any real
logic — each started from an empty `src/` with only a one-line
`README.md` describing intent. All four are library packages (no HTTP
server of their own), following the same shape `packages/policy-engine`
and `packages/observability` established: exported functions taking a
`Pool` and `tenantId`, tested directly against real Postgres via
`withTenantTransaction`.

## Decisions

1. **No fake "local" embedding adapter.** Every other network-touching
   adapter in this repo (Phase 4's model/MCP adapters) has a real,
   protocol-correct implementation tested against a local mock server —
   never a stub baked into production code. Embeddings are different in
   one important way: a fake embedding function (e.g. a hash of the input
   text mapped onto a unit vector) would still *produce* a syntactically
   valid 1536-dimension vector that pgvector happily indexes and ranks —
   but the resulting "similarity" scores would be meaningless, and nothing
   about the code would signal that. That's a worse failure mode than an
   honest gap: a real bug (mixing incompatible embedding spaces, say)
   could hide behind fake-but-plausible-looking scores. So
   `services/memory-service` ships exactly one embedding adapter
   (`OpenAiEmbeddingAdapter`, real `/v1/embeddings` request/response
   shape, tested against a mock server) and no offline fallback. The
   pgvector plumbing itself is proven correct using mathematically
   controlled unit vectors instead — see `test/semantic.test.ts`'s
   `unitVector(index)` helper, which exercises real `embedding <=>
   $1::vector` ranking without needing real semantic meaning.

2. **`getCostSummary` is honest about missing budget configuration.**
   Phase 2 shipped `GET /costs` as a placeholder that always returned
   `budget_status: "OK"` — there was no table to compare actual spend
   against. `budget_tiers` (migration 0024) closes that gap, and
   `getCostSummary` computes a real four-state progression
   (`OK`/`WARNING`/`SOFT_LIMIT`/`HARD_LIMIT`) from actual summed
   `usage_events` against a tenant's configured tier. When no tier is
   configured, the function returns `budgetTier: null` alongside `"OK"` —
   still honest ("nothing to compare against"), not a silent claim that
   spend has been checked and is fine.

3. **Deployment health checks never throw — a network failure is data, not
   an exception.** `HttpHealthChecker.check()` catches every failure mode
   (non-2xx, timeout via `AbortController`, DNS/connection errors) and
   returns `{ healthy: false, detail }` in every case. This keeps
   `advanceDeployment`/`rollbackDeployment` from needing a separate
   try/catch around the health check itself — "the deployment is
   unhealthy" and "the health check couldn't complete" are the same
   outcome from the orchestrator's point of view.

4. **A rollback only commits once the replacement is proven healthy.**
   `rollbackDeployment` creates a *new* `deployment_registry` row
   targeting `rollback_target`, health-checks that new row for real, and
   only then updates the original row's status to `ROLLED_BACK` — and only
   in the success case. If the new deployment's own health check fails,
   the original deployment's status is left completely untouched, because
   nothing was actually rolled back yet; the caller sees a `FAILED` result
   and can retry or escalate. This mirrors Phase 3's two-transaction
   "audit survives block" pattern in spirit (never let a write claim
   something succeeded when the thing it depended on didn't) even though
   the mechanism here is a status-write ordering rather than a policy
   decision.

5. **`upsertPolicy` validates through `@ai-office/policy-engine`'s own
   parser before writing anything — the 4th real consumer of
   policy-engine** (after control-plane-api, agent-factory, and
   tool-gateway-mcp). `evaluatePolicy` has no way to reject a bad rule at
   decision time; a malformed `policy_registry.rules` entry there just
   fails closed for every subsequent decision. Rejecting at write time,
   with a specific error naming which rule and why, is the only point a
   policy author can get useful feedback. Every write also goes through
   `withTenantTransaction`, whose RLS `WITH CHECK` makes it structurally
   impossible for this service to create a NULL-tenant global-default
   policy — those can only be seeded by the migration-owner role directly
   (as `DEFAULT_RULES`/the blueprint's global policies already are).
   `policy-engine-service` only ever manages tenant-scoped overrides.

6. **`expirePendingApprovals` closes a real OpenAPI contract gap.**
   `ApprovalRecord.decision` has always included `EXPIRED` in its enum,
   but nothing in Phase 2's control-plane-api ever set it — an approval
   request past its `expires_at` with no human decision would sit as
   `decision: null` forever, indistinguishable from one nobody has looked
   at yet. The sweep is a plain `UPDATE ... WHERE decision IS NULL AND
   expires_at <= now()`, tenant-scoped like every other sweep in this
   codebase (`purgeExpiredWorkingMemory`, Phase 6 §1's working-memory TTL
   purge) — correctness never depends on the sweep having run recently,
   only storage/UX hygiene does.

## Consequences

- All four Phase 6 services are library packages only — none expose an
  HTTP route. control-plane-api's Phase 2 placeholder handlers
  (`/memory/query`, `/costs`, `/deployments/*`) still contain their
  original placeholder logic; wiring them to call into these new packages
  is deliberately left to a future integration pass rather than done
  here, to keep this phase's scope to "the services exist and are proven
  correct against real Postgres," matching how Phases 3–5 were sequenced
  (build the service, prove it, wire it in later where relevant).
- Neither sweep function (`expirePendingApprovals`,
  `purgeExpiredWorkingMemory`) is invoked by anything in this repo yet — no
  cron, no scheduler. Both are correct and tested in isolation; a future
  phase wiring one in needs no changes to either function itself.
- No live OpenAI embeddings call, and no live deployment infrastructure to
  health-check, exists in this environment — same "no credentials/infra by
  design" posture as every network-touching piece since Phase 4 (ADR 0004
  §1). All four adapters/checkers need no code changes to point at a real
  endpoint once one exists.
