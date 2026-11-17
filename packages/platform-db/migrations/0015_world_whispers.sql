-- Visitors can leave a whisper in someone else's published town. The society
-- intervention itself lands in `society_events`; this table keeps the attributed
-- guestbook so a world page can show "what got said here tonight" to readers
-- who are not the author (and without exposing the whole event stream).

CREATE TABLE IF NOT EXISTS world_whispers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  agent_key TEXT,
  text TEXT NOT NULL,
  sim_time NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_whispers_recent
  ON world_whispers (deployment_id, created_at DESC);
