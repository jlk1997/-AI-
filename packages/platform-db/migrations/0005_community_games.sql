-- Community gallery: one row per published deployment shown in the community UI.
-- Matches packages/platform-db/src/schema.ts `communityGames`.

CREATE TABLE IF NOT EXISTS community_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL UNIQUE REFERENCES deployments (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  thumbnail TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  play_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_games_category ON community_games (category);
CREATE INDEX IF NOT EXISTS idx_community_games_featured ON community_games (is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_community_games_published_at ON community_games (published_at DESC);
