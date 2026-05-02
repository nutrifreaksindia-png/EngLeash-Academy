#!/usr/bin/env bash
# Copy local SQLite (users, courses, etc.) to the production server Docker volume.
# Usage from repo root:
#   ./deploy/sync-sqlite-to-server.sh root@YOUR_SERVER
#   ./deploy/sync-sqlite-to-server.sh root@YOUR_SERVER /root/workspace/EngLeash-Academy
#
# Default remote project dir is \$HOME/workspace/EngLeash-Academy on the *server* (not your Mac).
# Requires: ssh + scp access. Stops the API briefly so the DB file is not locked.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_LOCAL="$ROOT/backend/data/academy.db"
REMOTE="${1:?Usage: $0 user@host [remote_project_dir]}"

if [[ ! -f "$DB_LOCAL" ]]; then
  echo "Missing local database: $DB_LOCAL" >&2
  exit 1
fi

echo "Uploading $(wc -c < "$DB_LOCAL") bytes to ${REMOTE}:/tmp/academy.db.upload ..."
scp "$DB_LOCAL" "${REMOTE}:/tmp/academy.db.upload"

# Pass optional remote path as $1 to remote bash so $HOME is the server's home, not the Mac's.
ssh "$REMOTE" bash -s -- "${2:-}" <<'SSH'
set -euo pipefail
if [[ -n "${1:-}" ]]; then
  cd "$1"
else
  cd "$HOME/workspace/EngLeash-Academy"
fi

docker compose stop api

VOL="$(docker volume ls -q | grep -E '_academy-db$' | head -1)"
if [[ -z "$VOL" ]]; then
  echo "Could not find Docker volume matching *_academy-db. docker volume ls:" >&2
  docker volume ls >&2
  exit 1
fi

docker run --rm \
  -v "$VOL:/data" \
  -v /tmp/academy.db.upload:/incoming/academy.db:ro \
  alpine sh -c 'cp /incoming/academy.db /data/academy.db && chmod 644 /data/academy.db && ls -la /data/academy.db'

docker compose start api
docker compose ps api
echo "Done. Optional check: curl -sS http://127.0.0.1/api/health/details -H \"Host: api.engleashacademy.com\""
SSH

echo "Local sync script finished."
