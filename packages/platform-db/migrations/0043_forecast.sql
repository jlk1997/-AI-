-- Scenario jobs, one row per run, and the stylized case library.

CREATE TABLE IF NOT EXISTS forecast_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title text NOT NULL,
  spec_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forecast_scenarios_world_idx
  ON forecast_scenarios (world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forecast_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  scenario_id uuid,
  status text NOT NULL DEFAULT 'queued',
  spec_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forecast_runs_status_idx
  ON forecast_runs (status, created_at);

CREATE TABLE IF NOT EXISTS historical_cases (
  id text PRIMARY KEY,
  title text NOT NULL,
  body_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
