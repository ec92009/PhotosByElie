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

current_phase_file() {
  echo "$LOCK_DIR/current-phase"
}

current_child_file() {
  echo "$LOCK_DIR/current-child-pid"
}

terminate_phase_pid() {
  local pid="$1"
  [[ -z "$pid" ]] && return
  local child
  local children
  children=("${(@f)$(pgrep -P "$pid" 2>/dev/null || true)}")
  for child in "${children[@]}"; do
    [[ -n "$child" ]] && terminate_phase_pid "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ -f "$(current_child_file)" ]]; then
    terminate_phase_pid "$(cat "$(current_child_file)" 2>/dev/null || true)"
  fi
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

clear_current_phase() {
  rm -f "$(current_phase_file)" "$(current_child_file)"
}

run_skippable_phase() {
  local key="$1"
  shift
  local label="$1"
  shift
  if ! begin_phase "$key" "$label"; then
    return 0
  fi
  print -r -- "$key" > "$(current_phase_file)"
  "$@" &
  local child_pid=$!
  print -r -- "$child_pid" > "$(current_child_file)"
  local child_status=0
  local skipped=0
  while kill -0 "$child_pid" 2>/dev/null; do
    if should_skip_phase "$key"; then
      echo "SWEEP_SKIP_REQUESTED $key $label"
      terminate_phase_pid "$child_pid"
      skipped=1
      break
    fi
    sleep 1
  done
  set +e
  wait "$child_pid"
  child_status=$?
  set -e
  if [[ "$skipped" == "0" && "$child_status" != "0" ]] && should_skip_phase "$key"; then
    skipped=1
  fi
  clear_current_phase
  if [[ "$skipped" == "1" ]]; then
    echo "SWEEP_SKIP $key $label"
    return 0
  fi
  if [[ "$child_status" != "0" ]]; then
    return "$child_status"
  fi
  done_phase "$key"
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

run_skippable_phase discard-start "Double-check banned R2 cleanup" \
  node scripts/delete_discarded_r2_media.mjs --delete --discarded-tombstone assets/discarded/discarded-photo-ids.json --request-timeout-ms 180000 --retries 4

phase import-cache "Prepare import cache"
mkdir -p "$IMPORT_CACHE_ROOT"
done_phase import-cache

run_skippable_phase camera "Import Camera sources" \
  python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn/Pictures/LR/Camera \
  --output-root "$IMPORT_CACHE_ROOT" \
  --r2-upload both \
  --r2-private-renders \
  --hidden-blacklist assets/hidden/hidden-blacklist.json \
  --discarded-tombstone assets/discarded/discarded-photo-ids.json

APPLE_PHOTO_ALBUMS_ROOT="/Volumes/Saturn/Pictures/LR/Apple Photo Albums"
if [[ -d "$APPLE_PHOTO_ALBUMS_ROOT" ]]; then
  run_skippable_phase apple-photo-albums "Import Apple Photos album sources" \
    python3 scripts/build_lightroom_thumbnails.py \
    --source-root "$APPLE_PHOTO_ALBUMS_ROOT" \
    --output-root "$IMPORT_CACHE_ROOT" \
    --select all \
    --r2-upload both \
    --r2-private-renders \
    --hidden-blacklist assets/hidden/hidden-blacklist.json \
    --discarded-tombstone assets/discarded/discarded-photo-ids.json
fi

run_skippable_phase leonardo "Import Leonardo sources" \
  python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
  --output-root "$IMPORT_CACHE_ROOT" \
  --select all \
  --force-country ai \
  --r2-upload both \
  --r2-private-renders \
  --hidden-blacklist assets/hidden/hidden-blacklist.json \
  --discarded-tombstone assets/discarded/discarded-photo-ids.json

run_skippable_phase real-estate "Import Real Estate sources" \
  python3 scripts/sync_real_estate_clients.py --publish --upload --scope both

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

SYNC_ARGS=(--commit-every 100 --request-timeout-ms 45000 --retries 1)
if [[ "$PUSH" == "1" ]]; then
  SYNC_ARGS+=(--push)
fi
run_skippable_phase private "Backfill private JPGs" \
  node scripts/sync_private_deliverables.mjs "${SYNC_ARGS[@]}"

run_skippable_phase discard-final "Final banned R2 cleanup double-check" \
  node scripts/delete_discarded_r2_media.mjs --delete --discarded-tombstone assets/discarded/discarded-photo-ids.json --request-timeout-ms 180000 --retries 4
phase storage "Refresh storage estimate"
node scripts/write_storage_estimate.mjs
done_phase storage
run_skippable_phase test "Run tests" npm test
run_skippable_phase validate "Validate publish" npm run validate

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

phase cleanup-cache "Keep import cache"
mkdir -p "$IMPORT_CACHE_ROOT"
done_phase cleanup-cache
