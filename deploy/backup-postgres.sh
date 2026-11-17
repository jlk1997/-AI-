#!/usr/bin/env bash
# Daily logical backup for the dual-launch checklist.
# Usage: PLATFORM_DATABASE_URL=... ./deploy/backup-postgres.sh [outdir]
set -euo pipefail
out_dir="${1:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${out_dir}"
dest="${out_dir}/opengame-platform-${stamp}.sql.gz"
if [[ -z "${PLATFORM_DATABASE_URL:-}" ]]; then
  echo "PLATFORM_DATABASE_URL is required" >&2
  exit 1
fi
pg_dump --no-owner --no-privileges "${PLATFORM_DATABASE_URL}" | gzip > "${dest}"
echo "${dest}"
