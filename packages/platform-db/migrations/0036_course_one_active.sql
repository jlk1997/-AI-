-- One living town, one open/closed 走向盘. Empty newer dupes go void first.
UPDATE world_course_nodes AS n
SET status = 'void',
    void_reason = 'duplicate',
    settled_at = now()
WHERE n.status IN ('open', 'closed')
  AND n.id NOT IN (
    SELECT kept.id
    FROM (
      SELECT DISTINCT ON (world_id) id
      FROM world_course_nodes
      WHERE status IN ('open', 'closed')
      ORDER BY world_id, created_at ASC, id ASC
    ) kept
  )
  AND NOT EXISTS (
    SELECT 1 FROM world_course_stakes s WHERE s.node_id = n.id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM world_course_nodes
    WHERE status IN ('open', 'closed')
    GROUP BY world_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS world_course_nodes_world_active_uq
      ON world_course_nodes (world_id)
      WHERE status IN ('open', 'closed');
  END IF;
END $$;

INSERT INTO schema_migrations (id)
VALUES ('0036_course_one_active')
ON CONFLICT (id) DO NOTHING;
