-- OpenGame hosted platform — initial schema (idempotent)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  archetype TEXT NOT NULL DEFAULT 'platformer',
  template_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions (id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB,
  result JSONB,
  log_key TEXT,
  trace_id TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  build_cache_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  storage_prefix TEXT NOT NULL,
  manifest JSONB,
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts (id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'preview',
  preview_url TEXT,
  production_url TEXT,
  custom_domain TEXT,
  custom_domain_verified BOOLEAN NOT NULL DEFAULT false,
  acme_challenge_name TEXT,
  acme_challenge_value TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  modality TEXT NOT NULL,
  units NUMERIC NOT NULL DEFAULT 1,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS template_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  manifest JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE TABLE IF NOT EXISTS bench_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  scores JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs (project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_usage_org_created ON usage_events (organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id);
