# Acceptance Tests

One test file per checklist section in
`docs/blueprint/implementation_acceptance_checklist_v1.4.md`, run via
`pnpm test:acceptance`:

- `critical.test.ts` — the 6 "Critical" bullets.
- `ai-platform.test.ts` — the 5 "AI Platform" bullets.
- `api.test.ts` — the 9 "API" endpoint-existence bullets plus the
  SQL/OpenAPI/domain-model diff gate (the same check CI runs).

Every `it()` maps to one checklist bullet and asserts something that
could only pass if the real behavior exists — a rejected forged INSERT, a
real FK-enforced JOIN resolving lineage, a live `pg_policies` /
`pg_class` introspection, a real policy-blocked tool call — never a
restatement of the bullet's own text. The checklist file itself has its
checkboxes ticked with a one-line evidence pointer per item (which test,
which command) once — and only once — a real run has passed; the
"Evidence discipline" section's own rules (never mark VERIFIED without a
passing run) apply to this directory as much as to `PHASE_STATUS.md`.
`db.ts` holds the two small connection helpers (`createOwnerClient`,
`createAppPool`) shared across these three files.
