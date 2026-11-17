-- Deep cognition is opt-in. Classic towns keep the old loop.

ALTER TABLE worlds ADD COLUMN IF NOT EXISTS cognition text NOT NULL DEFAULT 'classic';
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS violence_public boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS world_deep_state (
  world_id uuid PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_psyche (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  psyche_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_psyche_world_key_uq
  ON agent_psyche (world_id, agent_key);

CREATE TABLE IF NOT EXISTS agent_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_key text NOT NULL DEFAULT '',
  sim_time numeric NOT NULL DEFAULT 0,
  intent text NOT NULL DEFAULT '',
  action_text text NOT NULL DEFAULT '',
  monologue text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_action_log_world_idx
  ON agent_action_log (world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_ledger_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  sim_time numeric NOT NULL DEFAULT 0,
  ledger_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_ledger_snapshots_world_idx
  ON world_ledger_snapshots (world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  inst_key text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  body_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS world_institutions_world_key_uq
  ON world_institutions (world_id, inst_key);

CREATE TABLE IF NOT EXISTS world_chronicle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  sim_time numeric NOT NULL DEFAULT 0,
  text text NOT NULL,
  surprise boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_chronicle_world_idx
  ON world_chronicle (world_id, sim_time);
