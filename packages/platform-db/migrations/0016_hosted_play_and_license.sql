-- Hosted playback + an explicit remix licence.
--
-- Published work is played through short-lived, server-issued play sessions
-- rather than a permanent object URL, and "change one line" becomes an
-- authorised, server-side fork instead of an invitation to download the build.
-- `license` is what the fork endpoint checks; existing rows keep the permissive
-- behaviour they were published under.

ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS license TEXT NOT NULL DEFAULT 'remix-ok';

-- Where this work may be framed from. Empty/null means "our own origins only".
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS embed_origins JSONB;

-- Denormalised counter so a work page can show how often it was built on.
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS remix_count INTEGER NOT NULL DEFAULT 0;

-- Author's opt-out of the visible watermark (paid plans only, enforced in API).
ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS watermark BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_games_license_check'
  ) THEN
    ALTER TABLE community_games
      ADD CONSTRAINT community_games_license_check
      CHECK (license IN ('remix-ok', 'remix-credit', 'no-remix'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_community_games_license
  ON community_games (license);

/*
 * Fingerprint of every play session we hand out. The token itself is signed and
 * stateless, but a row here is what makes abuse answerable: revoke a session,
 * count concurrent streams per work, and trace a leaked bundle back to the
 * session that served it.
 */
CREATE TABLE IF NOT EXISTS play_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_game_id UUID REFERENCES community_games (id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  -- SHA-256 of user agent + client IP prefix; never the raw address.
  client_fingerprint TEXT NOT NULL,
  referer_origin TEXT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_game
  ON play_sessions (community_game_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_play_sessions_expiry
  ON play_sessions (expires_at);
