-- 19. MESSAGE IDEMPOTENCY RETROFIT  (v1.4 clause 63 — closes HIGH finding)
-- =====================================================================

ALTER TABLE agent_messages ADD COLUMN idempotency_key VARCHAR(128);
CREATE UNIQUE INDEX ux_agent_messages_tenant_idempotency
  ON agent_messages(tenant_id, idempotency_key);

-- =====================================================================
