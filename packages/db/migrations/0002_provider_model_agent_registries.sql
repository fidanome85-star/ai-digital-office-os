-- 2. PROVIDER / MODEL / AGENT REGISTRIES  (Blueprint clauses 6-11, 41)
-- =====================================================================

CREATE TABLE provider_registry (
  provider_id VARCHAR(64) PRIMARY KEY,
  provider_name VARCHAR(128) NOT NULL,
  provider_type VARCHAR(64) NOT NULL,
  adapter_type VARCHAR(128) NOT NULL,
  protocol VARCHAR(64),
  base_endpoint TEXT,
  authentication_method VARCHAR(64),
  supported_capabilities JSONB NOT NULL DEFAULT '[]',
  supported_models JSONB NOT NULL DEFAULT '[]',
  rate_limits JSONB,
  quota_rules JSONB,
  pricing_rules JSONB,
  privacy_classification VARCHAR(32),
  data_residency JSONB,
  availability VARCHAR(32) DEFAULT 'ACTIVE',
  health_status VARCHAR(32) DEFAULT 'UNKNOWN',
  version VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE model_registry (
  model_id VARCHAR(64) PRIMARY KEY,
  provider_id VARCHAR(64) NOT NULL REFERENCES provider_registry(provider_id),
  model_name VARCHAR(160) NOT NULL,
  model_version VARCHAR(64),
  capabilities JSONB NOT NULL DEFAULT '[]',
  context_window INT,
  input_types JSONB,
  output_types JSONB,
  tool_calling BOOLEAN DEFAULT FALSE,
  structured_output BOOLEAN DEFAULT FALSE,
  vision BOOLEAN DEFAULT FALSE,
  coding BOOLEAN DEFAULT FALSE,
  reasoning BOOLEAN DEFAULT FALSE,
  research BOOLEAN DEFAULT FALSE,
  latency_profile JSONB,
  cost_profile JSONB,
  privacy_classification VARCHAR(32),
  local_cloud VARCHAR(16),
  availability VARCHAR(32) DEFAULT 'ACTIVE',
  health_status VARCHAR(32) DEFAULT 'UNKNOWN',
  evaluation_score NUMERIC(6,3),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- NULL tenant_id = system agent template a tenant may clone; every
-- executable/running agent row MUST have a non-null tenant_id.
CREATE TABLE agent_registry (
  agent_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID REFERENCES organizations(tenant_id),
  agent_name VARCHAR(128) NOT NULL,
  department VARCHAR(64) NOT NULL,
  role VARCHAR(128) NOT NULL,
  purpose TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  allowed_tools JSONB NOT NULL DEFAULT '[]',
  permissions JSONB NOT NULL DEFAULT '[]',
  data_access JSONB NOT NULL DEFAULT '[]',
  preferred_capabilities JSONB NOT NULL DEFAULT '[]',
  preferred_provider VARCHAR(64) REFERENCES provider_registry(provider_id),
  preferred_model VARCHAR(64) REFERENCES model_registry(model_id),
  fallback_models JSONB NOT NULL DEFAULT '[]',
  input_schema JSONB,
  output_schema JSONB,
  security_level VARCHAR(16) DEFAULT 'GREEN',
  lifecycle_state VARCHAR(32) DEFAULT 'DRAFT',           -- DRAFT|SANDBOX|TESTED|EVALUATED|APPROVED|ACTIVE|UPDATED|DEPRECATED|RETIRED
  status VARCHAR(32) DEFAULT 'INACTIVE',
  version VARCHAR(32) DEFAULT '1.0.0',
  parent_agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  evaluation_score NUMERIC(6,3),
  success_rate NUMERIC(6,3),
  average_latency_ms INT,
  average_cost NUMERIC(12,6),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE prompt_registry (
  prompt_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID REFERENCES organizations(tenant_id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  version VARCHAR(32) NOT NULL,
  system_instruction TEXT NOT NULL,
  variables JSONB,
  input_contract JSONB,
  output_contract JSONB,
  evaluation_score NUMERIC(6,3),
  security_classification VARCHAR(32),
  changelog TEXT,
  rollback_version VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
