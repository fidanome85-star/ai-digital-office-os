import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePolicy } from "../src/evaluator.js";
import { parsePolicyRules } from "../src/rules.js";
import { PolicyEngineError } from "../src/errors.js";

describe("evaluatePolicy (default rules)", () => {
  it("allows a GREEN-risk action", () => {
    const decision = evaluatePolicy({ actionType: "PUBLISH_ARTIFACT", riskLevel: "GREEN" });
    assert.equal(decision.decision, "ALLOW");
  });

  it("requires approval for a YELLOW-risk action", () => {
    const decision = evaluatePolicy({ actionType: "DEPLOY", riskLevel: "YELLOW" });
    assert.equal(decision.decision, "REQUIRE_APPROVAL");
  });

  it("escalates a RED-risk action", () => {
    const decision = evaluatePolicy({ actionType: "DELETE_TENANT_DATA", riskLevel: "RED" });
    assert.equal(decision.decision, "REQUIRE_ESCALATION");
  });

  it("always requires approval for AGENT_ACTIVATE, even at GREEN risk", () => {
    const decision = evaluatePolicy({ actionType: "AGENT_ACTIVATE", riskLevel: "GREEN" });
    assert.equal(decision.decision, "REQUIRE_APPROVAL");
    assert.match(decision.reason, /activation always requires approval/);
  });
});

describe("evaluatePolicy (tenant rules override defaults)", () => {
  it("prefers a more specific tenant rule over the default", () => {
    const tenantRules = parsePolicyRules([{ actionType: "DEPLOY", riskLevel: "YELLOW", decision: "ALLOW" }]);
    const decision = evaluatePolicy({ actionType: "DEPLOY", riskLevel: "YELLOW" }, tenantRules);
    assert.equal(decision.decision, "ALLOW");
    assert.equal(decision.matchedRule?.actionType, "DEPLOY");
  });

  it("falls through to defaults when no tenant rule matches", () => {
    const tenantRules = parsePolicyRules([{ actionType: "DEPLOY", riskLevel: "YELLOW", decision: "ALLOW" }]);
    const decision = evaluatePolicy({ actionType: "DELETE_TENANT_DATA", riskLevel: "RED" }, tenantRules);
    assert.equal(decision.decision, "REQUIRE_ESCALATION");
  });

  it("picks the more specific rule (exact action + risk) over a wildcard rule", () => {
    const tenantRules = parsePolicyRules([
      { actionType: "*", riskLevel: "RED", decision: "REQUIRE_APPROVAL" },
      { actionType: "DELETE_TENANT_DATA", riskLevel: "RED", decision: "REQUIRE_ESCALATION" },
    ]);
    const decision = evaluatePolicy({ actionType: "DELETE_TENANT_DATA", riskLevel: "RED" }, tenantRules);
    assert.equal(decision.decision, "REQUIRE_ESCALATION");
    assert.equal(decision.matchedRule?.actionType, "DELETE_TENANT_DATA");
  });
});

describe("parsePolicyRules", () => {
  it("returns an empty array for null/undefined", () => {
    assert.deepEqual(parsePolicyRules(null), []);
    assert.deepEqual(parsePolicyRules(undefined), []);
  });

  it("throws PolicyEngineError when rules is not an array", () => {
    assert.throws(() => parsePolicyRules({ not: "an array" }), PolicyEngineError);
  });

  it("throws PolicyEngineError on a malformed rule instead of silently dropping it", () => {
    assert.throws(() => parsePolicyRules([{ actionType: "X" }]), PolicyEngineError);
    assert.throws(() => parsePolicyRules([{ actionType: "X", riskLevel: "PURPLE", decision: "ALLOW" }]), PolicyEngineError);
    assert.throws(() => parsePolicyRules([{ actionType: "X", riskLevel: "RED", decision: "MAYBE" }]), PolicyEngineError);
  });

  it("parses a well-formed rule list", () => {
    const rules = parsePolicyRules([{ actionType: "DEPLOY", riskLevel: "GREEN", decision: "ALLOW", note: "fast lane" }]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.note, "fast lane");
  });
});
