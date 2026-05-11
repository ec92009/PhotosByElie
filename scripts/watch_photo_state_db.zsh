#!/usr/bin/env zsh
set -euo pipefail

REPO_ROOT="${PBE_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
INTERVAL="${PBE_PHOTO_STATE_DB_INTERVAL:-120}"
OUTPUT="${PBE_PHOTO_STATE_DB:-tmp/photo-state.sqlite}"

cd "$REPO_ROOT"
echo "Refreshing ${OUTPUT} every ${INTERVAL}s. Press Ctrl-C to stop."

while true; do
  python3 scripts/build_photo_state_db.py --output "$OUTPUT" --quiet
  sleep "$INTERVAL"
done
