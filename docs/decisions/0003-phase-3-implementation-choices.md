# ADR 0003 — Phase 3 implementation choices

**Status:** Accepted
**Date:** 2026-08-30

## Context

Phase 3 builds `services/agent-factory` (the automated agent lifecycle
pipeline) together with the two foundational packages the original scaffold
grouped alongside auth in build-order step 3: `packages/observability` and
`packages/policy-engine`. The user asked explicitly for full offline-first
compatibility and robust error handling.

## Decisions

1. **The automated pipeline (DRAFT → SANDBOX → TESTED → EVALUATED →
   APPROVED) is a separate concern from the human governance approval
   Phase 2 already built (`AGENT_ACTIVATE` + `POST
   /agents/{id}/versions/{v}/activate`, APPROVED → ACTIVE).** Reaching
   APPROVED means "the specification is complete and internally
   consistent enough to be worth a human's time" — an automated quality
   gate. It is not activation into production and does not bypass or
   duplicate the existing human-approval gate. The two systems compose:
   agent-factory gets an agent to APPROVED; control-plane-api's existing,
   already-tested endpoint takes it the rest of the way.

2. **Fully offline-first by construction, not by a special "offline mode."**
   Every pipeline step is DB queries plus pure computation — no HTTP call,
   no external service, nothing that can be "down." This falls out of two
   choices: Ajv (`schema-validation.ts`) validates JSON Schema documents
   entirely in-process, never resolving remote `$ref`s; and the
   evaluation score (`scoring.ts`) is an explicitly-labeled completeness
   heuristic rather than a real capability evaluation, because a real one
   would require calling an LLM provider — which doesn't exist yet
   (model-router-gateway, build-order step 6) and would make the pipeline
   depend on network reachability. The only hard dependency is Postgres.

3. **`packages/policy-engine`'s evaluator is a pure function — no I/O.**
   `evaluatePolicy(input, tenantRules)` takes already-loaded rules and
   returns a decision synchronously; `parsePolicyRules` (loading
   `policy_registry.rules` from the DB) and `recordPolicyDecision` (writing
   to `policy_decision_records`) are separate, explicit functions the
   caller wires together. This keeps the decision logic itself trivially
   unit-testable (11 tests, no database) while still giving services a
   real DB-backed audit trail when they want one.

4. **A policy decision that blocks an action must still be recorded, even
   though the action itself is rolled back.** `advanceToSandbox` runs in
   two separate transactions, not one: the first evaluates the policy and
   commits the `policy_decision_records` row unconditionally; only if the
   decision is `ALLOW` does a second transaction attempt the actual state
   change. A single-transaction version was tried first and failed its own
   test — the ROLLBACK on a blocked transition was silently erasing the
   audit trail along with it, which is backwards for a governance record
   (a blocked/denied decision is exactly the one you most need on record).

5. **Typed errors throughout, no bare `throw new Error(...)`.**
   `AgentFactoryError` carries a `code` (`NOT_FOUND`, `INVALID_TRANSITION`,
   `POLICY_BLOCKED`, `SANDBOX_VALIDATION_FAILED`, `SCHEMA_VALIDATION_FAILED`,
   `QUALITY_GATE_FAILED`) mirroring the `ApiError`/`AuthError` pattern from
   Phases 1–2. `runFullPipeline` catches each step's error, logs it via
   `@ai-office/observability`, and returns a structured result
   (`reachedState`, `evaluationScore`, `stoppedAt`) instead of throwing
   past the caller — a background worker (or the CLI) can always tell
   exactly how far an agent got and why it stopped, without a stack trace
   being the only signal.

6. **`packages/observability` has its own `AsyncLocalStorage` context, not
   a reuse of `@ai-office/auth`'s tenant-context.** A CLI invocation like
   agent-factory's has no HTTP request and no JWT at all, but still wants
   correlated log lines. Coupling the logger to auth's principal types
   would make it unusable outside a request. It writes structured JSON to
   stdout (debug/info) or stderr (warn/error) only — no network telemetry
   backend, matching the offline-first requirement and blueprint clause 74
   (real log shipping is an infrastructure-layer concern, out of scope
   here).

## Consequences

- `services/control-plane-api`'s own inline `console.error` in its error
  handler now goes through the same `@ai-office/observability` logger —
  the first proof this is a genuinely shared package, not a
  service-specific one.
- The pipeline's completeness score (`scoring.ts`) and the policy engine's
  built-in rules (`rules.ts`) are both explicitly documented as
  placeholders a later phase should replace with something backed by real
  execution — the same evidence discipline `PHASE_STATUS.md` has applied
  since Phase 1.
- Every pipeline step being its own transaction means partial progress
  survives a mid-pipeline failure — an agent that fails at TESTED stays at
  SANDBOX, it does not revert to DRAFT. A retry only needs to resume from
  wherever it stopped.
