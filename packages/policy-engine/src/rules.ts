import { PolicyEngineError } from "./errors.js";
import type { PolicyRule, RiskLevel } from "./types.js";

/**
 * Built-in governance defaults matching the blueprint's GREEN/YELLOW/RED
 * framing: green risk proceeds automatically, yellow needs a human sign-off,
 * red escalates. AGENT_ACTIVATE always requires approval regardless of risk
 * level — the Factory-to-Production transition is never fully automatic
 * (blueprint clause 45).
 */
export const DEFAULT_RULES: readonly PolicyRule[] = [
  { actionType: "AGENT_ACTIVATE", riskLevel: "*", decision: "REQUIRE_APPROVAL", note: "activation always requires approval" },
  { actionType: "*", riskLevel: "RED", decision: "REQUIRE_ESCALATION" },
  { actionType: "*", riskLevel: "YELLOW", decision: "REQUIRE_APPROVAL" },
  { actionType: "*", riskLevel: "GREEN", decision: "ALLOW" },
];

const RISK_LEVELS: readonly RiskLevel[] = ["GREEN", "YELLOW", "RED"];
const DECISIONS = ["ALLOW", "DENY", "REQUIRE_APPROVAL", "REQUIRE_ESCALATION"] as const;

/** Validates and normalizes the JSONB `rules` column from policy_registry.
 * Throws PolicyEngineError with a specific reason on any malformed entry —
 * a policy engine must never silently ignore a rule it couldn't parse and
 * fall back to being more permissive than intended. */
export function parsePolicyRules(raw: unknown): PolicyRule[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new PolicyEngineError("policy rules must be a JSON array");
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new PolicyEngineError(`policy rule at index ${index} must be an object`);
    }
    const rule = entry as Record<string, unknown>;

    if (typeof rule["actionType"] !== "string" || rule["actionType"].length === 0) {
      throw new PolicyEngineError(`policy rule at index ${index} is missing a string "actionType"`);
    }
    const riskLevel = rule["riskLevel"];
    if (riskLevel !== "*" && !RISK_LEVELS.includes(riskLevel as RiskLevel)) {
      throw new PolicyEngineError(
        `policy rule at index ${index} has invalid "riskLevel" (expected GREEN, YELLOW, RED or "*")`,
      );
    }
    const decision = rule["decision"];
    if (typeof decision !== "string" || !DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
      throw new PolicyEngineError(`policy rule at index ${index} has invalid "decision"`);
    }

    const result: PolicyRule = {
      actionType: rule["actionType"],
      riskLevel: riskLevel as PolicyRule["riskLevel"],
      decision: decision as PolicyRule["decision"],
    };
    if (typeof rule["note"] === "string") result.note = rule["note"];
    return result;
  });
}
