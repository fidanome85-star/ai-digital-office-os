-- 3. POLICY, APPROVAL & ACTIVATION AUTHORITY  (clauses 12-14, 45)
-- =====================================================================

CREATE TABLE policy_registry (
  policy_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID REFERENCES organizations(tenant_id),
  policy_name VARCHAR(160) NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  rules JSONB NOT NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approval_requests (
  request_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64),
  requester VARCHAR(128),
  agent_id VARCHAR(64) REFERENCES agent_registry(agent_id),
  action VARCHAR(128) NOT NULL,                          -- includes 'AGENT_ACTIVATE' per clause 45
  risk_level VARCHAR(16) NOT NULL,                       -- GREEN|YELLOW|RED
  reason TEXT,
  approver VARCHAR(128),
  decision VARCHAR(32),
  expires_at TIMESTAMPTZ,
  execution_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ
);

-- =====================================================================
