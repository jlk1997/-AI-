#!/usr/bin/env bash
# Monthly restore drill: empty target DB, apply a gzip dump, then open one work.
# Usage: PLATFORM_DATABASE_URL=... ./deploy/restore-postgres.sh backups/file.sql.gz
set -euo pipefail
dump="${1:-}"
if [[ -z "${PLATFORM_DATABASE_URL:-}" || -z "${dump}" ]]; then
  echo "Usage: PLATFORM_DATABASE_URL=... $0 <dump.sql.gz>" >&2
  exit 1
fi
if [[ ! -f "${dump}" ]]; then
  echo "dump not found: ${dump}" >&2
  exit 1
fi
gunzip -c "${dump}" | psql "${PLATFORM_DATABASE_URL}"
echo "restore finished — open one community work and hit /readyz"
