-- 走向盘: adjudicable nodes, options, and locked stakes. One wallet.
ALTER TABLE world_whispers
  ADD COLUMN IF NOT EXISTS course_node_id uuid,
  ADD COLUMN IF NOT EXISTS course_option_id uuid;

CREATE TABLE IF NOT EXISTS world_course_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  community_game_id uuid REFERENCES community_games(id) ON DELETE SET NULL,
  prompt text NOT NULL,
  kind text NOT NULL DEFAULT 'night_market',
  status text NOT NULL DEFAULT 'open',
  opens_at timestamptz NOT NULL DEFAULT now(),
  betting_closes_at timestamptz NOT NULL,
  settles_at timestamptz NOT NULL,
  transcript_hash text,
  winning_option_id uuid,
  void_reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_course_nodes_world_status
  ON world_course_nodes (world_id, status);
CREATE INDEX IF NOT EXISTS idx_course_nodes_game_status
  ON world_course_nodes (community_game_id, status);
CREATE INDEX IF NOT EXISTS idx_course_nodes_settle
  ON world_course_nodes (settles_at, status);

CREATE TABLE IF NOT EXISTS world_course_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES world_course_nodes(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  predicate_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS world_course_options_node_key_uq
  ON world_course_options (node_id, key);

CREATE TABLE IF NOT EXISTS world_course_stakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES world_course_nodes(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES world_course_options(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  points integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS world_course_stakes_node_org_uq
  ON world_course_stakes (node_id, organization_id);

INSERT INTO schema_migrations (id)
VALUES ('0035_world_course')
ON CONFLICT (id) DO NOTHING;
