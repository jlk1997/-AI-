-- 开镇双轨：加戏 / 巷议。点数语义从「生成税」改成局内戏剧与镇内影响力。

ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS jiaxi_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS xiangyi_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS jiaxi_cost INTEGER NOT NULL DEFAULT 8;
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS xiangyi_cost INTEGER NOT NULL DEFAULT 6;
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS event_menu JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE weekly_challenges
  ADD COLUMN IF NOT EXISTS entry_points INTEGER NOT NULL DEFAULT 10;
ALTER TABLE weekly_challenges
  ADD COLUMN IF NOT EXISTS pool_points INTEGER NOT NULL DEFAULT 0;

ALTER TABLE world_whispers
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE world_whispers
  ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS kai_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_game_id UUID REFERENCES community_games (id) ON DELETE CASCADE,
  from_organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  to_organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  points INTEGER NOT NULL,
  author_points INTEGER NOT NULL DEFAULT 0,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kai_transfers_game
  ON kai_transfers (community_game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kai_transfers_kind
  ON kai_transfers (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS challenge_entries (
  challenge_id UUID NOT NULL REFERENCES weekly_challenges (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  community_game_id UUID REFERENCES community_games (id) ON DELETE SET NULL,
  points_paid INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, organization_id)
);

CREATE TABLE IF NOT EXISTS project_plugins (
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  plugin_id UUID NOT NULL REFERENCES plugin_packages (id) ON DELETE CASCADE,
  installed_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, plugin_id)
);

CREATE TABLE IF NOT EXISTS project_templates (
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES template_packages (id) ON DELETE CASCADE,
  applied_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, template_id)
);

CREATE TABLE IF NOT EXISTS sandbox_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_game_id UUID NOT NULL REFERENCES community_games (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  stimulus TEXT NOT NULL,
  contrast BOOLEAN NOT NULL DEFAULT FALSE,
  report JSONB,
  points_paid INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_runs_game
  ON sandbox_runs (community_game_id, created_at DESC);
