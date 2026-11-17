-- 点亮世界: extra hourly MiniMax talks for this town, not other towns' floor.
ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS light_until timestamptz,
  ADD COLUMN IF NOT EXISTS light_bonus_per_hour integer NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (id)
VALUES ('0033_world_light')
ON CONFLICT (id) DO NOTHING;
