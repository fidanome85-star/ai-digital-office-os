-- Agent Registry v1.1 Schema
CREATE TABLE IF NOT EXISTS agent_registry_v1_1 (
    agent_id VARCHAR(64) PRIMARY KEY,
    agent_name VARCHAR(128) NOT NULL,
    parent_agent_id VARCHAR(64) REFERENCES agent_registry_v1_1(agent_id),
    department VARCHAR(64) NOT NULL,
    role VARCHAR(128) NOT NULL,
    description TEXT,
    capabilities JSONB NOT NULL,
    allowed_tools JSONB NOT NULL,
    permissions JSONB NOT NULL,
    preferred_model_capability VARCHAR(64),
    preferred_provider VARCHAR(64),
    preferred_model VARCHAR(64),
    fallback_models JSONB DEFAULT '[]',
    input_schema JSONB NOT NULL,
    output_schema JSONB NOT NULL,
    security_level VARCHAR(16) DEFAULT 'STANDARD',
    sandbox_policy VARCHAR(32) DEFAULT 'STRICT',
    lifecycle_state VARCHAR(32) DEFAULT 'DRAFT',
    evaluation_score NUMERIC(5,2) DEFAULT 0.00,
    success_rate NUMERIC(5,2) DEFAULT 100.00,
    average_latency_ms INT DEFAULT 0,
    average_cost_usd NUMERIC(8,4) DEFAULT 0.0000,
    version VARCHAR(16) DEFAULT '1.1.0',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

