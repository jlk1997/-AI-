-- P2 community: follows existed in the Drizzle schema but never had a migration,
-- so the API could not use them. `last_seen_sim_time` is what makes a revisit
-- summary possible ("another day went by in this town").

CREATE TABLE IF NOT EXISTS user_followed_games (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  last_seen_sim_time NUMERIC,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, deployment_id)
);

ALTER TABLE user_followed_games ADD COLUMN IF NOT EXISTS last_seen_sim_time NUMERIC;
ALTER TABLE user_followed_games ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_followed_games_user
  ON user_followed_games (user_id, created_at DESC);
