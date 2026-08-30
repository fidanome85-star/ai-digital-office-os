-- 20. INDEXES  (clause 56 — every FK indexed, every tenant_id composite)
-- =====================================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_membership_tenant_user ON user_organization_membership(tenant_id, user_id);
CREATE INDEX idx_roles_tenant ON roles(tenant_id);
CREATE INDEX idx_role_permissions_tenant_role ON role_permissions(tenant_id, role_id);
CREATE INDEX idx_user_roles_tenant_user ON user_roles(tenant_id, user_id);

CREATE INDEX idx_agent_registry_tenant_status ON agent_registry(tenant_id, status);
CREATE INDEX idx_agent_registry_tenant_lifecycle ON agent_registry(tenant_id, lifecycle_state);
CREATE INDEX idx_prompt_registry_tenant_agent ON prompt_registry(tenant_id, agent_id);

CREATE INDEX idx_policy_registry_tenant ON policy_registry(tenant_id, status);
CREATE INDEX idx_approval_requests_tenant_status ON approval_requests(tenant_id, decision);

CREATE INDEX idx_workflow_registry_tenant_status ON workflow_registry(tenant_id, status);
CREATE INDEX idx_workflow_history_tenant_workflow ON workflow_history(tenant_id, workflow_id, sequence_no);
CREATE INDEX idx_task_registry_tenant_status ON task_registry(tenant_id, status);
CREATE INDEX idx_task_registry_tenant_workflow ON task_registry(tenant_id, workflow_id);

CREATE INDEX idx_agent_messages_tenant_receiver ON agent_messages(tenant_id, receiver_agent_id, status);
CREATE INDEX idx_agent_messages_tenant_workflow ON agent_messages(tenant_id, workflow_id);

CREATE INDEX idx_working_memory_tenant_expiry ON working_memory_cache(tenant_id, expires_at);
CREATE INDEX idx_memory_facts_tenant_subject ON memory_facts(tenant_id, subject_type, subject_id);

CREATE INDEX idx_artifact_registry_tenant_project ON artifact_registry(tenant_id, project_id, status);
CREATE INDEX idx_artifact_registry_tenant_task ON artifact_registry(tenant_id, task_id);

CREATE INDEX idx_decision_records_tenant_project ON decision_records(tenant_id, project_id);
CREATE INDEX idx_audit_events_tenant_correlation ON audit_events(tenant_id, correlation_id);
CREATE INDEX idx_audit_events_tenant_created ON audit_events(tenant_id, created_at);

CREATE INDEX idx_secrets_refs_tenant ON secrets_vault_references(tenant_id, scope_agent_id);
CREATE INDEX idx_feature_flags_tenant_key ON feature_flags(tenant_id, flag_key, environment);
CREATE INDEX idx_config_versions_tenant_env ON configuration_versions(tenant_id, environment, created_at);

-- v1.4 new-table indexes
CREATE INDEX idx_project_registry_tenant_lifecycle ON project_registry(tenant_id, lifecycle_state);
CREATE INDEX idx_agent_versions_tenant_agent ON agent_versions(tenant_id, agent_id, version);
CREATE INDEX idx_agent_runs_tenant_task ON agent_runs(tenant_id, task_id);
CREATE INDEX idx_agent_runs_tenant_agent ON agent_runs(tenant_id, agent_id);
CREATE INDEX idx_model_runs_tenant_agentrun ON model_runs(tenant_id, agent_run_id);
CREATE INDEX idx_model_eval_runs_model ON model_evaluation_runs(model_id, executed_at);
CREATE INDEX idx_model_eval_metrics_eval ON model_evaluation_metrics(evaluation_id);
CREATE INDEX idx_usage_events_tenant_project ON usage_events(tenant_id, project_id, event_time);
CREATE INDEX idx_usage_events_tenant_agent ON usage_events(tenant_id, agent_id, event_time);
CREATE INDEX idx_release_registry_tenant_project ON release_registry(tenant_id, project_id);
CREATE INDEX idx_deployment_registry_tenant_project ON deployment_registry(tenant_id, project_id, status);
CREATE INDEX idx_tool_registry_mcp_server ON tool_registry(mcp_server_id);
CREATE INDEX idx_agent_tool_bindings_tenant_agent ON agent_tool_bindings(tenant_id, agent_id);
CREATE INDEX idx_policy_decisions_tenant_task ON policy_decision_records(tenant_id, task_id);
CREATE INDEX idx_routing_decisions_tenant_task ON routing_decision_records(tenant_id, task_id);

-- =====================================================================
