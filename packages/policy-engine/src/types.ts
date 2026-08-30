export type RiskLevel = "GREEN" | "YELLOW" | "RED";

export type PolicyDecisionResult = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "REQUIRE_ESCALATION";

export interface PolicyRule {
  /** Exact action type to match, or "*" to match any. */
  actionType: string;
  /** Exact risk level to match, or "*" to match any. */
  riskLevel: RiskLevel | "*";
  decision: PolicyDecisionResult;
  /** Optional human-readable note carried into the decision's reason. */
  note?: string;
}

export interface PolicyInput {
  actionType: string;
  riskLevel: RiskLevel;
  taskId?: string;
  agentId?: string;
  toolId?: string;
  modelId?: string;
  providerId?: string;
}

export interface PolicyDecision {
  decision: PolicyDecisionResult;
  reason: string;
  matchedRule: PolicyRule | null;
  policyVersion: string;
}
