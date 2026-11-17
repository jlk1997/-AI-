-- World model tables (symbolic World Spec SSOT)

CREATE TABLE IF NOT EXISTS worlds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  tip_revision integer NOT NULL DEFAULT 1,
  spec_json jsonb NOT NULL,
  memory_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worlds_project ON worlds (project_id);

CREATE TABLE IF NOT EXISTS world_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  parent_revision integer,
  op_json jsonb,
  spec_json jsonb NOT NULL,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS world_revisions_world_rev_uq
  ON world_revisions (world_id, revision);

CREATE TABLE IF NOT EXISTS world_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  region_id text NOT NULL,
  chunk_key text NOT NULL,
  data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS world_chunks_region_key_uq
  ON world_chunks (world_id, region_id, chunk_key);

CREATE TABLE IF NOT EXISTS sim_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  time_hours numeric NOT NULL,
  events_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_checkpoints_world ON sim_checkpoints (world_id);
