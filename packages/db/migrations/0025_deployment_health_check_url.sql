-- 25. DEPLOYMENT HEALTH CHECK TARGET
-- =====================================================================
-- Real, callable health-check target for services/deployment-orchestrator
-- (Phase 6) to probe. Optional: a deployment created without one behaves
-- exactly as before this migration — no live infra to check, an honest
-- gap (see ADR 0006 §3, ADR 0007).

ALTER TABLE deployment_registry ADD COLUMN health_check_url TEXT;
