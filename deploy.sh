#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and set JWT_SECRET (and other vars)." >&2
  exit 1
fi

docker compose build
docker compose up -d --remove-orphans
docker compose ps
echo "If this server runs other sites on port 80: use host nginx + deploy/nginx-host-engleash.conf (API→127.0.0.1:3001, app→127.0.0.1:8080)."
