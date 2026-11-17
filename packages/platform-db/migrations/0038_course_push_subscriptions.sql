-- Web Push subscriptions for course settle / close alerts.
CREATE TABLE IF NOT EXISTS course_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_course_push_subscriptions_user
  ON course_push_subscriptions (user_id);
