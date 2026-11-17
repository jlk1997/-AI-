-- Dual-launch privacy: age + legal acceptance, and a reversible takedown appeal.

ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_legal_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS content_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_game_id UUID NOT NULL REFERENCES community_games (id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_appeals_author
  ON content_appeals (author_user_id, created_at DESC);

INSERT INTO schema_migrations (id)
VALUES ('0034_launch_privacy')
ON CONFLICT (id) DO NOTHING;
