-- Next-generate rescaffold: replace local source from the pinned template.
-- Preview / production deployments stay on S3.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS rescaffold_requested_at TIMESTAMPTZ;

INSERT INTO schema_migrations (id)
VALUES ('0028_rescaffold_requested')
ON CONFLICT (id) DO NOTHING;
