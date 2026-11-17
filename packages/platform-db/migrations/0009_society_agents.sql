-- Generative agent society tables (Smallville-style)

CREATE TABLE IF NOT EXISTS world_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  name text NOT NULL,
  identity_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  region_id text NOT NULL,
  x numeric NOT NULL DEFAULT 0,
  y numeric NOT NULL DEFAULT 0,
  current_action text NOT NULL DEFAULT 'idle',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS world_agents_world_key_uq
  ON world_agents (world_id, agent_key);

CREATE TABLE IF NOT EXISTS agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  sim_time numeric NOT NULL,
  importance integer NOT NULL DEFAULT 3,
  embedding jsonb,
  last_access_sim_time numeric NOT NULL,
  pointers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_memories_world_agent_idx
  ON agent_memories (world_id, agent_key);

CREATE TABLE IF NOT EXISTS agent_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  day_index integer NOT NULL,
  segments_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_plans_world_agent_day_uq
  ON agent_plans (world_id, agent_key, day_index);

CREATE TABLE IF NOT EXISTS society_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  sim_time numeric NOT NULL,
  kind text NOT NULL,
  agent_key text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  invalidated integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS society_events_world_time_idx
  ON society_events (world_id, sim_time);

CREATE UNIQUE INDEX IF NOT EXISTS society_events_world_key_uq
  ON society_events (world_id, event_key);

CREATE TABLE IF NOT EXISTS agent_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  from_agent_key text NOT NULL,
  to_agent_key text NOT NULL,
  summary text NOT NULL DEFAULT '',
  affinity numeric NOT NULL DEFAULT 0,
  last_interact_sim_time numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_relations_pair_uq
  ON agent_relations (world_id, from_agent_key, to_agent_key);
