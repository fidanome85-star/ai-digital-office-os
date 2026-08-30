-- AI DIGITAL OFFICE OS v1.4 INTEGRITY PATCH
-- Apply conceptually to the v1.3 schema after review and migration planning.

CREATE TABLE project_registry (
  project_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_name VARCHAR(200) NOT NULL,
  project_type VARCHAR(64) NOT NULL,
  constitution_version VARCHAR(32),
  lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'DISCOVERY',
  risk_level VARCHAR(16) NOT NULL DEFAULT 'GREEN',
  owner_user_id UUID,
  repository_ref VARCHAR(256),
  environment_policy JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_versions (
  agent_version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  version VARCHAR(32) NOT NULL,
  specification_hash VARCHAR(128) NOT NULL,
  prompt_version VARCHAR(32),
  model_policy JSONB,
  permissions_snapshot JSONB,
  evaluation_score NUMERIC(6,3),
  lifecycle_state VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, agent_id, version)
);

CREATE TABLE agent_runs (
  agent_run_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64) REFERENCES task_registry(task_id),
  agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  agent_version_id UUID REFERENCES agent_versions(agent_version_id),
  status VARCHAR(32) NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  input_hash VARCHAR(128),
  output_hash VARCHAR(128),
  error JSONB
);

CREATE TABLE model_runs (
  model_run_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  agent_run_id VARCHAR(64) REFERENCES agent_runs(agent_run_id),
  provider_id VARCHAR(64) REFERENCES provider_registry(provider_id),
  model_id VARCHAR(64) REFERENCES model_registry(model_id),
  routing_reason TEXT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  estimated_cost NUMERIC(18,8),
  currency VARCHAR(8) DEFAULT 'USD',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status VARCHAR(32)
);

CREATE TABLE model_evaluation_runs (
  evaluation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id VARCHAR(64) REFERENCES provider_registry(provider_id),
  model_id VARCHAR(64) REFERENCES model_registry(model_id),
  model_version VARCHAR(64),
  benchmark_suite VARCHAR(128) NOT NULL,
  evaluator_version VARCHAR(64),
  score NUMERIC(8,4),
  results JSONB,
  executed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE usage_events (
  usage_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  task_id VARCHAR(64),
  agent_id VARCHAR(64),
  agent_run_id VARCHAR(64),
  model_run_id VARCHAR(64),
  provider_id VARCHAR(64),
  model_id VARCHAR(64),
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  request_count INT DEFAULT 1,
  actual_cost NUMERIC(18,8),
  currency VARCHAR(8) DEFAULT 'USD',
  event_time TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deployment_registry (
  deployment_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  release_id VARCHAR(64),
  environment VARCHAR(32) NOT NULL,
  strategy VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  artifact_refs JSONB,
  approval_request_id VARCHAR(64),
  rollback_target VARCHAR(64),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE release_registry (
  release_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  version VARCHAR(64) NOT NULL,
  artifact_refs JSONB NOT NULL,
  status VARCHAR(32) NOT NULL,
  approved_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE mcp_server_registry (
  mcp_server_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID REFERENCES organizations(tenant_id),
  server_name VARCHAR(160) NOT NULL,
  endpoint TEXT NOT NULL,
  version VARCHAR(64),
  trust_level VARCHAR(32) NOT NULL DEFAULT 'UNTRUSTED',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tool_registry (
  tool_id VARCHAR(64) PRIMARY KEY,
  mcp_server_id VARCHAR(64) REFERENCES mcp_server_registry(mcp_server_id),
  tool_name VARCHAR(160) NOT NULL,
  version VARCHAR(64),
  input_schema JSONB,
  output_schema JSONB,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'GREEN',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_tool_bindings (
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  tool_id VARCHAR(64) NOT NULL REFERENCES tool_registry(tool_id),
  allowed_actions JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, agent_id, tool_id)
);

CREATE TABLE policy_decision_records (
  policy_decision_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64),
  agent_id VARCHAR(64),
  tool_id VARCHAR(64),
  model_id VARCHAR(64),
  provider_id VARCHAR(64),
  decision VARCHAR(32) NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  alternatives JSONB,
  rejection_reasons JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE routing_decision_records (
  routing_decision_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64),
  agent_id VARCHAR(64),
  selected_provider VARCHAR(64),
  selected_model VARCHAR(64),
  candidate_models JSONB,
  reason TEXT,
  policy_result VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agent_messages ADD COLUMN idempotency_key VARCHAR(128);
CREATE UNIQUE INDEX ux_agent_messages_tenant_idempotency
  ON agent_messages(tenant_id, idempotency_key);

-- v1.4 rule: RLS must be applied to ALL tenant-scoped operational tables,
-- not only the four-table v1.3 baseline. Each policy must include both
-- USING and WITH CHECK and must be tested with adversarial cross-tenant cases.

-- v1.4 rule: artifact_registry.agent_run_id and model_run_id must reference
-- agent_runs(agent_run_id) and model_runs(model_run_id) after migration.

-- v1.4 rule: project_id in task_registry, workflow_registry, artifacts,
-- decisions, deployments and releases must reference project_registry.
