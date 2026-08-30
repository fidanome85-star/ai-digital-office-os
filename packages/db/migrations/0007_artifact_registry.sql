-- 7. ARTIFACT REGISTRY  (clause 48)
-- =====================================================================

CREATE TABLE artifact_registry (
  artifact_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64),
  task_id VARCHAR(64) REFERENCES task_registry(task_id),
  agent_run_id VARCHAR(64),
  model_run_id VARCHAR(64),
  artifact_type VARCHAR(32) NOT NULL,                    -- CODE|DOC|DESIGN|CONFIG|REPORT|DATASET
  storage_uri TEXT NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  status VARCHAR(32) DEFAULT 'DRAFT',                    -- DRAFT|IN_REVIEW|APPROVED|RELEASED|DEPRECATED
  parent_artifact_id UUID REFERENCES artifact_registry(artifact_id),
  reviewed_by VARCHAR(128),
  approved_by VARCHAR(128),
  git_commit_ref VARCHAR(128),
  deployment_ref VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
