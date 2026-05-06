#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HEALTH_URL="${PIBO_DEV_HEALTH_URL:-http://127.0.0.1:4808/health}"
DEV_PUBLIC_URL="${PIBO_DEV_PUBLIC_URL:-https://dev.pibo.neuralnexus.me/apps/chat}"

cd "$ROOT_DIR"

echo "==> Building dev web gateway"
npm run build

echo "==> Restarting dev web gateway"
systemctl restart pibo-web-dev

echo "==> Waiting for dev gateway health"
rm -f /tmp/pibo-web-dev-health.json /tmp/pibo-web-dev-app.html
for _ in $(seq 1 30); do
	if curl -fsS "$DEV_HEALTH_URL" >/tmp/pibo-web-dev-health.json; then
		break
	fi
	sleep 1
done

if [[ ! -s /tmp/pibo-web-dev-health.json ]]; then
	echo "Dev gateway did not become healthy at $DEV_HEALTH_URL"
	exit 1
fi

echo "==> Verifying dev public web app (if DNS/TLS is ready)"
if curl -fsS "$DEV_PUBLIC_URL" >/tmp/pibo-web-dev-app.html; then
	echo "Dev public web app reachable at $DEV_PUBLIC_URL"
else
	echo "Dev public web app is not reachable yet at $DEV_PUBLIC_URL"
	echo "This is expected until DNS, TLS, and Google OAuth redirect are configured."
fi

cat /tmp/pibo-web-dev-health.json
echo
echo "Dev deploy complete"
