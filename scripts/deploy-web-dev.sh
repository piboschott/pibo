#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_PUBLIC_URL="${PIBO_DEV_PUBLIC_URL:-https://dev.pibo.neuralnexus.me/apps/chat}"

cd "$ROOT_DIR"

echo "==> Building dev web gateway"
npm run build

echo "==> Verifying dev public web app without restarting"
if curl -fsS "$DEV_PUBLIC_URL" >/tmp/pibo-web-dev-app.html; then
	echo "Existing dev public web app reachable at $DEV_PUBLIC_URL"
else
	echo "Existing dev public web app is not reachable yet at $DEV_PUBLIC_URL"
fi

echo "Dev deploy complete."
echo "Dev gateway was not restarted."
echo "To activate this dev deployment, run:"
echo
echo "  pibo gateway dev restart"
echo
echo "For a first-time dev gateway start, run:"
echo
echo "  pibo gateway dev start"
