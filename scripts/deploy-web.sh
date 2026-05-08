#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "==> Building main web gateway"
npm run build

echo "==> Refreshing stable fallback backup"
node dist/bin/pibo.js gateway backup update

echo "Deploy complete."
echo "Gateway was not restarted."
echo "To activate this deployment, run:"
echo
echo "  pibo gateway web restart"
echo
echo "For a first-time gateway start, run:"
echo
echo "  pibo gateway web start"
echo
echo "The CLI will block the restart if active agent work is running."
