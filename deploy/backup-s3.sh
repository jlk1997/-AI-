#!/usr/bin/env bash
# Copy the preview bucket to a second prefix / bucket for the monthly drill.
# Usage: ./deploy/backup-s3.sh s3://source-bucket s3://dest-bucket/gebi-daily/
set -euo pipefail
src="${1:-}"
dest="${2:-}"
if [[ -z "${src}" || -z "${dest}" ]]; then
  echo "Usage: $0 s3://source-bucket s3://dest-bucket/prefix/" >&2
  exit 1
fi
aws s3 sync "${src}" "${dest}" --only-show-errors
echo "synced ${src} -> ${dest}"
