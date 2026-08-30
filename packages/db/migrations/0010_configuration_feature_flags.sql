-- 10. CONFIGURATION & FEATURE FLAGS  (clause 51)
-- =====================================================================

CREATE TABLE feature_flags (
  flag_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES organizations(tenant_id),    -- NULL = global default
  flag_key VARCHAR(128) NOT NULL,
  flag_type VARCHAR(16) NOT NULL DEFAULT 'BOOLEAN',      -- BOOLEAN|PERCENTAGE|VARIANT
  default_value JSONB NOT NULL,
  tenant_override_value JSONB,
  environment VARCHAR(32) NOT NULL DEFAULT 'production',
  status VARCHAR(32) DEFAULT 'ACTIVE',
  created_by VARCHAR(128),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, flag_key, environment)
);

CREATE TABLE configuration_versions (
  config_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES organizations(tenant_id),
  environment VARCHAR(32) NOT NULL,
  version VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL,
  validated BOOLEAN NOT NULL DEFAULT FALSE,
  rollback_of UUID REFERENCES configuration_versions(config_id),
  created_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
