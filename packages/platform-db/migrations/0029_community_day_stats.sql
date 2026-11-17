-- Tonight-at-the-alley heat. Lifetime counters stay on community_games.
CREATE TABLE IF NOT EXISTS community_day_stats (
  game_id UUID NOT NULL REFERENCES community_games (id) ON DELETE CASCADE,
  china_day TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  remixes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, china_day)
);

INSERT INTO schema_migrations (id)
VALUES ('0029_community_day_stats')
ON CONFLICT (id) DO NOTHING;
