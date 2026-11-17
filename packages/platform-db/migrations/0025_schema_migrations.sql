-- Record applied migration ids going forward. Older files stay idempotent
-- and are still executed in lexical order; this table is an audit log, not
-- a skip list (so existing self-host installs keep working).
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (id)
VALUES ('0025_schema_migrations')
ON CONFLICT (id) DO NOTHING;
