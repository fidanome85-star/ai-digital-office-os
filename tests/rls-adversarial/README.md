# RLS adversarial tests

`pnpm test:rls-adversarial` runs both files here against real Postgres,
connected as the non-owning `ai_office_app` role so RLS actually applies
(Postgres exempts table owners and superusers from RLS).

- `cross-tenant.test.ts` — a small, readable smoke test covering two
  representative tables: `organizations` (the tenant root, whose primary
  key literally *is* the tenant id — structurally different from every
  other table) and `project_registry` (an ordinary dependent table).
- `full-coverage.test.ts` — the full ≥50-case adversarial suite the
  acceptance checklist (`docs/blueprint/implementation_acceptance_checklist_v1.4.md`)
  calls for: every one of the other 35 tenant-scoped tables gets the same
  three real checks (INSERT forgery rejected, cross-tenant SELECT hidden,
  cross-tenant UPDATE/DELETE are no-ops and the row survives), driven by a
  data-driven `TableCase` array rather than 35 hand-duplicated test
  blocks. 35 tables x 2 test cases = 70, plus the smoke test's 5 = 75
  total. `tests/acceptance/critical.test.ts`'s "100% cross-tenant
  rejection" test asserts this coverage set exactly matches the full
  tenant-scoped table set introspected from `pg_class` — so a new
  tenant-scoped table added without a matching case here fails that
  acceptance test, not silently.
