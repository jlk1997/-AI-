-- Durable opinion layer. Meta rows in society_events stay the live tip.
-- These tables are the replay and report copy. Default mind_enabled is off.

ALTER TABLE worlds ADD COLUMN IF NOT EXISTS mind_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS world_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'notice',
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  effects_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending boolean NOT NULL DEFAULT true,
  sim_time numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS world_policies_world_key_uq
  ON world_policies (world_id, policy_key);

CREATE TABLE IF NOT EXISTS agent_opinions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  topic_key text NOT NULL,
  stance numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  emotion text,
  action text,
  sim_time numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_opinions_topic_uq
  ON agent_opinions (world_id, agent_key, topic_key);

CREATE TABLE IF NOT EXISTS crowd_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  cohort_key text NOT NULL,
  label text NOT NULL,
  region_id text NOT NULL,
  occupation text NOT NULL DEFAULT '',
  size integer NOT NULL DEFAULT 0,
  hist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crowd_cohorts_world_key_uq
  ON crowd_cohorts (world_id, cohort_key);

CREATE TABLE IF NOT EXISTS society_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'baseline',
  hours integer NOT NULL,
  bands_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS society_forecasts_world_idx
  ON society_forecasts (world_id, created_at DESC);
