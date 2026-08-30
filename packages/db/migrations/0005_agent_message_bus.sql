-- 5. AGENT-TO-AGENT MESSAGE BUS  (clause 42)
-- =====================================================================

CREATE TABLE agent_messages (
  message_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64) REFERENCES task_registry(task_id),
  workflow_id VARCHAR(64) REFERENCES workflow_registry(workflow_id),
  sender_agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  receiver_agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  message_type VARCHAR(64) NOT NULL,
  purpose TEXT,
  priority VARCHAR(16),
  security_level VARCHAR(16),
  input_payload JSONB,
  expected_output_schema JSONB,
  dependencies JSONB DEFAULT '[]',
  deadline TIMESTAMPTZ,
  artifact_reference VARCHAR(64),
  status VARCHAR(32) DEFAULT 'SENT',                     -- SENT|DELIVERED|ACKNOWLEDGED|FAILED
  result JSONB,
  error JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ
);

-- Optional external interoperability surface (disabled by default; see
-- clause 42/54). Publishes this Office's agents as A2A-discoverable cards.
CREATE TABLE a2a_capability_cards (
  card_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agent_registry(agent_id),
  card_payload JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
