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
