-- Preserve Generative Agents memory ids across persist (reflection evidence tree).
ALTER TABLE agent_memories
  ADD COLUMN IF NOT EXISTS memory_key text;

UPDATE agent_memories
SET memory_key = id::text
WHERE memory_key IS NULL;

ALTER TABLE agent_memories
  ALTER COLUMN memory_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_memories_world_key_uq
  ON agent_memories (world_id, memory_key);
