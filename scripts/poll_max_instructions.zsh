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

if [[ ! -f MAX2DAVID.md ]]; then
  log "error: MAX2DAVID.md missing after poll"
  exit 1
fi

instruction_hash="$(shasum -a 256 MAX2DAVID.md | awk '{print $1}')"
previous_hash=""
if [[ -f "$state_file" ]]; then
  previous_hash="$(awk -F= '/^max2david_sha256=/{print $2}' "$state_file" 2>/dev/null || true)"
fi

if [[ "$instruction_hash" != "$previous_hash" ]]; then
  {
    printf 'max2david_sha256=%s\n' "$instruction_hash"
    printf 'last_seen_at=%s\n' "$(timestamp)"
    printf 'head=%s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  } > "$state_file"
  cp MAX2DAVID.md "$log_dir/MAX2DAVID.latest.md"
  log "MAX2DAVID.md changed: ${previous_hash:-none} -> $instruction_hash (head $(git rev-parse --short HEAD 2>/dev/null || echo unknown), before $before_head)"
  osascript -e 'display notification "MAX2DAVID.md changed. Review latest instructions." with title "PhotosByElie"' >/dev/null 2>&1 || true
else
  log "ok: no new MAX2DAVID.md instructions (head $(git rev-parse --short HEAD 2>/dev/null || echo unknown))"
fi
