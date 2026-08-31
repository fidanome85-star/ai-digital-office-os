# AI Digital Office OS

Multi-tenant AI orchestration platform: a control-plane API, agent factory,
model router, workflow engine, and policy engine for running governed AI
agents inside an organization. Specification: `docs/blueprint/` (v1.4
consolidated master + integrity review + acceptance checklist).

**Status: Phase 7 of 9 complete — core system functionally complete
end-to-end.** See `PHASE_STATUS.md` for exactly what is built, tested and
verified versus what is still a TARGET. The control plane is a real,
tested, RLS-enforced HTTP API; agent specifications move through a real,
offline-first, policy-gated lifecycle pipeline; real provider adapters and
a real MCP client exist, tested against local mock servers;
workflow-engine durably chains them — model call → tool call → artifact —
into one replayable, resumable, pausable multi-step flow; all eight
build-order services exist with real, tested logic (tiered memory with
real pgvector semantic search, real budget-tier cost tracking,
health-checked deploy/rollback, policy CRUD + approval expiry); and
control-plane-api's endpoints now actually call through to that logic —
`GET /costs`, `POST /memory/query`, `POST /deployments`(`/rollback`), and
`GET /approvals` are wired to the real services, not standing in for them.
No live API key, MCP server, or deployment infrastructure has been wired
in yet (a deliberate choice, see `docs/decisions/0004`). What's left
(Phases 8–9) is hardening: the formal ≥50-case RLS adversarial suite and a
dedicated acceptance-test directory — see `PHASE_STATUS.md`'s "Next phase."

## Build order

This repo is built in the order the v1.4 integrity review specifies (see
`docs/blueprint/V1.4_TECHNICAL_INTEGRITY_REVIEW.md`, "Recommended build
order"), one phase at a time, each verified before the next starts:

1. **`packages/db`** — schema + migrations ✅ done
2. **`packages/domain-model`** — canonical types generated from the schema ✅ done
3. **`packages/auth`**, **`packages/observability`**, **`packages/policy-engine`** — ✅ done
4. **`services/control-plane-api`** — ✅ done (all 40 paths / 48 operations)
5. **`services/agent-factory`** — ✅ done (DRAFT → SANDBOX → TESTED → EVALUATED → APPROVED)
6. **`services/model-router-gateway`**, **`services/tool-gateway-mcp`** — ✅ done (adapters/client tested against mock servers, no live provider/MCP server wired in yet)
7. **`services/workflow-engine`** — ✅ done (durable, replayable, resumable, pausable multi-step execution)
8. **`services/memory-service`**, **`services/cost-usage-service`**, **`services/deployment-orchestrator`**, **`services/policy-engine-service`** — ✅ done (tiered memory + real pgvector semantic search, real budget-tier cost tracking, health-checked deploy/rollback, policy CRUD + approval expiry), and ✅ wired into control-plane-api's `/costs`, `/memory/query`, `/deployments*`, `/approvals` endpoints (Phase 7 — see `docs/decisions/0007`)
9. **`tests/rls-adversarial`** (full ≥50-case suite), **`tests/acceptance`** — partial (smoke-level 5-case RLS test + control-plane-api golden path/integration-wiring + agent-factory/model-router/tool-gateway/workflow-engine integration tests)

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
pnpm --filter @ai-office/observability run test
pnpm --filter @ai-office/policy-engine run test
pnpm test:rls-adversarial      # requires APP_DATABASE_URL (the ai_office_app role, not the owner)
pnpm --filter @ai-office/control-plane-api run test   # golden path + OpenAPI coverage + tenant isolation + Phase 7 wiring
pnpm --filter @ai-office/agent-factory run test        # lifecycle pipeline, real Postgres
pnpm --filter @ai-office/model-router-gateway run test # provider adapters vs. mock servers + real execution
pnpm --filter @ai-office/tool-gateway-mcp run test      # MCP client vs. mock server + binding/policy enforcement
pnpm --filter @ai-office/workflow-engine run test       # durable step execution, resumability, pause
pnpm --filter @ai-office/memory-service run test         # tiered memory + real pgvector semantic search
pnpm --filter @ai-office/cost-usage-service run test      # real budget_status against budget_tiers
pnpm --filter @ai-office/deployment-orchestrator run test # health-checked advance/rollback vs. mock server
pnpm --filter @ai-office/policy-engine-service run test   # policy CRUD + approval expiry sweep

# run the control plane locally:
AUTH_JWT_ISSUER=... AUTH_JWT_AUDIENCE=... AUTH_JWKS_URI=... \
  pnpm --filter @ai-office/control-plane-api run start   # listens on :3000

# advance one agent through the automated pipeline (DRAFT -> ... -> APPROVED):
pnpm --filter @ai-office/agent-factory run process -- <tenantId> <agentId>
```

To point `services/model-router-gateway` at a real provider instead of
`local-echo`, set `provider_registry.adapter_type` to `openai-chat` /
`anthropic-messages` / `google-gemini`, add a matching
`secrets_vault_references` row with `vault_path = 'env:YOUR_VAR_NAME'`, and
set `YOUR_VAR_NAME` in the environment — no code changes needed (see
`docs/decisions/0004-phase-4-implementation-choices.md`). The same
`SecretResolver` seam is used by `services/memory-service`'s
`OpenAiEmbeddingAdapter` for real `/v1/embeddings` calls; to enable Tier 3
semantic search on `POST /memory/query`, add a `secrets_vault_references`
row with `secret_name = 'memory-embedding-provider'` and
`vault_path = 'env:YOUR_VAR_NAME'` (see `docs/decisions/0007`).

To let `POST /deployments` and `/deployments/{id}/rollback` run a real
HTTP health check instead of leaving a deployment at `IN_PROGRESS` with
nothing to verify, pass an optional `health_check_url` in the create
request body pointing at a real health endpoint — see
`docs/decisions/0007-phase-7-integration-choices.md`.

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
