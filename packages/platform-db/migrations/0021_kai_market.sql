-- 开镇市场层：每日任务、认养、课题结算。

ALTER TABLE weekly_challenges
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS daily_stamps (
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  login_granted BOOLEAN NOT NULL DEFAULT FALSE,
  mission_play BOOLEAN NOT NULL DEFAULT FALSE,
  mission_town BOOLEAN NOT NULL DEFAULT FALSE,
  mission_visit BOOLEAN NOT NULL DEFAULT FALSE,
  bonus_granted BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (organization_id, day)
);

CREATE TABLE IF NOT EXISTS resident_adoptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_game_id UUID NOT NULL REFERENCES community_games (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  agent_key TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  until TIMESTAMPTZ NOT NULL,
  points_paid INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resident_adoptions_org_agent_uq
  ON resident_adoptions (community_game_id, organization_id, agent_key);
CREATE INDEX IF NOT EXISTS idx_resident_adoptions_org
  ON resident_adoptions (organization_id, until);
