# ADR 0012 — Live Gemini call verification

**Status:** Accepted
**Date:** 2026-08-31

## Context

Every phase since Phase 4 has said the same thing about the provider
adapters: real, protocol-correct code, tested against local mock servers,
never called against a real hosted endpoint — a deliberate choice, since
no credentials existed in this environment. The user supplied a real,
temporary Google Gemini API key in-session specifically to verify that
choice was genuinely just "no credentials yet," not a hidden defect in
the adapter itself.

## What was actually done

A one-off script (never committed — written, run, and deleted within the
same session) seeded a real `provider_registry`/`model_registry`/
`secrets_vault_references` row set and called this repo's actual,
unmodified `executeModelRun` and `runBenchmarkSuite` (Phase 11's real
benchmark harness) against `model=gemini-flash-latest`, with the supplied
key held only in a session-local environment variable — never written to
any file, never logged, never committed. Both calls succeeded:

- A single `executeModelRun` call returned a real completion ("The
  capital of France is Paris.") with real token counts (14 in / 7 out)
  and `finishReason: STOP`.
- `runBenchmarkSuite`'s 3-prompt default suite scored **100%** — all
  three real prompts completed successfully against the live API, with
  real per-case latencies (14.8s–28.4s) and output token counts.
- An earlier attempt against `gemini-2.5-flash` (a model this
  particular key's account can no longer access) correctly failed with a
  real, informative `404 PROVIDER_ERROR` from Google — proof the error
  path is exactly as real as the success path, not just the happy case.
- All seeded rows (`organizations`, `provider_registry`,
  `model_registry`, `secrets_vault_references`, `model_runs`,
  `usage_events`) were deleted at the end of the same run; nothing from
  this test persists in any database this repo ships or documents.

## Decision

**This is a one-time verification event, not a standing capability.** No
key is stored anywhere in this repository, its history, or any committed
file — `secrets_vault_references` still only ever holds an `env:VAR_NAME`
pointer, exactly as designed since ADR 0004, and no such variable is set
in any shipped config. The next person to run this code against a real
provider still needs to supply their own credentials, exactly as
`README.md` already describes. What this event proves is narrower and
more useful than "credentials are now configured": **the adapter,
retry/backoff, `model_runs`/`usage_events` persistence, and the Phase 11
benchmark harness are not just protocol-correct against a mock — they
work against the real, current Gemini API, unmodified.**

The user who supplied the key was advised to treat it as exposed (it
appeared in this chat transcript) and rotate or revoke it after this
verification, independent of anything this repository does.

## Consequences

- The "no live provider call has ever been made" line in
  `PHASE_STATUS.md`'s "What has NOT been built yet" is updated to name
  Gemini specifically as verified, once, this way — OpenAI and Anthropic
  remain unverified against a live endpoint, and MCP still has no live
  server to call, both still open exactly as before.
- No code changed as a result of this verification — the adapter needed
  no fixes. That is itself the finding: the "real code, mock-tested,
  ready for real credentials" posture asserted since ADR 0004 held up
  against an actual live call on the first real attempt (a real model
  name typo/deprecation aside, which is exactly the kind of real-world
  friction a mock server can't surface).
