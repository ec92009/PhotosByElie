#!/usr/bin/env zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

log_dir=".review-logs"
mkdir -p "$log_dir"
log_file="$log_dir/max-instruction-poll.log"
state_file="$log_dir/max-instruction-poll-state"
lock_dir="$log_dir/max-instruction-poll.lock"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  printf '%s %s\n' "$(timestamp)" "$*" >> "$log_file"
}

computer_name="$(scutil --get ComputerName 2>/dev/null || hostname 2>/dev/null || true)"
if [[ "${PBE_POLL_ALLOW_NON_DAVID:-}" != "1" && "$computer_name" != David* ]]; then
  log "skip: not a David machine ($computer_name)"
  exit 0
fi

if ! mkdir "$lock_dir" 2>/dev/null; then
  log "skip: previous poll still running"
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "error: not inside a git worktree"
  exit 1
fi

before_head="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if ! git fetch --quiet origin main >>"$log_file" 2>&1; then
  log "error: git fetch origin main failed"
  exit 1
fi

remote_head="$(git rev-parse --short origin/main 2>/dev/null || echo unknown)"
local_head="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [[ "$local_head" != "$remote_head" ]]; then
  if git pull --ff-only --quiet origin main >>"$log_file" 2>&1; then
    log "pulled main: $local_head -> $remote_head"
  else
    log "error: git pull --ff-only failed; local=$local_head remote=$remote_head"
    exit 1
  fi
fi

watched_files=(MAX2DAVID.md MAX_DAVID_CHAT.md)

for watched_file in "${watched_files[@]}"; do
  if [[ ! -f "$watched_file" ]]; then
    log "error: $watched_file missing after poll"
    exit 1
  fi
done

state_value() {
  local key="$1"
  if [[ -f "$state_file" ]]; then
    awk -F= -v key="$key" '$1 == key {print $2}' "$state_file" 2>/dev/null || true
  fi
}

hash_for() {
  shasum -a 256 "$1" | awk '{print $1}'
}

max2david_hash="$(hash_for MAX2DAVID.md)"
max_david_chat_hash="$(hash_for MAX_DAVID_CHAT.md)"
previous_max2david_hash="$(state_value max2david_sha256)"
previous_max_david_chat_hash="$(state_value max_david_chat_sha256)"

changed_files=()
if [[ "$max2david_hash" != "$previous_max2david_hash" ]]; then
  changed_files+=(MAX2DAVID.md)
fi
if [[ "$max_david_chat_hash" != "$previous_max_david_chat_hash" ]]; then
  changed_files+=(MAX_DAVID_CHAT.md)
fi

if (( ${#changed_files[@]} > 0 )); then
  {
    printf 'max2david_sha256=%s\n' "$max2david_hash"
    printf 'max_david_chat_sha256=%s\n' "$max_david_chat_hash"
    printf 'last_seen_at=%s\n' "$(timestamp)"
    printf 'head=%s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  } > "$state_file"

  cp MAX2DAVID.md "$log_dir/MAX2DAVID.latest.md"
  cp MAX_DAVID_CHAT.md "$log_dir/MAX_DAVID_CHAT.latest.md"

  changed_label="${(j:, :)changed_files}"
  log "changed: $changed_label (head $(git rev-parse --short HEAD 2>/dev/null || echo unknown), before $before_head)"
  osascript -e "display notification \"$changed_label changed. Review latest Max/David notes.\" with title \"PhotosByElie\"" >/dev/null 2>&1 || true
else
  log "ok: no new Max/David notes (head $(git rev-parse --short HEAD 2>/dev/null || echo unknown))"
fi
