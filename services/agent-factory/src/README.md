# Agent Factory
Implements the DRAFT -> SANDBOX -> TESTED -> EVALUATED -> APPROVED pipeline
(clause 4/5). Writes to agent_versions (clause 60) on every change; NEVER
transitions APPROVED -> ACTIVE itself (clause 45) — that requires a separate
approval_requests(action=AGENT_ACTIVATE) record.
