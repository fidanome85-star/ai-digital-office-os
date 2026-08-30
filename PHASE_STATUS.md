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

## What has NOT been built yet (both phases)

- No agent actually executes anything — no LLM provider call, no prompt
  sent anywhere. Agents, tasks and workflows are governed *records*, not
  running processes yet (that's `services/agent-factory`,
  `services/workflow-engine` — build-order steps 5 and 7).
- `packages/observability`, `packages/policy-engine`, `packages/shared-types`
  are still empty scaffolding (their `README.md` only).
- No production secrets, IaC, or deployment topology (explicitly out of
  scope per blueprint clause 74 and the scaffold's own "what NOT to build
  here").
- Production must NOT use the dev passwords in `.env.example` / migration
  0022 — those exist for local dev and CI only.
- `release_registry` has no creation endpoint in the v1.4 OpenAPI contract
  — `POST /deployments` requires one to already exist (a gap in the spec
  itself, documented rather than silently worked around; see ADR 0002 §5).

## Next phase

**Phase 3 — `services/agent-factory`**: the agent lifecycle pipeline
(DRAFT → SANDBOX → TESTED → EVALUATED → APPROVED → ACTIVE), depends on
control-plane-api's `/agents/*` and `/approvals/*` endpoints existing —
which they now do. This is also the natural point to build out
`packages/policy-engine` and `packages/observability` for real, since
agent-factory needs both.
