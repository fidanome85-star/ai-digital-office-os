-- 21. ROW-LEVEL SECURITY — FULL COVERAGE (v1.4 clause 62 — closes CRITICAL
-- finding: v1.3 enabled RLS on only 4 tables with USING only. v1.4 enables
-- RLS on EVERY tenant-scoped operational table, each with BOTH a USING
-- policy (governs visibility) and a WITH CHECK policy (governs what can be
-- inserted/updated) — USING alone would still let a service-layer bug
-- write a cross-tenant row even though it could never read it back.
--
-- Application must SET app.current_tenant_id per session/request. Tables
-- that legitimately allow NULL tenant_id (system templates: agent_registry,
-- roles, mcp_server_registry, feature_flags) permit NULL rows to be
-- visible/writable only as read-only templates at the application layer;
-- the policies below still require a real session tenant_id to write any
-- non-NULL-tenant row.
-- =====================================================================

-- Helper pattern used throughout: a table with a strictly non-null
-- tenant_id gets a straightforward equality policy on both USING and
-- WITH CHECK. A table that legitimately allows NULL tenant_id (system
-- templates) additionally permits NULL rows to be visible.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_organizations ON organizations
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE user_organization_membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_membership ON user_organization_membership
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_roles ON roles
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_role_permissions ON role_permissions
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_roles ON user_roles
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_agent_registry ON agent_registry
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_agent_versions ON agent_versions
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE prompt_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_prompt_registry ON prompt_registry
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE policy_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy_registry ON policy_registry
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_requests ON approval_requests
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE project_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_project_registry ON project_registry
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE workflow_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_workflow_registry ON workflow_registry
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE workflow_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_workflow_history ON workflow_history
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE task_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_task_registry ON task_registry
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_agent_runs ON agent_runs
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE model_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_model_runs ON model_runs
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_agent_messages ON agent_messages
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE a2a_capability_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_a2a_cards ON a2a_capability_cards
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE working_memory_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_working_memory ON working_memory_cache
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_memory_facts ON memory_facts
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_memory_embeddings ON memory_embeddings
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE artifact_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_artifact_registry ON artifact_registry
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_decision_records ON decision_records
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_events ON audit_events
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE secrets_vault_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_secrets_refs ON secrets_vault_references
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_feature_flags ON feature_flags
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE configuration_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_configuration_versions ON configuration_versions
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_usage_events ON usage_events
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE release_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_release_registry ON release_registry
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE deployment_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_deployment_registry ON deployment_registry
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE mcp_server_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mcp_server_registry ON mcp_server_registry
  USING (tenant_id IS NULL OR tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE agent_tool_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_agent_tool_bindings ON agent_tool_bindings
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE policy_decision_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy_decisions ON policy_decision_records
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE routing_decision_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_routing_decisions ON routing_decision_records
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Tables intentionally left WITHOUT tenant RLS (by design, not oversight):
--   users                — a user row may belong to multiple tenants; the
--                          tenant boundary is enforced via
--                          user_organization_membership, not on users itself.
--   permissions           — system-wide catalog by design (clause 41/44).
--   provider_registry,
--   model_registry,
--   model_evaluation_runs,
--   model_evaluation_metrics,
--   tool_registry          — platform-wide catalogs; tenant-specific access
--                            is enforced at agent_tool_bindings /
--                            agent_registry.preferred_provider level, not here.
-- Every table storing tenant-owned operational DATA has RLS above.
