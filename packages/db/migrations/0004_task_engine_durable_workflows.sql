-- 4. TASK ENGINE & DURABLE WORKFLOWS  (clauses 17-18, 43)
-- =====================================================================

CREATE TABLE workflow_registry (
  workflow_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  workflow_type VARCHAR(96) NOT NULL,
  definition_version VARCHAR(32) NOT NULL,
  current_state JSONB,
  status VARCHAR(32) DEFAULT 'RUNNING',                  -- RUNNING|PAUSED|COMPLETED|FAILED|CANCELLED|ESCALATED
  started_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Append-only, replayable event log: on process restart, replay this to
-- reconstruct workflow_registry.current_state rather than trusting only
-- the mutable row (durable-execution pattern).
CREATE TABLE workflow_history (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  workflow_id VARCHAR(64) NOT NULL REFERENCES workflow_registry(workflow_id),
  sequence_no BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,                       -- STARTED|TASK_DISPATCHED|TASK_COMPLETED|RETRY|ESCALATED|ROLLED_BACK|COMPLETED
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workflow_id, sequence_no)
);

CREATE TABLE task_registry (
  task_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  workflow_id VARCHAR(64) REFERENCES workflow_registry(workflow_id),
  parent_task_id VARCHAR(64) REFERENCES task_registry(task_id),
  assigned_agent VARCHAR(64) REFERENCES agent_registry(agent_id),
  required_capability VARCHAR(128),
  priority VARCHAR(16),
  risk_level VARCHAR(16),
  security_level VARCHAR(16),
  dependencies JSONB DEFAULT '[]',
  input JSONB,
  expected_output JSONB,
  status VARCHAR(32) DEFAULT 'CREATED',                  -- CREATED|QUEUED|ASSIGNED|RUNNING|WAITING|BLOCKED|FAILED|RETRYING|COMPLETED|CANCELLED|ESCALATED
  retry_count INT DEFAULT 0,
  idempotency_key VARCHAR(128) NOT NULL,
  deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

-- =====================================================================
