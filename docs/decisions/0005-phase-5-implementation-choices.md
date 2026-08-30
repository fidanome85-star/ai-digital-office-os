# ADR 0005 — Phase 5 implementation choices

**Status:** Accepted
**Date:** 2026-08-30

## Context

Phase 5 builds `services/workflow-engine` — the first service that
orchestrates the ones built in Phases 2–4 into one multi-step flow
(task-shaped step → model call → tool call → artifact), using
`workflow_history`'s append-only event log exactly as migration 0004's own
comment describes: "on process restart, replay this to reconstruct
workflow_registry.current_state rather than trusting only the mutable row."

## Decisions

1. **`workflow_history` is the actual source of truth on every call, not
   a write-only audit log.** `replayState()` (`src/history.ts`) reads
   every event for a workflow, in `sequence_no` order, and folds it into
   `{ definition, completedSteps, stepResults }` — that's what
   `runNextStep` consults to decide what to do next, every single time.
   `workflow_registry.current_state` is still written after each step,
   but purely as a fast-read cache for other callers (e.g.
   control-plane-api's `GET /workflows/{id}`) — never trusted by the
   engine itself. This is what makes resumability real rather than
   assumed: a test starts a workflow, runs exactly one step, then calls
   `runToCompletion` as if resuming after a crash, and asserts (by
   counting actual mock-server calls) that the completed step never runs
   twice.

2. **A step is one of three kinds, each delegating to a real service
   already built rather than reimplementing anything:** `model_call` →
   `@ai-office/model-router-gateway`'s `executeModelRun`; `tool_call` →
   `@ai-office/tool-gateway-mcp`'s `callTool`; `create_artifact` → a
   direct `artifact_registry` insert with a real SHA-256 hash of the
   referenced prior step's result. This is deliberately the smallest step
   vocabulary that can express "task → model call → tool call →
   artifact" — no generic scripting/branching DSL, which the blueprint
   doesn't ask for and would be scope invention.

3. **Concurrent pause/cancel from control-plane-api (Phase 2) is honored
   with zero coupling between the two services.** `runNextStep` reads
   `workflow_registry.status` fresh from the database on every call; if
   something else (a human clicking pause, `POST /workflows/{id}/pause`)
   flips it to `PAUSED` between two steps, the very next `runNextStep`
   call sees that and stops — no message passing, no shared in-memory
   state, no workflow-engine-specific pause API. Proven by a test that
   updates `workflow_registry.status` directly (the same statement
   control-plane-api's handler runs) between two `runNextStep` calls.

4. **A step failure stops the workflow (`status = 'FAILED'`) and returns a
   structured result — it does not throw past `runToCompletion`'s
   caller**, matching the house style `AgentFactoryError`/`runFullPipeline`
   established in Phase 3: a caller (a future scheduler, an operator
   script) should always be able to tell how far a workflow got and why
   it stopped without a stack trace being the only signal. Later steps
   are never attempted once one fails — proven by asserting the
   `never-runs` step's `stepId` never appears anywhere in
   `workflow_history`.

5. **No new step-execution transaction wraps the model/tool call
   itself.** `STEP_STARTED` is appended (committed) before calling out to
   model-router-gateway or tool-gateway-mcp, and `STEP_COMPLETED`/
   `STEP_FAILED` is appended after — but the call itself is not inside a
   database transaction, because it may take an unbounded amount of time
   (a real provider call, a real MCP round-trip) and holding a Postgres
   transaction open for that long would be its own problem. The
   `STEP_STARTED` event without a matching `STEP_COMPLETED`/`STEP_FAILED`
   is itself meaningful on replay — a future `resumeStuckWorkflows` sweep
   (not built in this phase) could treat that as "was running when the
   process died, needs re-attempting," which is exactly why an
   append-only log records a start event at all rather than just
   completions.

## Consequences

- `workflow-engine` depends on `model-router-gateway` and
  `tool-gateway-mcp` directly (real cross-service package reuse, not
  duplicated logic) — the first two Phase-4 services to be consumed by
  another service rather than only tested standalone.
- The step vocabulary is intentionally small. Extending it (a
  `wait_for_approval` step type that blocks on `approval_requests`, a
  `conditional` step, fan-out/fan-in) is a natural, additive next step —
  `runNextStep`'s `switch` in `execute-step.ts` is exactly the place a new
  case gets added, and none of the existing replay/resumability/pause
  logic needs to change to support it.
- No live provider or MCP server is used here either (same as Phase 4) —
  the `model_call` and `tool_call` steps in every test use
  `local-echo` and a local mock MCP server respectively.
