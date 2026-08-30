# Policy Engine (shared library)
Implements the ALLOW / DENY / REQUIRE_APPROVAL / REQUIRE_ESCALATION decision
logic (clause 12-14). Every decision this library returns should be written
to policy_decision_records (clause 72) by the calling service.
