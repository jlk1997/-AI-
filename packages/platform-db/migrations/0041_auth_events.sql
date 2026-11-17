-- Successful sign-ins. Idempotent so a rerun does not drop history.

CREATE TABLE IF NOT EXISTS auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user_created
  ON auth_events (user_id, created_at DESC);
