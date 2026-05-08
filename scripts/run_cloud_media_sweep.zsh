#!/usr/bin/env zsh
set -euo pipefail

REPO_ROOT="${PBE_REPO_ROOT:-/Users/ecohen/Dev/photosByElie}"
LOCK_DIR="$REPO_ROOT/.review-logs/cloud-media-sweep.lock"
LOG_ROOT="$REPO_ROOT/.review-logs"
PUSH=0

for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
  esac
done

mkdir -p "$LOG_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -f "$LOCK_DIR/pid" ]] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    echo "Cloud media sweep already running with pid $(cat "$LOCK_DIR/pid")."
    exit 0
  fi
  echo "Removing stale cloud media sweep lock."
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi

cleanup() {
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

echo "$$" > "$LOCK_DIR/pid"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$LOCK_DIR/started_at"

cd "$REPO_ROOT"
if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

git pull --ff-only origin main
if [[ ! -d node_modules ]]; then
  npm install
fi

node scripts/delete_discarded_r2_media.mjs --delete --request-timeout-ms 180000 --retries 4

python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn/Pictures/LR/Camera \
  --output-root assets/reserve \
  --r2-upload both \
  --r2-private-renders \
  --hidden-blacklist assets/hidden/hidden-blacklist.json

python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn/Pictures/LR/_All Leonardo \
  --output-root assets/reserve \
  --select all \
  --force-country ai \
  --r2-upload both \
  --r2-private-renders \
  --hidden-blacklist assets/hidden/hidden-blacklist.json

python3 scripts/export_photos_data.py \
  --selection newest \
  --external-media \
  --review-snapshot assets/hidden/hidden-blacklist.json

node scripts/write_worker_catalog.mjs
node scripts/write_media_sidecar.mjs

SYNC_ARGS=(--commit-every 100 --request-timeout-ms 180000 --retries 4)
if [[ "$PUSH" == "1" ]]; then
  SYNC_ARGS+=(--push)
fi
node scripts/sync_private_deliverables.mjs "${SYNC_ARGS[@]}"

node scripts/delete_discarded_r2_media.mjs --delete --request-timeout-ms 180000 --retries 4
npm test
npm run validate

git add \
  assets/discarded-media-manifest.json \
  assets/expo-manifest.json \
  assets/media-sidecar.json \
  assets/private-delivery-manifest.json \
  photos-data.js \
  worker/photos-catalog.generated.mjs \
  scripts/build_lightroom_thumbnails.py \
  scripts/delete_discarded_r2_media.mjs \
  scripts/run_cloud_media_sweep.zsh \
  scripts/sync_private_deliverables.mjs \
  scripts/write_worker_catalog.mjs

if ! git diff --cached --quiet; then
  git commit -m "photosbyelie: checkpoint cloud media sweep"
  if [[ "$PUSH" == "1" ]]; then
    git push origin main
  fi
fi
