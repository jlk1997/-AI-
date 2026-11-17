-- 0004_p5_ecosystem.sql
-- Adds public-bench fields + plugin marketplace tables.
-- All additions are nullable / default false so existing rows continue
-- to behave as before.

ALTER TABLE bench_runs
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_label text;

CREATE INDEX IF NOT EXISTS bench_runs_is_public_idx
  ON bench_runs (is_public, created_at DESC)
  WHERE is_public;

CREATE TABLE IF NOT EXISTS plugin_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latest_version text,
  tags jsonb,
  is_public boolean NOT NULL DEFAULT true,
  install_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plugin_packages_slug_uq
  ON plugin_packages (slug);

CREATE TABLE IF NOT EXISTS plugin_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id uuid NOT NULL REFERENCES plugin_packages(id) ON DELETE CASCADE,
  version text NOT NULL,
  storage_key text NOT NULL,
  manifest jsonb,
  sha256 text NOT NULL,
  runtime_peer_range text,
  published_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plugin_versions_plugin_version_uq
  ON plugin_versions (plugin_id, version);
