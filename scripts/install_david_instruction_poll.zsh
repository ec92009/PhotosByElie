#!/usr/bin/env zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

computer_name="$(scutil --get ComputerName 2>/dev/null || hostname 2>/dev/null || true)"
if [[ "${PBE_POLL_ALLOW_NON_DAVID:-}" != "1" && "$computer_name" != David* ]]; then
  printf 'Refusing to install David instruction poller on non-David machine: %s\n' "$computer_name" >&2
  printf 'Set PBE_POLL_ALLOW_NON_DAVID=1 only for a deliberate test.\n' >&2
  exit 1
fi

mkdir -p .review-logs "$HOME/Library/LaunchAgents"

script_path="$repo_root/scripts/poll_max_instructions.zsh"
plist_path="$HOME/Library/LaunchAgents/com.photosbyelie.max-instruction-poll.plist"
uid="$(id -u)"

calendar_items=""
for minute in {0..59}; do
  calendar_items+="
        <dict>
          <key>Minute</key>
          <integer>${minute}</integer>
        </dict>"
done

cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.photosbyelie.max-instruction-poll</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>${script_path}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${repo_root}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartCalendarInterval</key>
    <array>${calendar_items}
    </array>
    <key>StandardOutPath</key>
    <string>${repo_root}/.review-logs/max-instruction-poll.launchd.log</string>
    <key>StandardErrorPath</key>
    <string>${repo_root}/.review-logs/max-instruction-poll.launchd.err.log</string>
  </dict>
</plist>
PLIST

chmod +x "$script_path"
launchctl bootout "gui/${uid}" "$plist_path" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${uid}" "$plist_path"
launchctl kickstart -k "gui/${uid}/com.photosbyelie.max-instruction-poll" >/dev/null 2>&1 || true

printf 'Installed David instruction poller.\n'
printf 'Plist: %s\n' "$plist_path"
printf 'Script: %s\n' "$script_path"
printf 'Logs: %s/.review-logs/max-instruction-poll.log\n' "$repo_root"
