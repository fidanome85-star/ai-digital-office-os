# ADR 0011 — Real model-evaluation harness

**Status:** Accepted
**Date:** 2026-08-31

## Context

`POST /models/evaluate` has, since Phase 2, been a documented placeholder:
it persisted a real `model_evaluation_runs` row but carried
`model_registry.evaluation_score` forward unchanged rather than measuring
anything — explicitly because no benchmark harness existed yet, and that
harness needed `model-router-gateway`'s `executeModelRun` (build-order
step 6), which didn't exist at the time. `executeModelRun` has existed
since Phase 4. `PHASE_STATUS.md`'s "What has NOT been built yet" section
kept flagging this exact gap — "a future phase could replace it with a
real evaluation that actually calls a model" — through every subsequent
phase without anyone doing it. This phase does it.

## Decisions

1. **The score measures execution reliability, not answer correctness —
   and this is a considered choice, not a limitation to apologize for.**
   `runBenchmarkSuite` (new, `model-router-gateway/src/evaluate.ts`) runs
   a small, fixed set of real prompts through the real `executeModelRun`
   path (real retries, real `model_runs`/`usage_events` rows) and scores
   the fraction that completed without error. Judging whether a response
   is actually *correct* would require a second, equally fallible model
   to grade the first one's output — that's not a real measurement, it's
   one placeholder wearing another placeholder's clothes. Execution
   reliability is concretely true and directly observable: did the
   adapter/provider/retry path actually work for real prompts. Every
   persisted result's `results.note` says exactly this, so nothing reading
   the score back mistakes it for a capability grade.

2. **Every case's failure is caught and recorded, never left to abort the
   whole suite.** An unsupported or misconfigured `adapter_type` (a
   realistic failure mode — the `test-adapter` fixture value used
   throughout this repo's own tests isn't a registered adapter) produces
   a real 0% score with the real error message attached to that case, not
   a crashed endpoint. A benchmark run should always finish and report
   what it found, matching the "return a structured result" house style
   used everywhere else in this codebase.

3. **The default prompt set is small, fixed, and capability-agnostic on
   purpose** — three generic prompts, not a per-capability
   (coding/reasoning/tool-use) suite. Building a real, meaningful
   per-capability benchmark corpus is a genuinely separate, much larger
   undertaking (curating real test cases with real, defensible expected
   behavior per capability) that this phase doesn't attempt to fake with
   a handful of made-up examples — an optional `prompts` array (additive
   OpenAPI field) lets a caller supply their own set when they have one,
   without this codebase pretending to ship a benchmark corpus it
   doesn't have.

4. **`model_evaluation_metrics` — a table that existed since Phase 1's
   integrity-closure migration but nothing had ever written to — now
   gets real rows: `success_rate`, `avg_latency_ms`,
   `avg_output_tokens`.** This is the first real use of the per-metric
   breakdown the schema's own comment says it exists for ("a single
   evaluation_id can carry more than one named metric").

5. **The endpoint's existing transaction shape is unchanged: the whole
   handler (model lookup, benchmark run, `model_evaluation_runs`/
   `model_evaluation_metrics` inserts) still runs inside one
   `withIdempotentWrite` transaction**, even though `runBenchmarkSuite`
   makes pool-level calls (via `executeModelRun`) that hold the
   surrounding transaction open while they run. This differs from Phase
   7's `advanceDeployment` wiring, which was deliberately moved *after*
   its triggering transaction committed specifically because a real HTTP
   health check can take an unbounded, network-dependent amount of time.
   Here, every case in this environment resolves in milliseconds (no live
   provider credentials exist to call — same posture as every
   network-touching piece since ADR 0004) via `local-echo` or a fast
   failure, so the transaction stays open only briefly. If real,
   live-network provider calls are ever wired into this environment, this
   shape should be revisited the same way `advanceDeployment` was.

## Consequences

- `POST /models/evaluate` and `services/model-router-gateway` are now
  cross-service dependencies, the same shape `workflow-engine` already
  established with `model-router-gateway`/`tool-gateway-mcp` (ADR 0005
  §1) — real logic built once, reused, not reimplemented.
- Existing tests exercising `/models/evaluate` (`golden-path.test.ts`,
  which seeds a `test-adapter` provider — not a registered adapter type)
  now genuinely exercise the failure path of the new harness rather than
  a placeholder; the test's own assertions (status 202, a history row
  exists) still hold, since neither ever asserted on the specific score
  value. Its cleanup needed two additions this change surfaced: deleting
  `model_evaluation_metrics` before `model_evaluation_runs`, and deleting
  `model_runs` before `model_registry` — real FK constraints that were
  simply never exercised by this test file before, not new constraints.
- No live provider credentials exist in this environment, so every
  benchmark run here executes against `local-echo` or fails fast on an
  unsupported adapter — same "real code, no live call yet" posture as
  everything since ADR 0004. Nothing about the harness needs to change
  when real credentials arrive.
