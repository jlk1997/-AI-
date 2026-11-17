-- Operator audit trail + poison-job dead letters.
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, created_at DESC);

CREATE TABLE IF NOT EXISTS job_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID,
  project_id UUID,
  job_type TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_dead_letters_job ON job_dead_letters (job_id);
CREATE INDEX IF NOT EXISTS idx_job_dead_letters_created ON job_dead_letters (created_at DESC);

INSERT INTO schema_migrations (id)
VALUES ('0026_audit_and_dead_letters')
ON CONFLICT (id) DO NOTHING;
