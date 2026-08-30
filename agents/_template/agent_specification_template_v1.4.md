# Agent Specification Template v1.4

agent_id:
tenant_id:                     # NULL only for a system-wide template; every executable agent must set this
agent_name:
department:
role:
purpose:

## Capabilities
-

## Required Model Capabilities
-

## Tools (declared via MCP — Model Context Protocol, blueprint clause 54)
- tool_name:
  mcp_server:
  allowed_actions:

## Permissions
-

## Data Classification Allowed
- PUBLIC
- INTERNAL

## Input Contract
{}

## Output Contract
{}

## Security Level
GREEN | YELLOW | RED

## Sandbox Policy
Describe filesystem, network, database, shell and credential restrictions.
Default sandbox credential lifetime: 15 minutes (AI provider keys), 24 hours
(tool-gateway service credentials) — see blueprint clause 46.

## Idempotency
Every task this agent executes must supply an idempotency_key; the agent
must not perform a non-idempotent side effect (deployment, external write,
message send) without one.

## Evaluation Suite
- Accuracy
- Instruction following
- Tool precision
- Schema compliance
- Security
- Reliability
- Cost
- Latency
- Domain invariants

## Lifecycle
DRAFT → SANDBOX → TESTED → EVALUATED → APPROVED → ACTIVE → UPDATED → DEPRECATED → RETIRED

Note (v1.3, blueprint clause 45): reaching APPROVED is the Agent Factory's
maximum authority. The APPROVED → ACTIVE transition requires a separate
approval_requests record (action=AGENT_ACTIVATE) — the Factory pipeline
cannot activate its own output into production.

Note (v1.4, blueprint clause 60): this specification produces a new,
immutable row in `agent_versions` every time it changes — it never
overwrites the agent's currently ACTIVE version in place. Activation
(above) targets a specific `agent_version_id`, so an agent may have
version N active in production while version N+1 is still in
SANDBOX/EVALUATED.

## Tool Bindings (v1.4, blueprint clause 67)
Tools declared above are bound via `agent_tool_bindings`, keyed to a
stable `tool_id` in the MCP `tool_registry` — not by free-text tool name —
so Policy Engine and RBAC decisions resolve against a versioned, auditable
tool identity.

## External Interoperability (optional, disabled by default)
a2a_capability_card_enabled: false     # blueprint clause 42/54 — only for
                                         # approved external partner integrations

## Owner / Governance
Define who can approve activation and production permissions for this
agent, scoped to tenant_id above.
