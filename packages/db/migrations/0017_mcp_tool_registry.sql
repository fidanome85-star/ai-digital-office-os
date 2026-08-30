-- 17. MCP TOOL REGISTRY & AGENT-TOOL BINDINGS  (v1.4 clause 67 — closes HIGH finding)
-- =====================================================================

CREATE TABLE mcp_server_registry (
  mcp_server_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID REFERENCES organizations(tenant_id),      -- NULL = platform-wide server
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

-- Supersedes agent_registry.allowed_tools JSONB as the policy-checkable
-- binding surface; allowed_tools is retained for backward compatibility
-- but agent_tool_bindings is the authoritative source going forward.
CREATE TABLE agent_tool_bindings (
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  tool_id VARCHAR(64) NOT NULL REFERENCES tool_registry(tool_id),
  allowed_actions JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, agent_id, tool_id)
);

-- =====================================================================
