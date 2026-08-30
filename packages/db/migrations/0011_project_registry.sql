-- 11. PROJECT REGISTRY  (v1.4 clause 59 — closes CRITICAL finding)
-- Authoritative record for every project_id referenced elsewhere.
-- =====================================================================

CREATE TABLE project_registry (
  project_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_name VARCHAR(200) NOT NULL,
  project_type VARCHAR(64) NOT NULL,          -- free-form; no product type is special-cased (clause 75)
  constitution_version VARCHAR(32),
  lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'DISCOVERY',
  risk_level VARCHAR(16) NOT NULL DEFAULT 'GREEN',
  owner_user_id UUID REFERENCES users(user_id),
  repository_ref VARCHAR(256),
  environment_policy JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Retrofit FK integrity onto existing project_id columns (v1.3 tables had
-- free-text project_id with no referenced table to point to).
ALTER TABLE task_registry ADD CONSTRAINT fk_task_project FOREIGN KEY (project_id) REFERENCES project_registry(project_id);
ALTER TABLE workflow_registry ADD CONSTRAINT fk_workflow_project FOREIGN KEY (project_id) REFERENCES project_registry(project_id);
ALTER TABLE artifact_registry ADD CONSTRAINT fk_artifact_project FOREIGN KEY (project_id) REFERENCES project_registry(project_id);
ALTER TABLE decision_records ADD CONSTRAINT fk_decision_project FOREIGN KEY (project_id) REFERENCES project_registry(project_id);

-- =====================================================================
