-- 15. COST & USAGE LEDGER  (v1.4 clause 65 — closes HIGH finding)
-- =====================================================================

CREATE TABLE usage_events (
  usage_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64) REFERENCES project_registry(project_id),
  task_id VARCHAR(64) REFERENCES task_registry(task_id),
  agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  agent_run_id VARCHAR(64) REFERENCES agent_runs(agent_run_id),
  model_run_id VARCHAR(64) REFERENCES model_runs(model_run_id),
  provider_id VARCHAR(64) REFERENCES provider_registry(provider_id),
  model_id VARCHAR(64) REFERENCES model_registry(model_id),
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  request_count INT DEFAULT 1,
  actual_cost NUMERIC(18,8),
  currency VARCHAR(8) DEFAULT 'USD',
  billing_status VARCHAR(32) DEFAULT 'UNBILLED',
  event_time TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
