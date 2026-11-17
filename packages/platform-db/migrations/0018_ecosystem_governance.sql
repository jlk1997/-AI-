-- People, replies, reports and paid plugins.
--
-- The community so far is a shelf of works: you can follow a town, rate it and
-- leave one flat comment. That is enough to browse and not enough to belong to.
-- This migration adds the three relationships a creator ecosystem actually runs
-- on — following a *person*, arguing in a thread, and reporting what should not
-- be there — plus the entitlement table that lets a plugin cost points.

/*
 * Following an author, as opposed to following one of their towns. A published
 * work is finished; a person keeps making things, which is the subscription
 * that actually brings someone back.
 */
CREATE TABLE IF NOT EXISTS user_follows (
  follower_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, followee_user_id),
  CONSTRAINT user_follows_no_self CHECK (follower_user_id <> followee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_followee
  ON user_follows (followee_user_id, created_at DESC);

/*
 * One like per person per comment. `game_comments.likes_count` stays as the
 * denormalized number the list reads, but the truth lives here — a counter
 * alone cannot answer "did I already like this?" or survive a double tap.
 */
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id UUID NOT NULL REFERENCES game_comments (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- Replies were writable but orphanable: a deleted parent left its thread
-- dangling. Adopt the existing column as a real self-reference.
DELETE FROM game_comments c
  WHERE c.parent_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM game_comments p WHERE p.id = c.parent_id);

DO $$
BEGIN
  ALTER TABLE game_comments
    ADD CONSTRAINT game_comments_parent_fk
    FOREIGN KEY (parent_id) REFERENCES game_comments (id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_comments_parent
  ON game_comments (parent_id, created_at);

/*
 * Reports. Hosting other people's work means being able to answer "this is
 * stolen" or "this should not be in front of children" with something better
 * than an email to the operator. One row per report, resolved by a curator.
 */
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What is being reported. Games are the common case; comments matter because
  -- an unmoderated thread poisons an otherwise fine work.
  target_kind TEXT NOT NULL,
  community_game_id UUID REFERENCES community_games (id) ON DELETE CASCADE,
  comment_id UUID REFERENCES game_comments (id) ON DELETE CASCADE,
  reporter_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_target_check CHECK (target_kind IN ('game', 'comment')),
  CONSTRAINT content_reports_reason_check
    CHECK (reason IN ('stolen', 'nsfw', 'illegal', 'broken', 'spam', 'other')),
  CONSTRAINT content_reports_status_check
    CHECK (status IN ('open', 'upheld', 'rejected')),
  -- A report must point at exactly the thing its kind claims.
  CONSTRAINT content_reports_target_present CHECK (
    (target_kind = 'game' AND community_game_id IS NOT NULL) OR
    (target_kind = 'comment' AND comment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_content_reports_open
  ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_game
  ON content_reports (community_game_id);

-- Same person reporting the same thing twice is one report, not two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_unique_game
  ON content_reports (community_game_id, reporter_user_id)
  WHERE community_game_id IS NOT NULL AND reporter_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_unique_comment
  ON content_reports (comment_id, reporter_user_id)
  WHERE comment_id IS NOT NULL AND reporter_user_id IS NOT NULL;

-- Why a curator hid something, kept next to the work itself so the play path
-- can refuse it without joining the report queue.
ALTER TABLE community_games ADD COLUMN IF NOT EXISTS takedown_reason TEXT;
ALTER TABLE community_games ADD COLUMN IF NOT EXISTS taken_down_at TIMESTAMPTZ;

/*
 * Paid plugins. Price is in generation points rather than money: the buyer
 * already holds points, the author already has a wallet, and settlement is one
 * ledger transfer instead of a second payment integration.
 */
ALTER TABLE plugin_packages
  ADD COLUMN IF NOT EXISTS price_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plugin_packages
  ADD COLUMN IF NOT EXISTS revenue_points INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE plugin_packages
    ADD CONSTRAINT plugin_packages_price_non_negative CHECK (price_points >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

/*
 * What an organisation has bought. Entitlements are per organisation, not per
 * user, so a studio pays once and everyone in it can use the plugin.
 */
CREATE TABLE IF NOT EXISTS plugin_entitlements (
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  plugin_id UUID NOT NULL REFERENCES plugin_packages (id) ON DELETE CASCADE,
  granted_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  points_paid INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_entitlements_plugin
  ON plugin_entitlements (plugin_id, created_at DESC);

-- Buying a plugin is a point movement like any other.
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_kind_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_kind_check
  CHECK (kind IN ('topup', 'grant', 'spend', 'refund', 'royalty', 'tip', 'purchase', 'sale', 'adjust'));

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS plugin_id UUID REFERENCES plugin_packages (id) ON DELETE SET NULL;
