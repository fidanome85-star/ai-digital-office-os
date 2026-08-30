# Phase status

Follows the evidence discipline required by
`docs/blueprint/implementation_acceptance_checklist_v1.4.md`: every item is
labeled **TARGET** (spec only), **TEST REQUIRED** (built, not yet proven),
or **VERIFIED** (built and proven by a test that actually ran). Nothing is
marked VERIFIED without the command that proves it.

## Phase 1 — DB schema, domain model, auth (this delivery)

| Item | Status | Evidence |
|---|---|---|
| All 22 blueprint migrations + 1 new one (app role) apply cleanly | VERIFIED | `pnpm db:migrate` — 23/23 applied against Postgres 16 + pgvector, zero errors |
| 41 blueprint tables exist (42 incl. `schema_migrations`) | VERIFIED | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` → 42 |
| RLS active on every tenant-scoped table | VERIFIED | 34/34 tables with a `tenant_id` column have `rowsecurity=true`; the other 7 (`users`, `permissions`, `provider_registry`, `model_registry`, `tool_registry`, `model_evaluation_runs`, `model_evaluation_metrics`) have no `tenant_id` column at all — confirmed by querying `information_schema.columns`, they are genuinely global catalogs, not a gap |
| RLS has both USING and WITH CHECK on every policy | VERIFIED | `SELECT count(*) FROM pg_policies WHERE qual IS NULL OR with_check IS NULL` → 0 |
| Cross-tenant INSERT forgery is rejected | VERIFIED | `pnpm test:rls-adversarial` — 5/5 passing, run as the non-owning `ai_office_app` role against real Postgres |
| Cross-tenant SELECT/UPDATE/DELETE isolation | VERIFIED | same suite — covers `organizations` (tenant root) and `project_registry` (dependent table) |
| Full ≥50-case adversarial suite (checklist item) | TARGET | only 2 tables covered so far; extend `tests/rls-adversarial/` as each service starts writing tenant data |
| Domain model generated from schema, not hand-duplicated | VERIFIED | `pnpm domain-model:generate` — 41 interfaces generated from live `information_schema`, `tsc --noEmit` passes |
| Domain-model/SQL drift gate | VERIFIED (locally) / TEST REQUIRED (CI) | CI step re-generates and `git diff --exit-code`s the result — not yet run in a real CI execution, only written and reasoned through |
| JWT verification: issuer, audience, JWKS rotation, clock skew | VERIFIED | `pnpm --filter @ai-office/auth run test` — 10/10, including expired-token and wrong-audience rejection with real signed JWTs against a local JWKS |
| Human vs. service principal distinction | VERIFIED | same suite — `principal_type` claim required and mapped to `HumanPrincipal`/`ServicePrincipal` |
| Tenant context propagation (`AsyncLocalStorage`) | VERIFIED | same suite — includes a concurrency test proving two simultaneous "requests" don't leak tenant context into each other |
| Auth wired into a real running service | TARGET | no service exists yet to wire it into (Phase 2) |
| CI runs all of the above on every push | TEST REQUIRED | `.github/workflows/ci.yml` written, mirrors every local command above; not yet observed running green on GitHub's runners as of this commit |

## What Phase 1 deliberately does NOT include

- No control-plane-api, no running HTTP service of any kind.
- No agent, no LLM provider call, no prompt.
- `packages/observability`, `packages/policy-engine`, `packages/shared-types`
  are still empty scaffolding (their `README.md` only) — next in the build
  order (step 3) but not required to unblock step 4.
- No production secrets, IaC, or deployment topology (explicitly out of
  scope per blueprint clause 74 and the scaffold's own "what NOT to build
  here").
- Production must NOT use the dev passwords in `.env.example` / migration
  0022 — those exist for local dev and CI only.

## Next phase

**Phase 2 — `services/control-plane-api`**: implement the OpenAPI contract
in `services/control-plane-api/openapi/control_plane_openapi_v1.4.yaml`
against `packages/db` + `packages/domain-model`, using `packages/auth` for
every endpoint. First end-to-end smoke-testable milestone per the
scaffold's own build order (`/projects`, `/tenants/current`, etc.).
