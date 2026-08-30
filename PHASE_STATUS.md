# Phase status

Follows the evidence discipline required by
`docs/blueprint/implementation_acceptance_checklist_v1.4.md`: every item is
labeled **TARGET** (spec only), **TEST REQUIRED** (built, not yet proven),
or **VERIFIED** (built and proven by a test that actually ran). Nothing is
marked VERIFIED without the command that proves it.

## Phase 1 — DB schema, domain model, auth

| Item | Status | Evidence |
|---|---|---|
| All blueprint migrations + closure migrations apply cleanly | VERIFIED | `pnpm db:migrate` — 24/24 applied against Postgres 16 + pgvector, zero errors |
| 42 tables exist (43 incl. `schema_migrations`) | VERIFIED | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` → 43 |
| RLS active on every tenant-scoped table | VERIFIED | 35/35 tables with a `tenant_id` column have `rowsecurity=true`; the other 7 (`users`, `permissions`, `provider_registry`, `model_registry`, `tool_registry`, `model_evaluation_runs`, `model_evaluation_metrics`) have no `tenant_id` column at all — confirmed by querying `information_schema.columns`, they are genuinely global catalogs, not a gap |
| RLS has both USING and WITH CHECK on every policy | VERIFIED | `SELECT count(*) FROM pg_policies WHERE qual IS NULL OR with_check IS NULL` → 0 |
| Cross-tenant INSERT forgery is rejected | VERIFIED | `pnpm test:rls-adversarial` — 5/5 passing, run as the non-owning `ai_office_app` role against real Postgres |
| Cross-tenant SELECT/UPDATE/DELETE isolation | VERIFIED | same suite — covers `organizations` (tenant root) and `project_registry` (dependent table) |
| Full ≥50-case adversarial suite (checklist item) | TARGET | only 2 tables covered so far; extend `tests/rls-adversarial/` as each service starts writing tenant data |
| Domain model generated from schema, not hand-duplicated | VERIFIED | `pnpm domain-model:generate` — 42 interfaces generated from live `information_schema`, `tsc --noEmit` passes |
| Domain-model/SQL drift gate | VERIFIED (locally) / TEST REQUIRED (CI) | CI step re-generates and `git diff --exit-code`s the result — not yet run in a real CI execution, only written and reasoned through |
| JWT verification: issuer, audience, JWKS rotation, clock skew | VERIFIED | `pnpm --filter @ai-office/auth run test` — 10/10, including expired-token and wrong-audience rejection with real signed JWTs against a local JWKS |
| Human vs. service principal distinction | VERIFIED | same suite — `principal_type` claim required and mapped to `HumanPrincipal`/`ServicePrincipal` |
| Tenant context propagation (`AsyncLocalStorage`) | VERIFIED | same suite — includes a concurrency test proving two simultaneous "requests" don't leak tenant context into each other |
| Auth wired into a real running service | VERIFIED (Phase 2) | see below |
| CI runs all of the above on every push | TEST REQUIRED | `.github/workflows/ci.yml` written, mirrors every local command below; not yet observed running green on GitHub's runners as of this commit (see note at the bottom) |

## Phase 2 — services/control-plane-api (all 40 OpenAPI paths / 48 operations)

| Item | Status | Evidence |
|---|---|---|
| Every OpenAPI operation has a bound route | VERIFIED | `tests/openapi-coverage.test.ts` — parses the YAML, asserts all 48 operations across 40 paths resolve to a registered Express route; asserts the count is exactly 48 |
| Two duplicate-YAML-key spec bugs fixed (`/artifacts`, `/agents/{id}/messages`) | VERIFIED | same test — would fail at 46/48 if either regressed; see ADR 0002 §1 |
| Auth (JWT → tenant context → RLS) wired into a real service, end to end | VERIFIED | `tests/tenants.test.ts` — real signed JWT, real HTTP request, real Postgres query, RLS-scoped result |
| Cross-tenant isolation at the API layer (not just direct DB access) | VERIFIED | same suite — a token for tenant B gets 404 on tenant A's `/tenants/current` |
| Full realistic flow: project → agent → version → approval → activation → task → workflow → artifact lineage → routing → evaluation → catalogs → flags → secrets → usage/costs → deployment → memory | VERIFIED | `tests/golden-path.test.ts` — 24 sequential assertions, real running server + real Postgres, one continuous tenant |
| Idempotency-Key replay returns the original result, not a duplicate | VERIFIED | golden path's "retrying task creation" case — same key, same task returned |
| Idempotency-Key enforced on every POST/PATCH/DELETE (not just the subset the spec `$ref`s) | VERIFIED | `requireIdempotencyKey` middleware is global; see ADR 0002 §2 for why |
| Agent version activation requires a prior APPROVED `AGENT_ACTIVATE` approval | VERIFIED | golden path — activation attempt without approval returns 403 `POLICY_ERROR`; succeeds only after the approval is created and decided |
| Workflow state machine rejects invalid transitions | VERIFIED | golden path — resuming an `ESCALATED` workflow returns 409, not a silent no-op |
| Capability-based model routing (rule-based, not cost/latency-aware) | VERIFIED as built | golden path — ALLOW when a capable model exists, 403 `POLICY_ERROR` when none does; real scope, honestly simple algorithm (see ADR 0002 §5) |
| Model evaluation, memory query, cost summary | VERIFIED as built | golden path exercises all three; each has a documented placeholder limit (no benchmark harness / no embedding provider / no budget table) — see ADR 0002 §5 |
| RLS still enforced with the two new closure tables (`api_idempotency_keys`) | VERIFIED | `pnpm db:migrate` shows `api_idempotency_keys` created with RLS by migration 0023; exercised implicitly by every idempotent write in the golden path |
| CI runs the full test suite (Phase 1 + Phase 2) on every push | TEST REQUIRED | `.github/workflows/ci.yml` updated; same "not yet observed on GitHub's runners" caveat as Phase 1 |

## Phase 3 — services/agent-factory, packages/observability, packages/policy-engine

| Item | Status | Evidence |
|---|---|---|
| Structured logging (JSON to stdout/stderr, no network dependency) | VERIFIED | `pnpm --filter @ai-office/observability run test` — 4/4, asserts JSON shape and stdout/stderr routing by level |
| Correlation-id / tenant-id context propagation | VERIFIED | same suite — attached when a context is active, cleanly absent when not |
| Span timing helper (`withSpan`) logs start/success/failure with duration | VERIFIED | `pnpm --filter @ai-office/observability run test` — 2/2, including the error-re-throw case |
| Wired into a second real service (not just written once) | VERIFIED | `services/control-plane-api/src/errors.ts`'s unhandled-error path and every `services/agent-factory` pipeline step now log through `@ai-office/observability` — control-plane-api's full 30-test suite still passes with this wired in |
| Policy engine: pure GREEN/YELLOW/RED rule evaluation, no I/O | VERIFIED | `pnpm --filter @ai-office/policy-engine run test` — 11/11 |
| Tenant-specific rules override defaults by specificity | VERIFIED | same suite — exact action+risk rule beats a wildcard rule beats the built-in default |
| Malformed `policy_registry.rules` JSONB fails closed, not silently ignored | VERIFIED | same suite — `parsePolicyRules` throws `PolicyEngineError` on any malformed entry rather than dropping it |
| Agent lifecycle: DRAFT → SANDBOX (policy gate + tool-reference integrity) | VERIFIED | `pnpm --filter @ai-office/agent-factory run test` — RED-security agent blocked with `POLICY_BLOCKED`, decision recorded in `policy_decision_records`; agent referencing a nonexistent tool blocked with `SANDBOX_VALIDATION_FAILED` |
| A blocked policy decision is still recorded, even though the state change rolls back | VERIFIED | same suite — required restructuring `advanceToSandbox` into two transactions after the single-transaction version failed exactly this test; see ADR 0003 §4 |
| SANDBOX → TESTED (JSON Schema structural validation, fully offline via Ajv) | VERIFIED | same suite — a schema with `{"type": 123}` is rejected with `SCHEMA_VALIDATION_FAILED` |
| TESTED → EVALUATED (completeness scoring) and EVALUATED → APPROVED (quality gate) | VERIFIED | same suite — a well-formed agent reaches APPROVED with score ≥ 60; a minimal one stops at EVALUATED with `QUALITY_GATE_FAILED` |
| `runFullPipeline` preserves partial progress on failure, doesn't throw past the caller | VERIFIED | same suite — the low-score case returns `{reachedState: "EVALUATED", stoppedAt: {...}}` rather than throwing, and the agent is left at EVALUATED, not reverted to DRAFT |
| CLI entrypoint (`pnpm --filter @ai-office/agent-factory run process -- <tenant> <agent>`) | VERIFIED | manual run against real Postgres: exit code 0, agent reached APPROVED with score 90, logged via observability throughout |
| Fully offline-first (no network call anywhere in the pipeline) | VERIFIED by construction | Ajv validates schemas in-process; scoring is a local heuristic; the only dependency is a reachable Postgres — see ADR 0003 §2 |
| APPROVED → ACTIVE (human `AGENT_ACTIVATE` governance) | VERIFIED (Phase 2, unchanged) | agent-factory does not duplicate or bypass this — see ADR 0003 §1 |
| CI runs the full test suite (Phases 1–3) on every push | TEST REQUIRED | `.github/workflows/ci.yml` updated; same "not yet observed on GitHub's runners" caveat as Phases 1–2 |

## Phase 4 — services/model-router-gateway, services/tool-gateway-mcp

| Item | Status | Evidence |
|---|---|---|
| OpenAI adapter: real request shape, auth header, response parsing | VERIFIED against mock server | `pnpm --filter @ai-office/model-router-gateway run test` — sends correct `/chat/completions` body and `Bearer` header, parses `choices[0].message.content` + token usage, maps 429→retryable `RATE_LIMITED`, malformed body→`INVALID_RESPONSE` |
| Anthropic adapter: real request shape, auth header, response parsing | VERIFIED against mock server | same suite — `x-api-key`/`anthropic-version` headers, `/messages` body shape, 500→retryable `PROVIDER_ERROR` |
| Gemini adapter: real request shape, auth header, response parsing | VERIFIED against mock server | same suite — `x-goog-api-key` header, `:generateContent` path, 401→non-retryable `PROVIDER_ERROR` |
| Local adapter: fully offline, deterministic, zero network calls | VERIFIED | same suite — no mock server involved at all |
| Live call against a real hosted provider (OpenAI/Anthropic/Gemini) | TARGET | no API key configured in this environment by design — see ADR 0004 §1; adapter code needs no changes to support it |
| `executeModelRun`: provider/model lookup → model_runs → secret resolution → adapter call (with retry) → model_runs/usage_events update | VERIFIED | same suite — real Postgres, mock HTTP server for the `openai-chat` case, real cost computed from `cost_profile` (0.0007 for 10 input + 20 output tokens at $0.01/$0.03 per 1k) |
| A failed model run still leaves a `FAILED` model_runs row, not a lost attempt | VERIFIED | same suite — unsupported `adapter_type` case |
| Exponential-backoff retry, retryable vs. non-retryable errors respected | VERIFIED | `withRetry` — 4/4, including "stops at maxAttempts" and "does not retry a non-retryable error" |
| MCP client: real JSON-RPC 2.0 (`initialize`/`tools/list`/`tools/call`) over HTTP | VERIFIED against mock server | `pnpm --filter @ai-office/tool-gateway-mcp run test` — request id increments correctly, JSON-RPC `error` object → `MCP_PROTOCOL_ERROR`, unreachable server → retryable `MCP_UNREACHABLE` |
| agent_tool_bindings enforced as a hard gate (no binding = no access) | VERIFIED | same suite — no binding row, and binding-without-the-requested-action, both rejected with `BINDING_DENIED` |
| Tool calls policy-gated by risk_level (3rd real service using policy-engine) | VERIFIED | same suite — a RED-risk tool is blocked with `POLICY_BLOCKED`; the `REQUIRE_ESCALATION` decision is still recorded in `policy_decision_records` even though the call itself never reaches the MCP server |
| Every outcome (executed/blocked/failed) audited | VERIFIED | same suite — `audit_events` rows for `TOOL_CALL_EXECUTED`, `TOOL_CALL_BLOCKED`, `TOOL_CALL_FAILED` all asserted directly |
| Live call against a real MCP server | TARGET | no MCP server available in this environment by design — see ADR 0004 §5; client code needs no changes to support it |
| CI runs the full test suite (Phases 1–4) on every push | TEST REQUIRED | `.github/workflows/ci.yml` updated; same "not yet observed on GitHub's runners" caveat as Phases 1–3 |

## What has NOT been built yet

- No agent actually executes a multi-step task end to end — `executeModelRun`
  and `callTool` are real, tested, callable building blocks, but nothing
  yet orchestrates "agent receives a task → calls a model → calls a tool →
  produces an artifact" as one durable flow. That's
  `services/workflow-engine` (build-order step 7), the natural first
  caller of both.
- No live call has been made against a real hosted LLM provider or a real
  MCP server anywhere in this repo — by explicit choice this phase (see
  ADR 0004), not a limitation of the adapter/client code itself.
- `packages/shared-types` is still empty scaffolding (its `README.md`
  only) — small cross-cutting types not yet needed by anything built so
  far.
- The evaluation score in `services/agent-factory/src/scoring.ts` is a
  specification-completeness heuristic, not a real capability evaluation —
  same honesty discipline as Phase 2's `/models/evaluate` placeholder.
  Now that `executeModelRun` exists, a future phase could replace it with
  a real evaluation that actually calls a model — still not done here.
- No production secrets, IaC, or deployment topology (explicitly out of
  scope per blueprint clause 74 and the scaffold's own "what NOT to build
  here").
- Production must NOT use the dev passwords in `.env.example` / migration
  0022 — those exist for local dev and CI only.
- `release_registry` has no creation endpoint in the v1.4 OpenAPI contract
  — `POST /deployments` requires one to already exist (a gap in the spec
  itself, documented rather than silently worked around; see ADR 0002 §5).

## Next phase

**Phase 5 — `services/workflow-engine`**: durable, replayable multi-step
workflow execution (per `workflow_history`'s append-only event log design
from Phase 1) — the orchestrator that actually chains task → model call
→ tool call → artifact into one governed flow, using
`model-router-gateway` and `tool-gateway-mcp` as building blocks for the
first time.
