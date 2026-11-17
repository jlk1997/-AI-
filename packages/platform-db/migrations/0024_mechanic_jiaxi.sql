-- Snapshot MechanicSpec on publish so 加戏 cards follow this work's loops.
-- Does not change 巷议 rails.

ALTER TABLE community_games
  ADD COLUMN IF NOT EXISTS mechanic_json JSONB;
