-- Drives (hunger/energy/social/curiosity) must survive the live tick's
-- hydrate-from-DB cycle, otherwise they reset every 2.5s and never cross the
-- threshold that interrupts a resident's schedule.
ALTER TABLE world_agents
  ADD COLUMN IF NOT EXISTS needs_json jsonb NOT NULL DEFAULT '{}'::jsonb;
