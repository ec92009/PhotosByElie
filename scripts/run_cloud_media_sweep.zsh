#!/usr/bin/env zsh
set -euo pipefail

REPO_ROOT="${PBE_REPO_ROOT:-/Users/ecohen/Dev/photosByElie}"
LOCK_DIR="$REPO_ROOT/.review-logs/cloud-media-sweep.lock"
LOG_ROOT="$REPO_ROOT/.review-logs"
IMPORT_CACHE_ROOT="${PBE_IMPORT_CACHE_ROOT:-tmp/import-cache}"
PUSH=0
SKIP_PHASES=()

append_skip_phase() {
  local key="$1"
  [[ -z "$key" ]] && return
  local existing
  for existing in "${SKIP_PHASES[@]}"; do
    [[ "$existing" == "$key" ]] && return
  done
  SKIP_PHASES+=("$key")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=1
      shift
      ;;
    --skip-phase)
      shift
      [[ $# -gt 0 ]] && append_skip_phase "$1"
      shift || true
      ;;
    --skip-phase=*)
      append_skip_phase "${1#--skip-phase=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "${PBE_SWEEP_SKIP_PHASES:-}" ]]; then
  for key in ${(s:,:)PBE_SWEEP_SKIP_PHASES}; do
    append_skip_phase "${key//[[:space:]]/}"
  done
fi

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

phase() {
  echo "SWEEP_PHASE $1 $2"
}

done_phase() {
  echo "SWEEP_DONE $1"
}

skip_file() {
  echo "$LOCK_DIR/skip-phases"
}

write_initial_skips() {
  local file
  file="$(skip_file)"
  : > "$file"
  local key
  for key in "${SKIP_PHASES[@]}"; do
    print -r -- "$key" >> "$file"
  done
}

should_skip_phase() {
  local key="$1"
  local file
  file="$(skip_file)"
  [[ -f "$file" ]] || return 1
  grep -qx -- "$key" "$file"
}

begin_phase() {
  local key="$1"
  local label="$2"
  if should_skip_phase "$key"; then
    echo "SWEEP_SKIP $key $label"
    return 1
  fi
  phase "$key" "$label"
  return 0
}

echo "$$" > "$LOCK_DIR/pid"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$LOCK_DIR/started_at"
write_initial_skips

cd "$REPO_ROOT"
begin_phase prepare "Prepare workspace"
if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

git pull --ff-only origin main
if [[ ! -d node_modules ]]; then
  npm install
fi
done_phase prepare

if begin_phase discard-start "Delete R2 objects for banned photos"; then
  node scripts/delete_discarded_r2_media.mjs --delete --discarded-tombstone assets/discarded/discarded-photo-ids.json --request-timeout-ms 180000 --retries 4
  done_phase discard-start
fi

phase import-cache "Prepare import cache"
rm -rf "$IMPORT_CACHE_ROOT"
mkdir -p "$IMPORT_CACHE_ROOT"
done_phase import-cache

if begin_phase camera "Import Camera sources"; then
  python3 scripts/build_lightroom_thumbnails.py \
    --source-root /Volumes/Saturn/Pictures/LR/Camera \
    --output-root "$IMPORT_CACHE_ROOT" \
    --r2-upload both \
    --r2-private-renders \
    --hidden-blacklist assets/hidden/hidden-blacklist.json \
    --discarded-tombstone assets/discarded/discarded-photo-ids.json
  done_phase camera
fi

APPLE_PHOTO_ALBUMS_ROOT="/Volumes/Saturn/Pictures/LR/Apple Photo Albums"
if [[ -d "$APPLE_PHOTO_ALBUMS_ROOT" ]]; then
  if begin_phase apple-photo-albums "Import Apple Photos album sources"; then
    python3 scripts/build_lightroom_thumbnails.py \
      --source-root "$APPLE_PHOTO_ALBUMS_ROOT" \
      --output-root "$IMPORT_CACHE_ROOT" \
      --select all \
      --r2-upload both \
      --r2-private-renders \
      --hidden-blacklist assets/hidden/hidden-blacklist.json \
      --discarded-tombstone assets/discarded/discarded-photo-ids.json
    done_phase apple-photo-albums
  fi
fi

if begin_phase leonardo "Import Leonardo sources"; then
  python3 scripts/build_lightroom_thumbnails.py \
    --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
    --output-root "$IMPORT_CACHE_ROOT" \
    --select all \
    --force-country ai \
    --r2-upload both \
    --r2-private-renders \
    --hidden-blacklist assets/hidden/hidden-blacklist.json \
    --discarded-tombstone assets/discarded/discarded-photo-ids.json
  done_phase leonardo
fi

if begin_phase real-estate "Import Real Estate sources"; then
  python3 scripts/sync_real_estate_clients.py --publish --upload --scope both
  done_phase real-estate
fi

phase catalog "Export catalog"
python3 scripts/export_photos_data.py \
  --selection newest \
  --external-media \
  --review-snapshot assets/hidden/hidden-blacklist.json
done_phase catalog

phase worker "Write worker catalog"
node scripts/write_worker_catalog.mjs
done_phase worker
phase sidecar "Write media sidecar"
node scripts/write_media_sidecar.mjs
done_phase sidecar

if begin_phase private "Backfill private JPGs"; then
  SYNC_ARGS=(--commit-every 100 --request-timeout-ms 45000 --retries 1)
  if [[ "$PUSH" == "1" ]]; then
    SYNC_ARGS+=(--push)
  fi
  node scripts/sync_private_deliverables.mjs "${SYNC_ARGS[@]}"
  done_phase private
fi

if begin_phase discard-final "Final banned R2 cleanup"; then
  node scripts/delete_discarded_r2_media.mjs --delete --discarded-tombstone assets/discarded/discarded-photo-ids.json --request-timeout-ms 180000 --retries 4
  done_phase discard-final
fi
phase storage "Refresh storage estimate"
node scripts/write_storage_estimate.mjs
done_phase storage
if begin_phase test "Run tests"; then
  npm test
  done_phase test
fi
if begin_phase validate "Validate publish"; then
  npm run validate
  done_phase validate
fi

phase commit "Commit and push"
git add \
  assets/catalog \
  assets/discarded-media-manifest.json \
  assets/expo-manifest.json \
  assets/media-sidecar.json \
  assets/private-delivery-manifest.json \
  assets/storage-estimate.json \
  home-data.js \
  photos-data.js \
  worker/photos-catalog.generated.mjs \
  scripts/export_photos_data.py \
  scripts/build_lightroom_thumbnails.py \
  scripts/delete_discarded_r2_media.mjs \
  scripts/run_cloud_media_sweep.zsh \
  scripts/sync_real_estate_clients.py \
  scripts/sync_private_deliverables.mjs \
  scripts/write_storage_estimate.mjs \
  scripts/write_worker_catalog.mjs

if ! git diff --cached --quiet; then
  git commit -m "photosbyelie: checkpoint cloud media sweep"
  if [[ "$PUSH" == "1" ]]; then
    git push origin main
  fi
fi
done_phase commit

phase cleanup-cache "Clean import cache"
rm -rf "$IMPORT_CACHE_ROOT"
done_phase cleanup-cache
