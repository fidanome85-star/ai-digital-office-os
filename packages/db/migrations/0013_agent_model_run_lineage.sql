-- 13. AGENT RUN & MODEL RUN LINEAGE  (v1.4 clause 61 — closes CRITICAL finding)
-- These are the entities artifact_registry.agent_run_id / model_run_id
-- already referenced by name in v1.3 without a backing table.
-- =====================================================================

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

-- Retrofit real FKs onto artifact_registry's previously-unbacked columns.
-- artifact_registry.agent_run_id / model_run_id were VARCHAR(64) in v1.3
-- with no referenced table; they now point at the tables above.
ALTER TABLE artifact_registry ADD CONSTRAINT fk_artifact_agent_run FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id);
ALTER TABLE artifact_registry ADD CONSTRAINT fk_artifact_model_run FOREIGN KEY (model_run_id) REFERENCES model_runs(model_run_id);

-- =====================================================================
