-- Community social tables used by GameDetail (ratings, comments, tags, leaderboards).
-- Matches packages/platform-db/src/schema.ts.

CREATE TABLE IF NOT EXISTS game_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS game_ratings_deployment_user_uq
  ON game_ratings (deployment_id, user_id);

CREATE TABLE IF NOT EXISTS game_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_id UUID,
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_comments_deployment
  ON game_comments (deployment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_tag_mappings (
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES game_tags (id) ON DELETE CASCADE,
  PRIMARY KEY (deployment_id, tag_id)
);

CREATE TABLE IF NOT EXISTS game_leaderboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  metadata JSONB,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_leaderboards_deployment_score
  ON game_leaderboards (deployment_id, score DESC);
