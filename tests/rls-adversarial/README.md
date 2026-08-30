# RLS adversarial tests

`cross-tenant.test.ts` is a real, runnable smoke test (`pnpm test:rls-adversarial`)
covering two representative tables — `organizations` (the tenant root) and
`project_registry` (a dependent table) — connected as the non-owning
`ai_office_app` role so RLS actually applies.

It is **not** the full ≥50-case adversarial suite the acceptance checklist
(`docs/blueprint/implementation_acceptance_checklist_v1.4.md`) calls for.
That belongs here once the services that actually write tenant data exist
(control-plane-api onward) — extend this file with one case per
tenant-scoped table as each service starts writing to it, covering INSERT
forgery, cross-tenant SELECT, UPDATE and DELETE for each.
