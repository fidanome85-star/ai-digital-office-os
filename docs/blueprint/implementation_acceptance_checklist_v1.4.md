# AI DIGITAL OFFICE OS v1.4 Integrity Acceptance Checklist

## Critical
- [ ] Project registry exists and every operational project_id resolves to it.
- [ ] Agent versions are stored separately and activation targets a specific version.
- [ ] Agent runs and model runs exist and artifact lineage resolves through them.
- [ ] RLS is active on every tenant-scoped operational table.
- [ ] RLS has both USING and WITH CHECK policies.
- [ ] 100% cross-tenant rejection passes on all tenant-scoped resources.

## AI Platform
- [ ] Model evaluation history is versioned and rerunnable.
- [ ] Provider/model routing decisions are persisted.
- [ ] Usage and cost events are persisted and reconcile with budgets.
- [ ] MCP server/tool registry is authoritative.
- [ ] Agent-tool bindings are tenant-scoped and policy-controlled.

## API
- [ ] Project lifecycle endpoints exist.
- [ ] Workflow cancel/retry/escalate exists.
- [ ] Agent version activation exists.
- [ ] Agent message send exists.
- [ ] Artifact creation and lineage endpoint exists.
- [ ] Provider/model/evaluation endpoints exist.
- [ ] Usage/cost endpoints exist.
- [ ] Deployment/release endpoints exist.
- [ ] Policy/routing decision endpoints exist.
- [ ] SQL/OpenAPI/domain-model diff test passes.

## Evidence discipline
- [ ] TARGET items are not labeled VERIFIED.
- [ ] Every VERIFIED item has test evidence.
- [ ] SLO numbers are measured only after a running environment exists.
- [ ] Production security claims are backed by executed tests, not blueprint text.
