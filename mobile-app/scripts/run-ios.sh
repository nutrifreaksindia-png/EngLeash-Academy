#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pod >/dev/null 2>&1; then
  echo "CocoaPods not found. Installing with Homebrew..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "Install Homebrew from https://brew.sh then run: brew install cocoapods"
    exit 1
  fi
  brew install cocoapods
fi

echo "Installing iOS pods..."
(cd ios && pod install)

echo "Building iOS app (Metro should be running: npm run start:dev-client)..."
exec npx expo run:ios --port 8081 "$@"
