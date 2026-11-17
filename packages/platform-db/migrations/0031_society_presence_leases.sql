-- Split presence (heartbeat_until) from paid 镇时 and author watch.
ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS town_time_until timestamptz,
  ADD COLUMN IF NOT EXISTS author_watch_until timestamptz,
  ADD COLUMN IF NOT EXISTS clock_paused boolean NOT NULL DEFAULT false;

-- Old 镇时 wrote a long heartbeat_until. Move leftover long leases onto the permit
-- so an empty page cannot keep MiniMax talking overnight.
UPDATE worlds
SET
  town_time_until = heartbeat_until,
  heartbeat_until = NULL
WHERE heartbeat_until IS NOT NULL
  AND heartbeat_until > now() + interval '3 hours';

INSERT INTO schema_migrations (id)
VALUES ('0031_society_presence_leases')
ON CONFLICT (id) DO NOTHING;
