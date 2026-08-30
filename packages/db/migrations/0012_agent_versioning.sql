-- 12. AGENT VERSIONING  (v1.4 clause 60 — closes CRITICAL finding)
-- Updating an ACTIVE agent creates a new row here; agent_registry itself
-- is never overwritten in place.
-- =====================================================================

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
  lifecycle_state VARCHAR(32) NOT NULL,        -- DRAFT|SANDBOX|TESTED|EVALUATED|APPROVED|ACTIVE|DEPRECATED|RETIRED
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, agent_id, version)
);

-- Activation now targets a specific version, not just the agent identity.
ALTER TABLE agent_registry ADD COLUMN active_agent_version_id UUID REFERENCES agent_versions(agent_version_id);

-- =====================================================================
