# ADR 0008 — Phase 8–9 hardening choices

**Status:** Accepted
**Date:** 2026-08-31

## Context

Every phase's `PHASE_STATUS.md` "What has NOT been built yet" section
carried the same two open items since Phase 1: the RLS adversarial suite
was a 2-table smoke test, not the acceptance checklist's ≥50-case
requirement, and no `tests/acceptance` directory existed at all despite
the checklist file (`docs/blueprint/implementation_acceptance_checklist_v1.4.md`)
being 24 checkable bullets with real, testable claims. Phase 7 closed the
"services aren't wired to the API" gap; Phase 8–9 closes these two.

## Decisions

1. **The full RLS suite is one data-driven test file, not 35 hand-written
   copies of the same three checks.** `tests/rls-adversarial/full-coverage.test.ts`
   defines a `TableCase[]` array — one entry per tenant-scoped table (all
   36 minus `organizations`, already covered by the existing smoke test)
   — each supplying only what's different: the columns needed for a
   minimal valid row and, for the two tables with a composite FK into
   `roles(tenant_id, role_id)` (`role_permissions`, `user_roles`), a
   `forgedRow` override. A single generic runner then applies the same
   three real checks — INSERT forgery rejected, cross-tenant SELECT
   hidden, cross-tenant UPDATE/DELETE are no-ops and the row survives —
   to every entry. This keeps the suite's size (35 x 2 = 70 tests, 75
   with the smoke test) from becoming 35 divergent, hand-maintained test
   bodies that drift out of sync with each other over time.

2. **The forged-INSERT case defaults to "reuse the attacker's own valid
   row, swap only `tenant_id`," but that default breaks for tables whose
   foreign key is itself composite on `(tenant_id, role_id)`.** Swapping
   just `tenant_id` while keeping the attacker's own `role_id` would trip
   a foreign-key violation (no such `(tenant_id_victim, role_id_attacker)`
   row exists in `roles`) instead of the RLS `WITH CHECK` violation the
   test exists to prove — the assertion would still pass, but for the
   wrong reason, silently laundering a weaker test into looking like a
   stronger one. `role_permissions` and `user_roles` override `forgedRow`
   to use the **victim's own** `role_id`, which keeps the FK valid so
   `WITH CHECK` is the only thing left that can reject the insert — a
   more realistic attack besides (an attacker who has learned a victim's
   `role_id` trying to attach a permission to it).

3. **`tests/acceptance/critical.test.ts`'s "100% cross-tenant rejection"
   case is a coverage-completeness assertion, not a re-run of the
   adversarial suite.** It introspects `pg_class` for the live set of
   tenant-scoped tables and asserts that set exactly equals a hardcoded
   list of what `cross-tenant.test.ts` and `full-coverage.test.ts`
   actually cover. This is deliberately a *different kind* of test than
   the 75 adversarial cases themselves: it's the guard that fires when
   someone adds table #37 with a `tenant_id` column and forgets to add a
   matching adversarial case — the coverage list is hardcoded precisely
   so it can't silently expand itself to match whatever exists.

4. **Acceptance tests prove behavior at whichever layer most directly and
   honestly proves the checklist's claim — not uniformly through HTTP.**
   The "Critical" and "AI Platform" bullets are about what the *system*
   guarantees (a version activation targets a specific row, a policy
   decision persists, a binding is tenant-scoped), which is exactly as
   true and exactly as real when proven via a direct service-layer call
   (`callTool`, `getCostSummary`) or a real DB write/read as it is via
   HTTP — Phase 2's `golden-path.test.ts` and Phase 7's
   `integration-wiring.test.ts` already prove the HTTP-level versions of
   several of these end to end, so re-proving them a third time at the
   HTTP layer here would be redundant, not more rigorous. The "API"
   section is different — its bullets are explicitly about existence
   ("X endpoint exists"), so `api.test.ts` checks the OpenAPI contract
   directly and leans on `openapi-coverage.test.ts` (already exhaustive,
   48/48 operations bound to real Express routes) for the route-binding
   proof, rather than duplicating that mechanism per bullet.

5. **`api.test.ts`'s domain-model diff check literally shells out to the
   same two commands CI runs** (`pnpm domain-model:generate` then
   `git diff --exit-code`) rather than reimplementing the comparison in
   TypeScript. This is the one acceptance case where "prove it the same
   way CI proves it" is more honest than writing an independent check —
   any drift between a hand-rolled comparison and the actual gate would
   itself be a bug waiting to happen.

## Consequences

- A zombie process from an earlier, unrelated test run in this same
  session had exhausted enough Postgres connections that a fresh
  `tests/acceptance/ai-platform.test.ts` run hung waiting for a
  connection rather than failing fast — a reminder that `after()` hooks
  not wrapped in `try/finally` (as this file's originally was) turn a
  single ordering bug (deleting `mcp_server_registry` before the
  `tool_registry` row referencing it) into a hung process instead of a
  clear assertion failure. Both new acceptance test files now follow the
  `try/finally` convention every other multi-table cleanup in this repo
  already used.
- 75 real RLS adversarial cases and 21 real acceptance cases now exist,
  both wired into CI (`pnpm test:rls-adversarial`, `pnpm test:acceptance`)
  — the two items every prior phase's "What has NOT been built yet"
  section named are closed.
- The acceptance checklist's own checkboxes are now the authoritative,
  evidence-linked record of what's proven — each checked box names the
  exact test, mirroring `PHASE_STATUS.md`'s discipline at the
  checklist's own granularity.
