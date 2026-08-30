-- 9. SECRETS REFERENCES (no raw secrets ever stored — clause 46)
-- =====================================================================

CREATE TABLE secrets_vault_references (
  reference_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  secret_name VARCHAR(160) NOT NULL,
  vault_path TEXT NOT NULL,                              -- pointer only, e.g. into an external KMS/Vault
  scope_agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  scope_provider_id VARCHAR(64) REFERENCES provider_registry(provider_id),
  scope_tool VARCHAR(96),
  rotation_policy VARCHAR(64),
  last_rotated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
