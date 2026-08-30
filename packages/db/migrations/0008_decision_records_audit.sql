-- 8. DECISION RECORDS & AUDIT  (clauses 24, 29, 50, 57)
-- =====================================================================

CREATE TABLE decision_records (
  decision_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  decision TEXT NOT NULL,
  reason TEXT,
  alternatives JSONB,
  evidence JSONB,
  agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  model_id VARCHAR(64) REFERENCES model_registry(model_id),
  author VARCHAR(128),
  approval JSONB,
  impact TEXT,
  status VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_events (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES organizations(tenant_id),
  correlation_id VARCHAR(128),
  event_type VARCHAR(128) NOT NULL,
  actor_type VARCHAR(32),
  actor_id VARCHAR(128),
  project_id VARCHAR(64),
  task_id VARCHAR(64),
  workflow_id VARCHAR(64),
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
