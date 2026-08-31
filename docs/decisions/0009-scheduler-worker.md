# ADR 0009 — services/scheduler-worker

**Status:** Accepted
**Date:** 2026-08-31

## Context

Every phase since Phase 6 flagged the same honest gap: `expirePendingApprovals`
(`@ai-office/policy-engine-service`) and `purgeExpiredWorkingMemory`
(`@ai-office/memory-service`) were correct, tested, tenant-scoped sweep
functions that nothing in the repo ever actually invoked periodically.
Phase 7 wired `expirePendingApprovals` into `GET /approvals` as a
lazy, at-read-time sweep, but that only fires when someone happens to
list approvals for a given tenant — `purgeExpiredWorkingMemory` had no
such hook at all, and neither is guaranteed to run for a quiet tenant
nobody is actively calling. This phase adds the piece both were missing:
something that calls them on its own schedule, for every tenant, whether
or not a request happens to trigger it.

## Decisions

1. **A new service, not an addition to an existing one.** Both sweep
   functions already live in their own services
   (`policy-engine-service`, `memory-service`); a scheduler that calls
   both doesn't conceptually belong inside either one. `services/
   scheduler-worker` depends on both as libraries — the same shape
   `workflow-engine` already established, depending on
   `model-router-gateway` and `tool-gateway-mcp` directly (ADR 0005 §1)
   — rather than duplicating their logic or picking one arbitrarily to
   own the other.

2. **Listing tenants requires an owner-role connection — a legitimate,
   narrow RLS bypass, not a workaround.** No single tenant session can
   `SELECT tenant_id FROM organizations` and see every tenant (RLS
   correctly forbids it); a scheduler that must sweep *every* tenant
   needs to know the full set first. `listTenantIds` uses the owner-role
   `Client` (`DATABASE_URL`) purely to read that list — every actual
   sweep write still goes through `expirePendingApprovals`/
   `purgeExpiredWorkingMemory`'s own `withTenantTransaction`, using the
   app role (`APP_DATABASE_URL`), exactly as every other real write in
   this codebase does. This is the same owner-vs-app-role split every
   test fixture in the repo already relies on (`createOwnerClient` for
   cross-tenant setup, the app pool for anything RLS should actually
   govern) — here used for a genuine operational read, not a test
   convenience.

3. **One tenant's sweep failure doesn't stop the others'.**
   `runSweepOnce` catches and logs per-tenant, per-function errors rather
   than letting one bad row abort the whole pass — the same
   "return a structured result, don't throw past the caller" house style
   as `runFullPipeline` (agent-factory) and `advanceDeployment`
   (deployment-orchestrator). A scheduler serving many tenants must not
   let tenant B's edge case block tenant A's sweep from ever running.

4. **`startScheduler` is a plain `setInterval` loop — the minimal real
   scheduler this environment has infrastructure for.** No job queue, no
   distributed lock, no IaC — all explicitly out of scope per blueprint
   clause 74 and every prior phase's "what NOT to build here" (ADR 0006,
   0007). `runSweepOnce` is the seam: a production deployment pointing a
   managed trigger (a k8s `CronJob`, a cloud scheduler function, a
   systemd timer) at the same function needs no code change, same as
   `SecretResolver` in ADR 0004/0007. Running exactly one instance of
   this process is assumed — nothing here coordinates multiple concurrent
   schedulers (no advisory lock), because nothing in this repo's
   deployment story runs more than one yet.

5. **The CLI has two modes, matching agent-factory's `cli.ts` precedent:**
   a one-shot `pnpm --filter @ai-office/scheduler-worker run sweep` (runs
   `runSweepOnce` once and exits — useful for an external cron calling
   this process directly) and a long-running `run sweep:loop`
   (`startScheduler`, with `SWEEP_INTERVAL_MS` configurable, default 5
   minutes, graceful `SIGTERM`/`SIGINT` shutdown). Both share the same
   `main()` structure and error handling as `agent-factory/src/cli.ts`.

## Consequences

- Running the test suite for this service concurrently with itself
  surfaces a real property of the design, not a bug: `runSweepOnce`
  operates over *every* tenant in the database, so `sweeps.test.ts` and
  `scheduler.test.ts` running as concurrent processes against the same
  shared Postgres instance can race to sweep the same overdue row —
  whichever call reaches it first legitimately claims it in that pass's
  count, and the other correctly reports zero. `sweeps.test.ts` asserts
  the resulting tenant-scoped DB state (which is correct regardless of
  which process performed the sweep) rather than the aggregate count
  returned by any one call, which is the only way to test a genuinely
  cross-tenant, globally-scoped sweep from two independent test files
  without asserting something dependent on execution order.
- `purgeExpiredWorkingMemory` and `expirePendingApprovals` are now both
  invoked on a real schedule when `scheduler-worker` is run in loop mode
  — the last item on every prior phase's "not wired to anything" list is
  closed. `expirePendingApprovals`'s existing lazy hook on `GET
  /approvals` (Phase 7) is unaffected and still fires independently.
- No live cron/systemd/k8s deployment of this process exists in this
  environment (same "no IaC here" posture as everything else) — an
  operator wiring this in needs only to run `sweep:loop` (or point an
  external trigger at `sweep`) with `DATABASE_URL`/`APP_DATABASE_URL`
  set, no code changes.
