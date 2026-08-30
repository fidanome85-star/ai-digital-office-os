-- 16. DEPLOYMENT & RELEASE REGISTRY  (v1.4 clause 66 — closes HIGH finding)
-- Replaces artifact_registry's free-text deployment_ref.
-- =====================================================================

CREATE TABLE release_registry (
  release_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64) REFERENCES project_registry(project_id),
  version VARCHAR(64) NOT NULL,
  artifact_refs JSONB NOT NULL,
  status VARCHAR(32) NOT NULL,
  approved_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deployment_registry (
  deployment_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  project_id VARCHAR(64) REFERENCES project_registry(project_id),
  release_id VARCHAR(64) REFERENCES release_registry(release_id),
  environment VARCHAR(32) NOT NULL,
  strategy VARCHAR(32) NOT NULL,               -- standard|rolling|blue_green|canary (clause 27)
  status VARCHAR(32) NOT NULL,
  artifact_refs JSONB,
  approval_request_id VARCHAR(64) REFERENCES approval_requests(request_id),
  rollback_target VARCHAR(64) REFERENCES deployment_registry(deployment_id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- =====================================================================
