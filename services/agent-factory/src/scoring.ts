/**
 * Rule-based completeness heuristic, NOT a real capability/quality
 * evaluation — same honesty discipline as Phase 2's /models/evaluate
 * placeholder (see docs/decisions/0002, item 5). A real evaluation needs
 * to actually run the agent against test cases, which needs a working
 * model-router-gateway and a real LLM provider call — neither exists yet
 * (build-order step 6). This only checks how complete the specification
 * itself is, out of 100, entirely offline.
 */
export interface AgentScoringInput {
  capabilities: unknown;
  purpose: string | null;
  input_schema: unknown;
  output_schema: unknown;
  security_level: string | null;
}

export function computeEvaluationScore(agent: AgentScoringInput): number {
  let score = 0;

  const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  score += Math.min(capabilities.length * 10, 30);

  if (typeof agent.purpose === "string" && agent.purpose.trim().length >= 10) score += 20;
  if (agent.input_schema !== null && agent.input_schema !== undefined) score += 20;
  if (agent.output_schema !== null && agent.output_schema !== undefined) score += 20;
  if (agent.security_level === "GREEN" || agent.security_level === "YELLOW" || agent.security_level === "RED") {
    score += 10;
  }

  return Math.min(score, 100);
}
