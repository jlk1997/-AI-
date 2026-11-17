-- Weekly challenges, paid templates, and a forensic fingerprint on published works.

ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS challenge_id UUID;

CREATE TABLE IF NOT EXISTS weekly_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  constraint_json JSONB,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_challenges_window
  ON weekly_challenges (starts_at, ends_at);

ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL;
ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS price_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE template_packages
  ADD COLUMN IF NOT EXISTS revenue_points INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS template_entitlements (
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES template_packages (id) ON DELETE CASCADE,
  granted_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  points_paid INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, template_id)
);

INSERT INTO weekly_challenges (slug, title, prompt, constraint_json, starts_at, ends_at)
SELECT
  'portrait-60s',
  '本周只做竖屏 60 秒',
  '做一个竖屏、一分钟就能打完的小游戏。点开就能玩，改一句就能变成你的。',
  '{"orientation":"portrait","seconds":60}'::jsonb,
  date_trunc('week', now()),
  date_trunc('week', now()) + interval '7 days'
WHERE NOT EXISTS (SELECT 1 FROM weekly_challenges LIMIT 1);
