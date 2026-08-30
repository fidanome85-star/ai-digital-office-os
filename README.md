# AI Digital Office OS

Multi-tenant AI orchestration platform: a control-plane API, agent factory,
model router, workflow engine, and policy engine for running governed AI
agents inside an organization. Specification: `docs/blueprint/` (v1.4
consolidated master + integrity review + acceptance checklist).

**Status: Phase 1 of 9 complete.** See `PHASE_STATUS.md` for exactly what
is built, tested and verified versus what is still a TARGET. Nothing below
Phase 1 in the build order exists as running code yet — this repo does not
yet run an agent.

## Build order

This repo is built in the order the v1.4 integrity review specifies (see
`docs/blueprint/V1.4_TECHNICAL_INTEGRITY_REVIEW.md`, "Recommended build
order"), one phase at a time, each verified before the next starts:

1. **`packages/db`** — schema + migrations ✅ done
2. **`packages/domain-model`** — canonical types generated from the schema ✅ done
3. **`packages/auth`** (+ observability, policy-engine) — auth ✅ done, the other two still empty scaffolding
4. **`services/control-plane-api`** — not started
5. **`services/agent-factory`** — not started
6. **`services/model-router-gateway`**, **`services/tool-gateway-mcp`** — not started
7. **`services/workflow-engine`** — not started
8. **`services/memory-service`**, **`services/cost-usage-service`**, **`services/deployment-orchestrator`**, **`services/policy-engine-service`** — not started
9. **`tests/rls-adversarial`** (full suite), **`tests/acceptance`** — partial (smoke-level RLS test only)

## Local development

Requires Node 20+, pnpm, and a PostgreSQL 16 + pgvector instance.

```bash
cp .env.example .env          # adjust if not using the default docker-compose creds
pnpm install
pnpm db:up                    # docker compose: postgres+pgvector on :5432
pnpm db:migrate                # applies packages/db/migrations/*.sql in order
pnpm domain-model:generate     # regenerates packages/domain-model/src/generated/tables.ts
pnpm typecheck
pnpm --filter @ai-office/auth run test
pnpm test:rls-adversarial      # requires APP_DATABASE_URL (the ai_office_app role, not the owner)
```

If Docker isn't available in your environment, point `DATABASE_URL` /
`APP_DATABASE_URL` at any local Postgres 16+ with the `pgvector` and
`uuid-ossp` extensions installed and run the same `pnpm` commands — the
migration runner and tests don't depend on docker-compose itself, only on
a reachable Postgres.

## Repository layout

```
docs/            specification (read-only reference — do not "implement" this folder)
packages/        shared code used by more than one service (db, domain-model, auth, ...)
services/        independently deployable services, one per blueprint subsystem
agents/          agent specifications (product-agnostic — no agent ships in this repo yet)
tests/           cross-cutting tests: integration, rls-adversarial, acceptance
infra/           docker-compose for local Postgres; real IaC is a separate future package
scripts/         setup/migrate/seed convenience scripts
```

See each folder's own `README.md` for what belongs there and what phase
will fill it in.
