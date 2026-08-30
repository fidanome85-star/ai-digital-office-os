-- 24. BUDGET TIERS  (services/cost-usage-service — closes the Phase 2
-- gap: GET /costs always returned budget_status='OK' because no
-- persisted budget definition existed to compare consumption against.
-- =====================================================================

CREATE TABLE budget_tiers (
  budget_tier_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  period VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',  -- DAILY|MONTHLY
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  soft_limit NUMERIC(18,8) NOT NULL,
  hard_limit NUMERIC(18,8) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, period)
);

ALTER TABLE budget_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_budget_tiers ON budget_tiers
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
