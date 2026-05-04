#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BLACKLIST_PATH="${1:-}"

if [[ -z "$BLACKLIST_PATH" ]]; then
  BLACKLIST_PATH="$(osascript <<'APPLESCRIPT'
set chosenFile to choose file with prompt "Choose a .pbe-blacklist file"
POSIX path of chosenFile
APPLESCRIPT
)"
fi

/usr/bin/python3 "$SCRIPT_DIR/scripts/apply_blacklist.py" "$BLACKLIST_PATH"

osascript <<'APPLESCRIPT'
display notification "Blacklist applied." with title "PhotosByElie"
APPLESCRIPT
