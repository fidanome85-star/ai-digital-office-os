import { DEFAULT_RULES } from "./rules.js";
import type { PolicyDecision, PolicyInput, PolicyRule } from "./types.js";

const POLICY_VERSION = "1.4.0-default";

function specificity(rule: PolicyRule, input: PolicyInput): number | null {
  const actionMatches = rule.actionType === "*" || rule.actionType === input.actionType;
  const riskMatches = rule.riskLevel === "*" || rule.riskLevel === input.riskLevel;
  if (!actionMatches || !riskMatches) return null;
  return (rule.actionType === "*" ? 0 : 2) + (rule.riskLevel === "*" ? 0 : 1);
}

/**
 * Pure function, no I/O — tenant-specific rules (from policy_registry.rules,
 * parsed via parsePolicyRules) take precedence over DEFAULT_RULES; within
 * each set, the most specific applicable rule wins (exact actionType +
 * exact riskLevel beats either being a wildcard).
 */
export function evaluatePolicy(input: PolicyInput, tenantRules: readonly PolicyRule[] = []): PolicyDecision {
  const candidates = [...tenantRules, ...DEFAULT_RULES];

  let best: { rule: PolicyRule; score: number } | null = null;
  for (const rule of candidates) {
    const score = specificity(rule, input);
    if (score === null) continue;
    if (!best || score > best.score) best = { rule, score };
  }

  if (!best) {
    return {
      decision: "REQUIRE_ESCALATION",
      reason: `No policy rule matched actionType="${input.actionType}" riskLevel="${input.riskLevel}" — failing closed.`,
      matchedRule: null,
      policyVersion: POLICY_VERSION,
    };
  }

  const { rule } = best;
  return {
    decision: rule.decision,
    reason: rule.note ?? `Matched rule actionType="${rule.actionType}" riskLevel="${rule.riskLevel}" -> ${rule.decision}.`,
    matchedRule: rule,
    policyVersion: POLICY_VERSION,
  };
}
