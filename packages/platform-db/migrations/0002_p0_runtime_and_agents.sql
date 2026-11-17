-- OpenGame P0: runtime-first scaffolding, agent orchestration, assets, saves,
-- achievements, runtime versions, project remixes (additive only).

-- --- projects: pin runtime version, record parent for fork lineage ---
ALTER TABLE projects ADD COLUMN IF NOT EXISTS runtime_version TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_project_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_parent_project_id_fkey'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_parent_project_id_fkey
      FOREIGN KEY (parent_project_id) REFERENCES projects (id) ON DELETE SET NULL;
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects (parent_project_id);

-- --- chat_sessions: fork lineage ---
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS parent_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_parent_id_fkey'
  ) THEN
    ALTER TABLE chat_sessions
      ADD CONSTRAINT chat_sessions_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES chat_sessions (id) ON DELETE SET NULL;
  END IF;
END$$;

-- --- deployments: CDN URL ---
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cdn_url TEXT;

-- --- agent_events: Plan/Code/Asset/Build/QA/Fix structured stream ---
CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions (id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  phase TEXT NOT NULL,
  tool TEXT,
  seq INT NOT NULL DEFAULT 0,
  summary TEXT,
  details JSONB,
  elapsed_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_events_job_seq_uq
  ON agent_events (job_id, role, seq, phase);
CREATE INDEX IF NOT EXISTS idx_agent_events_job ON agent_events (job_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_project ON agent_events (project_id);

-- --- assets: multi-modal generation outputs ---
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  modality TEXT NOT NULL,
  prompt TEXT,
  storage_key TEXT NOT NULL,
  thumbnail_key TEXT,
  mime_type TEXT,
  size_bytes INT,
  external_id TEXT,
  license_tag TEXT,
  cost_units NUMERIC,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets (project_id);
CREATE INDEX IF NOT EXISTS idx_assets_modality ON assets (project_id, modality);

-- --- player_saves: cloud sync for SaveStore ---
CREATE TABLE IF NOT EXISTS player_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS player_saves_deployment_user_slot_uq
  ON player_saves (deployment_id, user_id, slot);

-- --- achievements: cross-game player progression ---
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  deployment_id UUID REFERENCES deployments (id) ON DELETE SET NULL,
  achievement_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  progress INT NOT NULL DEFAULT 1,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS achievements_user_deployment_key_uq
  ON achievements (user_id, deployment_id, achievement_key);

-- --- runtime_versions: registry for @opengame/runtime ---
CREATE TABLE IF NOT EXISTS runtime_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'latest',
  package_spec TEXT NOT NULL,
  manifest JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- project_remixes: lineage records distinct from projects.parent_project_id ---
CREATE TABLE IF NOT EXISTS project_remixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source_deployment_id UUID REFERENCES deployments (id) ON DELETE SET NULL,
  forked_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_remixes_child ON project_remixes (child_project_id);
CREATE INDEX IF NOT EXISTS idx_project_remixes_parent ON project_remixes (parent_project_id);
