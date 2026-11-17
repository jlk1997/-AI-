-- Server-side continuous simulation.
--
-- Until now a world only advanced while a browser tab was POSTing ticks, so the
-- town froze the moment nobody was looking and every reopened tab resumed from a
-- stale simTime. These columns let the worker decide, on its own, which worlds to
-- keep advancing:
--   heartbeat_enabled — persistent opt-in; the world lives whether or not anyone watches
--   heartbeat_until   — self-expiring lease refreshed by viewers, so casually
--                       opened worlds keep breathing for a while and then stop
--   last_heartbeat_at — observability / stall detection
ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS heartbeat_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS heartbeat_until timestamptz;
ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- The heartbeat scan runs every few seconds; it must never table-scan `worlds`.
CREATE INDEX IF NOT EXISTS worlds_heartbeat_idx
  ON worlds (heartbeat_enabled, heartbeat_until);
