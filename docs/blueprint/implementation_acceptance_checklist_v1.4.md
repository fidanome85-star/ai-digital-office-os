# AI DIGITAL OFFICE OS v1.4 Integrity Acceptance Checklist

## Critical
- [x] Project registry exists and every operational project_id resolves to it. — `tests/acceptance/critical.test.ts`, "Project registry..." (FK-enforced, real rejection proven)
- [x] Agent versions are stored separately and activation targets a specific version. — same file, "Agent versions are stored separately..."
- [x] Agent runs and model runs exist and artifact lineage resolves through them. — same file, "Agent runs and model runs..."
- [x] RLS is active on every tenant-scoped operational table. — same file, "RLS is active..." (introspects `pg_class.relrowsecurity` for all 36 tables)
- [x] RLS has both USING and WITH CHECK policies. — same file, "RLS has both USING and WITH CHECK..." (introspects `pg_policies`)
- [x] 100% cross-tenant rejection passes on all tenant-scoped resources. — `tests/rls-adversarial/` (75 real adversarial cases across all 36 tables) + `tests/acceptance/critical.test.ts`'s coverage-completeness assertion

## AI Platform
- [x] Model evaluation history is versioned and rerunnable. — `tests/acceptance/ai-platform.test.ts`, "Model evaluation history..."
- [x] Provider/model routing decisions are persisted. — same file, "Provider/model routing decisions..."
- [x] Usage and cost events are persisted and reconcile with budgets. — same file, "Usage and cost events..." (real OK/WARNING/SOFT_LIMIT/HARD_LIMIT reconciliation via `getCostSummary`)
- [x] MCP server/tool registry is authoritative. — same file, "MCP server/tool registry is authoritative..." (no binding = `BINDING_DENIED`, real `callTool`)
- [x] Agent-tool bindings are tenant-scoped and policy-controlled. — same file, "Agent-tool bindings are tenant-scoped..." (RLS + real `POLICY_BLOCKED` on a RED-risk tool)

## API
- [x] Project lifecycle endpoints exist. — `tests/acceptance/api.test.ts`, "Project lifecycle endpoints exist"
- [x] Workflow cancel/retry/escalate exists. — same file, "Workflow cancel/retry/escalate exists"
- [x] Agent version activation exists. — same file, "Agent version activation exists"
- [x] Agent message send exists. — same file, "Agent message send exists"
- [x] Artifact creation and lineage endpoint exists. — same file, "Artifact creation and lineage endpoint exists"
- [x] Provider/model/evaluation endpoints exist. — same file, "Provider/model/evaluation endpoints exist"
- [x] Usage/cost endpoints exist. — same file, "Usage/cost endpoints exist"
- [x] Deployment/release endpoints exist. — same file, "Deployment/release endpoints exist" (release_registry itself still has no *creation* endpoint — documented spec gap, ADR 0002 §5, not silently worked around)
- [x] Policy/routing decision endpoints exist. — same file, "Policy/routing decision endpoints exist"
- [x] SQL/OpenAPI/domain-model diff test passes. — same file, "SQL/OpenAPI/domain-model diff test passes" (runs the identical gate `.github/workflows/ci.yml` runs)

## Evidence discipline
- [x] TARGET items are not labeled VERIFIED. — `PHASE_STATUS.md`'s own three-way TARGET/TEST REQUIRED/VERIFIED labeling, followed since Phase 1
- [x] Every VERIFIED item has test evidence. — every `PHASE_STATUS.md` row names the exact command/test; every checkbox above names the exact test
- [ ] SLO numbers are measured only after a running environment exists. — no production/staging environment exists yet (by design, see `PHASE_STATUS.md` "What has NOT been built yet"); nothing to measure, nothing claimed
- [x] Production security claims are backed by executed tests, not blueprint text. — RLS, auth, and policy-gating claims are all backed by real adversarial/acceptance tests listed above, not blueprint prose
