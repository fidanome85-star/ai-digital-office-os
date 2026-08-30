-- 14. MODEL EVALUATION HISTORY  (v1.4 clause 64 — closes HIGH finding)
-- =====================================================================

CREATE TABLE model_evaluation_runs (
  evaluation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id VARCHAR(64) REFERENCES provider_registry(provider_id),
  model_id VARCHAR(64) REFERENCES model_registry(model_id),
  model_version VARCHAR(64),
  benchmark_suite VARCHAR(128) NOT NULL,
  evaluator_version VARCHAR(64),
  score NUMERIC(8,4),
  results JSONB,
  executed_at TIMESTAMPTZ DEFAULT now()
);

-- Per-metric breakdown (coding/reasoning/tool-use/etc. — clause 11), so a
-- single evaluation_id can carry more than one named metric.
CREATE TABLE model_evaluation_metrics (
  metric_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evaluation_id UUID NOT NULL REFERENCES model_evaluation_runs(evaluation_id),
  metric_name VARCHAR(96) NOT NULL,           -- e.g. 'coding', 'reasoning', 'tool_precision'
  metric_value NUMERIC(10,4) NOT NULL,
  unit VARCHAR(32)
);

-- =====================================================================
