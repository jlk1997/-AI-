-- One poison job, one dead-letter row. Requeue claims that row once.
DELETE FROM job_dead_letters
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at ASC, id ASC) AS rn
    FROM job_dead_letters
    WHERE job_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS job_dead_letters_job_uidx
  ON job_dead_letters (job_id)
  WHERE job_id IS NOT NULL;

INSERT INTO schema_migrations (id)
VALUES ('0030_dead_letter_job_unique')
ON CONFLICT (id) DO NOTHING;
