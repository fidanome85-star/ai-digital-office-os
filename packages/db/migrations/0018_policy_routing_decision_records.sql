-- 18. POLICY & ROUTING DECISION RECORDS  (v1.4 clause 72 — closes MEDIUM finding)
-- =====================================================================

CREATE TABLE policy_decision_records (
  policy_decision_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64) REFERENCES task_registry(task_id),
  agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  tool_id VARCHAR(64) REFERENCES tool_registry(tool_id),
  model_id VARCHAR(64) REFERENCES model_registry(model_id),
  provider_id VARCHAR(64) REFERENCES provider_registry(provider_id),
  decision VARCHAR(32) NOT NULL,                -- ALLOW|DENY|REQUIRE_APPROVAL|REQUIRE_ESCALATION
  policy_version VARCHAR(32) NOT NULL,
  alternatives JSONB,
  rejection_reasons JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE routing_decision_records (
  routing_decision_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64) REFERENCES task_registry(task_id),
  agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  selected_provider VARCHAR(64) REFERENCES provider_registry(provider_id),
  selected_model VARCHAR(64) REFERENCES model_registry(model_id),
  candidate_models JSONB,
  reason TEXT,
  policy_result VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
