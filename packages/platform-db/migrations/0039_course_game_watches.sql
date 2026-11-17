-- Lightweight「观望」subscription: notify when a town opens / closes / settles a board.
CREATE TABLE IF NOT EXISTS course_game_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_course_game_watches_game
  ON course_game_watches (game_id);

CREATE INDEX IF NOT EXISTS idx_course_game_watches_user
  ON course_game_watches (user_id);
