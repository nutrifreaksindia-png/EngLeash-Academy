#!/usr/bin/env bash
# Copy local SQLite (users, courses, etc.) to the production server Docker volume.
# Usage from repo root:
#   ./deploy/sync-sqlite-to-server.sh root@YOUR_SERVER
#
# Requires: ssh + scp access. Stops the API briefly so the DB file is not locked.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_LOCAL="$ROOT/backend/data/academy.db"
REMOTE="${1:?Usage: $0 user@host [remote_project_dir]}"
REMOTE_DIR="${2:-$HOME/workspace/EngLeash-Academy}"

if [[ ! -f "$DB_LOCAL" ]]; then
  echo "Missing local database: $DB_LOCAL" >&2
  exit 1
fi

echo "Uploading $(wc -c < "$DB_LOCAL") bytes to ${REMOTE}:/tmp/academy.db.upload ..."
scp "$DB_LOCAL" "${REMOTE}:/tmp/academy.db.upload"

ssh "$REMOTE" bash <<SSH
set -euo pipefail
cd $(printf '%q' "$REMOTE_DIR")

docker compose stop api

VOL="\$(docker volume ls -q | grep -E '_academy-db\$' | head -1)"
if [[ -z "\$VOL" ]]; then
  echo "Could not find Docker volume matching *_academy-db. docker volume ls:" >&2
  docker volume ls >&2
  exit 1
fi

docker run --rm \\
  -v "\$VOL:/data" \\
  -v /tmp/academy.db.upload:/incoming/academy.db:ro \\
  alpine sh -c 'cp /incoming/academy.db /data/academy.db && chmod 644 /data/academy.db && ls -la /data/academy.db'

docker compose start api
docker compose ps api
echo "Done. Optional check: curl -sS http://127.0.0.1/api/health/details -H \"Host: api.engleashacademy.com\""
SSH

echo "Local sync script finished."
