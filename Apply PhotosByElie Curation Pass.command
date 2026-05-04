#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CURATION_PATH="${1:-}"

if [[ -z "$CURATION_PATH" ]]; then
  CURATION_PATH="$(osascript <<'APPLESCRIPT'
set chosenFile to choose file with prompt "Choose a .pbe-curation or .pbe-blacklist file"
POSIX path of chosenFile
APPLESCRIPT
)"
fi

/usr/bin/python3 "$SCRIPT_DIR/scripts/apply_curation_pass.py" "$CURATION_PATH"

osascript <<'APPLESCRIPT'
display notification "Curation Pass applied." with title "PhotosByElie"
APPLESCRIPT
