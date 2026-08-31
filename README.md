# AI Digital Office OS

Multi-tenant AI orchestration platform: a control-plane API, agent factory,
model router, workflow engine, and policy engine for running governed AI
agents inside an organization. Specification: `docs/blueprint/` (v1.4
consolidated master + integrity review + acceptance checklist).

**Status: Phase 9 of 9 (the original scaffold's build order) complete,
plus a Phase 10 hardening addition — functionally complete, hardened, and
self-operating end-to-end.** See `PHASE_STATUS.md` for exactly what is
built, tested and verified versus what is still a TARGET. The control
plane is a real, tested, RLS-enforced HTTP API; agent specifications move
through a real, offline-first, policy-gated lifecycle pipeline; real
provider adapters and a real MCP client exist, tested against local mock
servers; workflow-engine durably chains them — model call → tool call →
artifact — into one replayable, resumable, pausable multi-step flow; all
eight build-order services exist with real, tested logic (tiered memory
with real pgvector semantic search, real budget-tier cost tracking,
health-checked deploy/rollback, policy CRUD + approval expiry) and are
wired into control-plane-api's endpoints (`/costs`, `/memory/query`,
`/deployments*`, `/approvals`), not standing in for them; the RLS
adversarial suite covers all 36 tenant-scoped tables with 75 real cases;
a dedicated `tests/acceptance` suite proves all 24 bullets in the
implementation acceptance checklist; and `services/scheduler-worker` keeps
the two housekeeping sweeps (`expirePendingApprovals`,
`purgeExpiredWorkingMemory`) running on a real schedule rather than only
when an incidental request triggers them. No live API key, MCP server, or
deployment infrastructure has been wired in yet (a deliberate choice, see
`docs/decisions/0004`) — what's left is operating the system against real
credentials/infrastructure, not building more of it. See
`PHASE_STATUS.md`'s "Next phase."

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
9. **`tests/rls-adversarial`** (full ≥50-case suite), **`tests/acceptance`** — ✅ done (75-case RLS adversarial suite across all 36 tenant-scoped tables; 21-case acceptance suite covering all 24 checklist bullets — see `docs/decisions/0008`)
10. **`services/scheduler-worker`** *(beyond the original 9-item scaffold — an operational hardening addition, not a numbered build-order item)* — ✅ done: a real `setInterval`-driven scheduler running `expirePendingApprovals` and `purgeExpiredWorkingMemory` across every tenant on a schedule, plus a one-shot CLI mode — see `docs/decisions/0009`

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
pnpm test:rls-adversarial      # smoke test + full 75-case suite across all 36 tenant-scoped tables; requires APP_DATABASE_URL (the ai_office_app role, not the owner)
pnpm --filter @ai-office/control-plane-api run test   # golden path + OpenAPI coverage + tenant isolation + Phase 7 wiring
pnpm --filter @ai-office/agent-factory run test        # lifecycle pipeline, real Postgres
pnpm --filter @ai-office/model-router-gateway run test # provider adapters vs. mock servers + real execution
pnpm --filter @ai-office/tool-gateway-mcp run test      # MCP client vs. mock server + binding/policy enforcement
pnpm --filter @ai-office/workflow-engine run test       # durable step execution, resumability, pause
pnpm --filter @ai-office/memory-service run test         # tiered memory + real pgvector semantic search
pnpm --filter @ai-office/cost-usage-service run test      # real budget_status against budget_tiers
pnpm --filter @ai-office/deployment-orchestrator run test # health-checked advance/rollback vs. mock server
pnpm --filter @ai-office/policy-engine-service run test   # policy CRUD + approval expiry sweep
pnpm --filter @ai-office/scheduler-worker run test        # cross-tenant sweep pass + real setInterval loop
pnpm test:acceptance           # all 24 implementation_acceptance_checklist_v1.4.md bullets, real assertions

# run the control plane locally:
AUTH_JWT_ISSUER=... AUTH_JWT_AUDIENCE=... AUTH_JWKS_URI=... \
  pnpm --filter @ai-office/control-plane-api run start   # listens on :3000

# advance one agent through the automated pipeline (DRAFT -> ... -> APPROVED):
pnpm --filter @ai-office/agent-factory run process -- <tenantId> <agentId>

# run the housekeeping sweeps once, or as a long-running scheduler:
pnpm --filter @ai-office/scheduler-worker run sweep       # one pass across every tenant, then exits
pnpm --filter @ai-office/scheduler-worker run sweep:loop  # SWEEP_INTERVAL_MS (default 300000ms), runs until SIGTERM/SIGINT
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
