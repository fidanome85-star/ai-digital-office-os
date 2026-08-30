# ADR 0004 — Phase 4 implementation choices

**Status:** Accepted
**Date:** 2026-08-30

## Context

Phase 4 builds `services/model-router-gateway` (real provider adapters +
execution) and `services/tool-gateway-mcp` (real MCP client + binding
enforcement) — the first two services in this repo that make outbound
network calls. Before starting, the user was asked explicitly whether real
provider API keys should be wired in now; the answer was no — build the
infrastructure now, wire real credentials later without changing the code.

## Decisions

1. **Every hosted provider adapter (OpenAI, Anthropic, Gemini) is real,
   working code that speaks that vendor's actual API contract** — correct
   endpoint paths, auth headers, request/response shapes, token-usage
   field names — not a stub. It has simply never been run against the real
   vendor endpoint, because no API key exists in this environment. Each
   adapter is tested against a local mock HTTP server standing in for the
   vendor (`test/mock-server.ts`, plain `node:http`), which verifies the
   adapter sends the exact request shape a real server would need and
   correctly parses both success and error responses. Swapping in a real
   key changes nothing about the code — only which URL and secret get
   configured (`provider_registry.base_endpoint`,
   `secrets_vault_references.vault_path`).

2. **`LocalEchoAdapter` (`adapter_type = "local-echo"`) is the only adapter
   this phase's own tests and any default configuration actually call
   live**, and it makes no network call at all — deterministic, offline,
   matching the blueprint's "local models" branch. This is what keeps the
   whole test suite (and any future service that calls
   `executeModelRun`) runnable with zero external dependencies beyond
   Postgres.

3. **`SecretResolver` is a one-method seam
   (`resolve(vaultPath): Promise<string>`), with `EnvSecretResolver`
   as the only implementation** — reads `env:VAR_NAME`-shaped
   `secrets_vault_references.vault_path` values from `process.env`. A real
   deployment supplies a Vault/KMS-backed `SecretResolver` implementation;
   nothing in `executeModelRun` or any adapter needs to change. Consistent
   with the same pattern packages/auth (JWKS) and agent-factory
   (`AsyncLocalStorage` context) already established: define the
   integration point precisely, ship the offline-safe default, let a real
   backend be swapped in later without touching call sites.

4. **`model_registry.cost_profile` has no fixed shape anywhere in the
   schema** (deliberately blueprint-agnostic JSONB). `executeModelRun`
   assumes `{ input_per_1k, output_per_1k }` in USD and defaults to 0 for
   anything else — an explicit, documented, tested assumption (never
   silently guessed) rather than leaving cost estimation unimplemented.

5. **tool-gateway-mcp implements the actual MCP JSON-RPC 2.0 wire
   protocol** (`initialize`, `tools/list`, `tools/call` — Streamable HTTP
   transport variant: one JSON-RPC request per POST), tested against a
   local mock JSON-RPC server for the same reason as the provider
   adapters: no real MCP server exists to connect to in this environment,
   but the client code is the real protocol, not a simulation of it.

6. **Tool calls are gated in two layers, deliberately in this order:**
   agent_tool_bindings first (a hard authorization check — no binding row
   means nothing is permitted, full stop), then a policy-engine check
   keyed off the tool's own `risk_level` (same
   `evaluatePolicy`/`recordPolicyDecision` pattern agent-factory's SANDBOX
   gate uses — now proven across a third real service, not just
   decorative reuse). The binding check has no policy escape hatch on
   purpose: a tenant explicitly not granting an action is absolute, while
   risk-level policy can be tuned per tenant via `policy_registry.rules`.

7. **A blocked or failed tool call is always audited, on its own
   transaction, the same way a blocked agent-factory transition is** (ADR
   0003 §4) — `callTool` records `TOOL_CALL_BLOCKED`,
   `TOOL_CALL_EXECUTED`, or `TOOL_CALL_FAILED` to `audit_events` in a
   transaction separate from the policy check and the MCP call itself, so
   the record survives regardless of which step failed.

## Consequences

- Nothing in this repo yet actually calls a real hosted LLM or a real MCP
  server — that requires the user to supply credentials/endpoints and is
  explicitly deferred (see the question asked at the start of this
  phase). `PHASE_STATUS.md` marks the hosted-adapter code VERIFIED against
  mock servers, and lists live-provider execution as the next TARGET.
- `services/workflow-engine` (build-order step 7) is the natural next
  caller of both `executeModelRun` and `callTool` — orchestrating a real
  multi-step agent run is exactly what durable workflow execution is for.
- The `SecretResolver`/mock-server-testing pattern established here is
  the template for any future service that needs an external network
  dependency: define the seam, ship an offline-safe default, test the
  real protocol against a local double.
