-- Agent intelligence layer: Brief, Memory, Session summary, RAG, feedback.

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE TABLE IF NOT EXISTS project_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  brief_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_briefs_project_version_uq
  ON project_briefs (project_id, version);
CREATE INDEX IF NOT EXISTS idx_project_briefs_project ON project_briefs (project_id);

CREATE TABLE IF NOT EXISTS project_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'project',
  fact TEXT NOT NULL,
  source_job_id UUID REFERENCES jobs (id) ON DELETE SET NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_memories_project ON project_memories (project_id);

CREATE TABLE IF NOT EXISTS context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  layer TEXT NOT NULL,
  content_json JSONB,
  char_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_job ON context_snapshots (job_id);

CREATE TABLE IF NOT EXISTS organization_preferences (
  organization_id UUID PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  preferences_json JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection TEXT NOT NULL,
  source_path TEXT NOT NULL,
  archetype TEXT,
  title TEXT,
  content TEXT NOT NULL,
  embedding JSONB,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_collection_path_uq
  ON rag_document_chunks (collection, source_path);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_archetype ON rag_document_chunks (archetype);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_collection ON rag_document_chunks (collection);

CREATE TABLE IF NOT EXISTS job_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  rating INT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_feedback_project ON job_feedback (project_id);
