#!/usr/bin/env bash
# Install self-hosted LiveKit stack on the EngLeash VPS.
# Run as root on 72.61.224.223 after DNS for livekit.engleashacademy.com points here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="/opt/livekit"

echo "==> Generating LiveKit API keys"
read -r API_KEY API_SECRET <<< "$(docker run --rm livekit/livekit-server:latest generate-keys | awk '/API Key:/{k=$3} /API Secret:/{s=$3} END{print k, s}')"

if [[ -z "${API_KEY:-}" || -z "${API_SECRET:-}" ]]; then
  echo "Failed to generate keys" >&2
  exit 1
fi

echo "==> Installing stack to ${TARGET}"
mkdir -p "${TARGET}"
cp "${REPO_ROOT}/deploy/livekit/docker-compose.yml" "${TARGET}/"
sed -e "s/API_KEY_PLACEHOLDER/${API_KEY}/g" -e "s/API_SECRET_PLACEHOLDER/${API_SECRET}/g" \
  "${REPO_ROOT}/deploy/livekit/livekit.yaml" > "${TARGET}/livekit.yaml"
sed -e "s/API_KEY_PLACEHOLDER/${API_KEY}/g" -e "s/API_SECRET_PLACEHOLDER/${API_SECRET}/g" \
  "${REPO_ROOT}/deploy/livekit/egress.yaml" > "${TARGET}/egress.yaml"

echo "==> Starting LiveKit + Redis + Egress"
cd "${TARGET}"
docker compose pull
docker compose up -d

echo "==> Nginx (if not already enabled)"
if [[ ! -f /etc/nginx/sites-enabled/livekit.conf ]]; then
  cp "${REPO_ROOT}/deploy/nginx-host-livekit.conf" /etc/nginx/sites-available/livekit.conf
  ln -sf /etc/nginx/sites-available/livekit.conf /etc/nginx/sites-enabled/livekit.conf
  nginx -t
  systemctl reload nginx
fi

echo "==> Firewall (ufw)"
ufw allow 7881/tcp || true
ufw allow 50000:60000/udp || true

echo ""
echo "Add to /root/workspace/EngLeash-Academy/.env :"
echo "LIVE_RTC_PROVIDER=livekit"
echo "LIVEKIT_URL=wss://livekit.engleashacademy.com"
echo "LIVEKIT_API_KEY=${API_KEY}"
echo "LIVEKIT_API_SECRET=${API_SECRET}"
echo ""
echo "Then rebuild API: cd /root/workspace/EngLeash-Academy && docker compose up -d --build api"
echo ""
echo "Verify keys in livekit.yaml (must NOT show API_KEY_PLACEHOLDER):"
grep -A1 '^keys:' "${TARGET}/livekit.yaml"
