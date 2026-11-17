-- P1 identity: a published work should show an author, not a UUID.
-- `handle` is the public page address (/u/:handle); everything else is cosmetic
-- and stays nullable so existing dev accounts keep working untouched.

ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_handle_uq ON users (handle);

-- What a visitor opened, so "played and watched" is a real list instead of
-- being inferred from save slots (most community games never write a save).
CREATE TABLE IF NOT EXISTS user_play_history (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  play_count INTEGER NOT NULL DEFAULT 1,
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, deployment_id)
);

CREATE INDEX IF NOT EXISTS idx_user_play_history_recent
  ON user_play_history (user_id, last_played_at DESC);
