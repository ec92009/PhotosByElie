#!/usr/bin/env zsh
set -euo pipefail

for tool_dir in /opt/homebrew/bin /usr/local/bin /opt/homebrew/sbin /usr/local/sbin; do
  [[ -d "$tool_dir" ]] && PATH="$tool_dir:$PATH"
done
export PATH

REPO_ROOT="${PBE_REPO_ROOT:-/Users/ecohen/Dev/PhotosByElie}"
LOCK_DIR="$REPO_ROOT/.review-logs/cloud-media-sweep.lock"
LOG_ROOT="$REPO_ROOT/.review-logs"
IMPORT_CACHE_ROOT="${PBE_IMPORT_CACHE_ROOT:-tmp/import-cache}"
PYTHON_BIN="${PBE_SWEEP_PYTHON:-/usr/bin/python3}"
PYTHON_ARCH="${PBE_SWEEP_ARCH:-}"
PUSH=0
SKIP_PHASES=()
SKIPPED_PHASES=()
SELECTED_IMPORT_SOURCE_ROOT=""
SELECTED_IMPORT_SELECT="auto"

if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi
if [[ -z "$PYTHON_ARCH" ]] && [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
  PYTHON_ARCH="arm64"
fi
PYTHON_CMD=("$PYTHON_BIN")
if [[ -n "$PYTHON_ARCH" ]] && command -v arch >/dev/null 2>&1; then
  PYTHON_CMD=(arch "-$PYTHON_ARCH" "$PYTHON_BIN")
fi

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
    --source-root)
      shift
      [[ $# -gt 0 ]] && SELECTED_IMPORT_SOURCE_ROOT="$1"
      shift || true
      ;;
    --source-root=*)
      SELECTED_IMPORT_SOURCE_ROOT="${1#--source-root=}"
      shift
      ;;
    --source-select)
      shift
      [[ $# -gt 0 ]] && SELECTED_IMPORT_SELECT="$1"
      shift || true
      ;;
    --source-select=*)
      SELECTED_IMPORT_SELECT="${1#--source-select=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

case "$SELECTED_IMPORT_SELECT" in
  auto|all|lightroom|green)
    ;;
  *)
    echo "Unsupported import source selection mode: $SELECTED_IMPORT_SELECT"
    exit 2
    ;;
esac

effective_selected_import_select() {
  if [[ "$SELECTED_IMPORT_SELECT" != "auto" ]]; then
    echo "$SELECTED_IMPORT_SELECT"
    return
  fi
  local root_lc="${(L)SELECTED_IMPORT_SOURCE_ROOT}"
  if [[ "$root_lc" == *"/lr/camera"* || "$root_lc" == *"/pictures/lr/camera"* ]]; then
    echo "lightroom"
    return
  fi
  echo "all"
}

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
    SKIPPED_PHASES+=("$key")
    return 0
  fi
  if [[ "$child_status" != "0" ]]; then
    return "$child_status"
  fi
  done_phase "$key"
}

catalog_source_phase_was_skipped() {
  local key
  for key in "${SKIPPED_PHASES[@]}"; do
    case "$key" in
      camera|apple-photo-albums|leonardo|selected-folder)
        return 0
        ;;
    esac
  done
  return 1
}

abort_if_catalog_sources_incomplete() {
  if catalog_source_phase_was_skipped && [[ "${PBE_ALLOW_PARTIAL_CATALOG:-0}" != "1" ]]; then
    phase catalog-blocked "Catalog export blocked"
    echo "Catalog export blocked because one or more source import phases were skipped or interrupted."
    echo "Skipped phases: ${SKIPPED_PHASES[*]}"
    echo "Set PBE_ALLOW_PARTIAL_CATALOG=1 only when intentionally publishing a partial catalog."
    return 2
  fi
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

phase preflight "Preflight import dependencies"
print -r -- "preflight" > "$(current_phase_file)"
preflight_args=(
  "${PYTHON_CMD[@]}" scripts/preflight_import_dependencies.py
  --source-select "$(effective_selected_import_select)"
)
if [[ -n "$SELECTED_IMPORT_SOURCE_ROOT" ]]; then
  preflight_args+=(--source-root "$SELECTED_IMPORT_SOURCE_ROOT")
fi
for key in "${SKIP_PHASES[@]}"; do
  preflight_args+=(--skip-phase "$key")
done
"${preflight_args[@]}"
clear_current_phase
done_phase preflight

if [[ -z "$SELECTED_IMPORT_SOURCE_ROOT" ]]; then
  run_skippable_phase discard-start "Double-check banned R2 cleanup" \
    node scripts/delete_discarded_r2_media.mjs --delete --discarded-tombstone assets/discarded/discarded-photo-ids.json --request-timeout-ms 180000 --retries 4
fi

phase import-cache "Prepare import cache"
mkdir -p "$IMPORT_CACHE_ROOT"
done_phase import-cache

if [[ -n "$SELECTED_IMPORT_SOURCE_ROOT" ]]; then
  if [[ ! -d "$SELECTED_IMPORT_SOURCE_ROOT" ]]; then
    echo "Selected import source folder does not exist: $SELECTED_IMPORT_SOURCE_ROOT"
    exit 2
  fi
  selected_import_args=(
    "${PYTHON_CMD[@]}" scripts/build_lightroom_thumbnails.py \
    --source-root "$SELECTED_IMPORT_SOURCE_ROOT" \
    --output-root "$IMPORT_CACHE_ROOT" \
    --select "$(effective_selected_import_select)" \
    --r2-upload both \
    --hidden-blacklist assets/hidden/hidden-blacklist.json \
    --discarded-tombstone assets/discarded/discarded-photo-ids.json
  )
  if [[ "${(L)SELECTED_IMPORT_SOURCE_ROOT}" == *leonardo* ]]; then
    selected_import_args+=(--force-country ai)
  fi
  run_skippable_phase selected-folder "Import selected folder" "${selected_import_args[@]}"
else
  run_skippable_phase camera "Import Camera sources" \
    "${PYTHON_CMD[@]}" scripts/build_lightroom_thumbnails.py \
    --source-root /Volumes/Saturn/Pictures/LR/Camera \
    --output-root "$IMPORT_CACHE_ROOT" \
    --r2-upload both \
    --hidden-blacklist assets/hidden/hidden-blacklist.json \
    --discarded-tombstone assets/discarded/discarded-photo-ids.json

  APPLE_PHOTO_ALBUMS_ROOT="/Volumes/Saturn/Pictures/LR/Apple Photo Albums"
  if [[ -d "$APPLE_PHOTO_ALBUMS_ROOT" ]]; then
    run_skippable_phase apple-photo-albums "Import Apple Photos album sources" \
      "${PYTHON_CMD[@]}" scripts/build_lightroom_thumbnails.py \
      --source-root "$APPLE_PHOTO_ALBUMS_ROOT" \
      --output-root "$IMPORT_CACHE_ROOT" \
      --select all \
      --r2-upload both \
      --hidden-blacklist assets/hidden/hidden-blacklist.json \
      --discarded-tombstone assets/discarded/discarded-photo-ids.json
  fi

  run_skippable_phase leonardo "Import Leonardo sources" \
    "${PYTHON_CMD[@]}" scripts/build_lightroom_thumbnails.py \
    --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
    --output-root "$IMPORT_CACHE_ROOT" \
    --select all \
    --force-country ai \
    --r2-upload both \
    --hidden-blacklist assets/hidden/hidden-blacklist.json \
    --discarded-tombstone assets/discarded/discarded-photo-ids.json
fi

abort_if_catalog_sources_incomplete

phase catalog "Export catalog"
"${PYTHON_CMD[@]}" scripts/export_photos_data.py \
  --selection newest \
  --external-media \
  --review-snapshot assets/hidden/hidden-blacklist.json
done_phase catalog

run_skippable_phase eligibility "Force Camera import eligibility on R2" \
  zsh -lc '
    "$@" scripts/audit_import_eligibility.py \
      --write-delete-plan .review-logs/import-eligibility-r2-delete-plan.json &&
    node scripts/delete_discarded_r2_media.mjs \
      --delete \
      --no-history \
      --discarded-tombstone .review-logs/import-eligibility-r2-delete-plan.json \
      --output .review-logs/import-eligibility-r2-delete-manifest.json \
      --request-timeout-ms 180000 \
      --retries 4
  ' _ "${PYTHON_CMD[@]}"

phase worker "Write worker catalog"
node scripts/write_worker_catalog.mjs
done_phase worker
phase sidecar "Write media sidecar"
node scripts/write_media_sidecar.mjs
done_phase sidecar

run_skippable_phase gap-fill "Fill in gaps" \
  "${PYTHON_CMD[@]}" scripts/fill_r2_coverage_gaps.py

if [[ -z "$SELECTED_IMPORT_SOURCE_ROOT" ]]; then
  run_skippable_phase discard-final "Final banned R2 cleanup double-check" \
    node scripts/delete_discarded_r2_media.mjs --delete --discarded-tombstone assets/discarded/discarded-photo-ids.json --request-timeout-ms 180000 --retries 4
fi
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
