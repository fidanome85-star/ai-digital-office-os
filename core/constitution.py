from typing import Dict, Any, List

class ProjectConstitution:
    """
    Project Constitution v1.1
    Defines immutable governance, invariant rules, and architectural constraints
    enforced by Layer 1 (Owner) and Layer 2 (CEO).
    """
    def __init__(self, project_name: str, tech_stack: List[str], allowed_levels: List[str]):
        self.project_name = project_name
        self.tech_stack = tech_stack
        self.allowed_levels = allowed_levels
        self.rules: List[str] = [
            "Deterministic engines must calculate business invariants (taxes, inventory, balances).",
            "AI agents must never directly receive unrestricted raw API keys or database credentials.",
            "All high-risk and destructive operations (RED Tier) require explicit Owner approval.",
            "Automated self-healing retry cycles must terminate after a maximum of 3 attempts.",
            "Production deliverables must pass verification by an Independent QA Judge."
        ]

    def get_constitution_payload(self) -> Dict[str, Any]:
        return {
            "project_name": self.project_name,
            "tech_stack": self.tech_stack,
            "governance_levels": self.allowed_levels,
            "immutable_rules": self.rules,
            "status": "LOCKED"
        }
