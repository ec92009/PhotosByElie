#!/usr/bin/env zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
launch_agents_dir="$HOME/Library/LaunchAgents"
log_dir="$HOME/Library/Logs/PhotosByElie"
python_bin="${PYTHON3:-$(command -v python3 || true)}"
photos_label="com.photosbyelie.sidecar.photos-index-sync"
ai_label="com.photosbyelie.sidecar.picked-ai-plan"
photos_hour=2
photos_minute=10
ai_hour=3
ai_minute=10
load_after=0
unload_only=0

while (($#)); do
  case "$1" in
    --photos-hour)
      shift
      photos_hour="${1:?missing hour}"
      ;;
    --photos-minute)
      shift
      photos_minute="${1:?missing minute}"
      ;;
    --ai-hour)
      shift
      ai_hour="${1:?missing hour}"
      ;;
    --ai-minute)
      shift
      ai_minute="${1:?missing minute}"
      ;;
    --load)
      load_after=1
      ;;
    --unload)
      unload_only=1
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: zsh scripts/install_sidecar_scheduled_tasks.zsh [--load] [--unload]
       [--photos-hour H --photos-minute M] [--ai-hour H --ai-minute M]

Installs two separate local LaunchAgents as a fallback when Codex Scheduled is
not available:
  - com.photosbyelie.sidecar.photos-index-sync
  - com.photosbyelie.sidecar.picked-ai-plan

Use --load to load/reload them immediately. Without --load, this only writes the
plist files so the schedule can be reviewed first.

The scheduled jobs use sidecar_maintenance.py only. Its PhotoKit work is routed
through authenticated IPC to the signed PhotosByElie Backstage app and fails
closed when Backstage is unavailable. This installer never installs or launches
the retired Photos Bridge helper.
USAGE
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

mkdir -p "$launch_agents_dir" "$log_dir"
if [[ -z "$python_bin" || ! -x "$python_bin" ]]; then
  printf 'Could not find an executable python3. Set PYTHON3=/path/to/python3 and retry.\n' >&2
  exit 1
fi
photos_plist="$launch_agents_dir/$photos_label.plist"
ai_plist="$launch_agents_dir/$ai_label.plist"

unload_plist() {
  local plist="$1"
  if [[ -f "$plist" ]]; then
    launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  fi
}

if (( unload_only )); then
  unload_plist "$photos_plist"
  unload_plist "$ai_plist"
  rm -f "$photos_plist" "$ai_plist"
  printf 'Removed Sidecar scheduled tasks.\n'
  exit 0
fi

write_plist() {
  local plist="$1"
  local label="$2"
  local hour="$3"
  local minute="$4"
  local command="$5"
  local stdout_log="$6"
  local stderr_log="$7"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$python_bin</string>
    <string>$repo_root/scripts/sidecar_maintenance.py</string>
    <string>--repo-root</string>
    <string>$repo_root</string>
    <string>$command</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$hour</integer>
    <key>Minute</key>
    <integer>$minute</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$stdout_log</string>
  <key>StandardErrorPath</key>
  <string>$stderr_log</string>
  <key>WorkingDirectory</key>
  <string>$repo_root</string>
</dict>
</plist>
PLIST
}

write_plist \
  "$photos_plist" \
  "$photos_label" \
  "$photos_hour" \
  "$photos_minute" \
  "photos-index-sync" \
  "$log_dir/sidecar-photos-index-sync.log" \
  "$log_dir/sidecar-photos-index-sync.err.log"

write_plist \
  "$ai_plist" \
  "$ai_label" \
  "$ai_hour" \
  "$ai_minute" \
  "picked-ai-plan" \
  "$log_dir/sidecar-picked-ai-plan.log" \
  "$log_dir/sidecar-picked-ai-plan.err.log"

printf 'Installed %s\n' "$photos_plist"
printf 'Installed %s\n' "$ai_plist"
printf 'Scheduled PhotoKit work uses authenticated IPC to PhotosByElie Backstage.\n'
printf 'Keep PhotosByElie Backstage installed and available; jobs fail closed when it is unavailable.\n'

if (( load_after )); then
  unload_plist "$photos_plist"
  unload_plist "$ai_plist"
  launchctl bootstrap "gui/$(id -u)" "$photos_plist"
  launchctl bootstrap "gui/$(id -u)" "$ai_plist"
  printf 'Loaded Sidecar scheduled tasks.\n'
fi
