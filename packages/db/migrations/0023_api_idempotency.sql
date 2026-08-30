-- 23. API-LEVEL IDEMPOTENCY  (services/control-plane-api openapi — closes a
-- minor spec-internal inconsistency: the OpenAPI Idempotency-Key parameter
-- description says it is "required on every state-changing (POST/PATCH/
-- DELETE) request", but only a subset of operations actually reference it
-- via $ref. control-plane-api adopts the stated global intent and enforces
-- Idempotency-Key on every POST/PATCH/DELETE; this table is the generic
-- backing store for that. task_registry already had its own narrower
-- (tenant_id, idempotency_key) uniqueness for task creation specifically —
-- this table is for everything else.
-- =====================================================================

CREATE TABLE api_idempotency_keys (
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  idempotency_key VARCHAR(200) NOT NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  response_status INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_api_idempotency_keys ON api_idempotency_keys
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
