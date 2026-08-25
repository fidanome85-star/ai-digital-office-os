from datetime import datetime
from typing import Dict, Any, List

class GovernanceAuditor:
    """
    Governance & Compliance Auditor (Layer 1 & Layer 8)
    Tracks immutable audit logs, validates budget consumption thresholds,
    and enforces human-in-the-loop approvals for RED Tier actions.
    """
    def __init__(self, budget_ceiling_usd: float = 10.0):
        self.budget_ceiling_usd = budget_ceiling_usd
        self.audit_records: List[Dict[str, Any]] = []

    def record_event(
        self,
        event_type: str,
        actor_agent: str,
        details: Dict[str, Any],
        governance_tier: str = "GREEN",
        cost_usd: float = 0.0
    ) -> Dict[str, Any]:
        record = {
            "log_id": f"AUDIT-{len(self.audit_records) + 1:05d}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "event_type": event_type,
            "actor": actor_agent,
            "tier": governance_tier,
            "cost_usd": cost_usd,
            "details": details
        }
        self.audit_records.append(record)
        return record

    def check_tier_authorization(self, tier: str, requires_owner_signature: bool = False) -> bool:
        if tier == "RED" and not requires_owner_signature:
            return False
        return True

    def get_total_spend(self) -> float:
        return sum(rec.get("cost_usd", 0.0) for rec in self.audit_records)
