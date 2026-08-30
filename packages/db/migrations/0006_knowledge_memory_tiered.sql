-- 6. KNOWLEDGE & MEMORY — TIERED  (clause 47)
-- =====================================================================

-- Tier 1: working memory (fast, short-lived; TTL enforced by application
-- job or Postgres partition rotation, default TTL 4 hours).
CREATE TABLE working_memory_cache (
  cache_key VARCHAR(256) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  task_id VARCHAR(64),
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tier 2: durable structured memory.
CREATE TABLE memory_facts (
  memory_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  scope VARCHAR(16) NOT NULL,                            -- AGENT|PROJECT|ORG
  subject_type VARCHAR(32) NOT NULL,
  subject_id VARCHAR(64) NOT NULL,
  fact TEXT NOT NULL,
  source_reference VARCHAR(128),
  confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- Tier 3: semantic memory (pgvector, HNSW-indexed).
CREATE TABLE memory_embeddings (
  embedding_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  memory_fact_id UUID REFERENCES memory_facts(memory_id),
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  embedding_model VARCHAR(96) NOT NULL,                  -- prevents mixing incompatible embedding spaces
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_memory_embeddings_hnsw
  ON memory_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- =====================================================================
