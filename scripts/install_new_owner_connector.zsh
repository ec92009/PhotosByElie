#!/bin/zsh
set -euo pipefail

repo_root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
connector_id="${2:-$(scutil --get ComputerName 2>/dev/null || hostname)}"
connector_id="$(printf '%s' "$connector_id" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9._-')"
config_dir="$HOME/.config/photosbyelie"
config_path="$config_dir/connector.json"
launch_agents="$HOME/Library/LaunchAgents"
plist_path="$launch_agents/com.photosbyelie.owner-connector.plist"
log_dir="$HOME/Library/Logs/PhotosByElie"
python_bin="$(command -v python3)"

if [[ ! -f "$repo_root/scripts/new_owner_connector.py" ]]; then
  print -u2 "PhotosByElie repo not found at $repo_root"
  exit 1
fi

if [[ "${PBE_SKIP_BRIDGE_BUILD:-0}" != "1" ]]; then
  "$repo_root/scripts/install_sidecar_photos_bridge_app.zsh"
fi

mkdir -p "$config_dir" "$launch_agents" "$log_dir"
chmod 700 "$config_dir"

token=""
if [[ -f "$config_path" ]]; then
  token="$($python_bin -c 'import json,sys; print(json.load(open(sys.argv[1])).get("token", ""))' "$config_path" 2>/dev/null || true)"
fi
if [[ -z "$token" ]]; then
  read -rs "token?Paste the Owner connector token for $connector_id: "
  print
fi
if [[ ${#token} -lt 24 ]]; then
  print -u2 "Connector token is missing or too short."
  exit 1
fi

PBE_CONNECTOR_TOKEN="$token" PBE_CONNECTOR_ID="$connector_id" PBE_REPO_ROOT="$repo_root" PBE_CONNECTOR_CONFIG="$config_path" "$python_bin" - <<'PY'
import json, os
from pathlib import Path
path = Path(os.environ["PBE_CONNECTOR_CONFIG"])
payload = {
    "workerBase": "https://auth.photos-by-elie.com",
    "connectorId": os.environ["PBE_CONNECTOR_ID"],
    "token": os.environ["PBE_CONNECTOR_TOKEN"],
    "repoRoot": os.environ["PBE_REPO_ROOT"],
    "intervalSeconds": 5,
    "localStatusPort": 8766,
}
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
path.chmod(0o600)
PY
unset token

sed \
  -e "s|__PYTHON__|$python_bin|g" \
  -e "s|__SCRIPT__|$repo_root/scripts/new_owner_connector.py|g" \
  -e "s|__CONFIG__|$config_path|g" \
  -e "s|__REPO_ROOT__|$repo_root|g" \
  -e "s|__STDOUT__|$log_dir/owner-connector.log|g" \
  -e "s|__STDERR__|$log_dir/owner-connector-error.log|g" \
  "$repo_root/scripts/new_owner_connector_launch_agent.plist.in" > "$plist_path"

launchctl bootout "gui/$(id -u)" "$plist_path" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist_path"
launchctl kickstart -k "gui/$(id -u)/com.photosbyelie.owner-connector"

print "Installed PhotosByElie Owner connector '$connector_id'."
print "Config: $config_path"
print "Log: $log_dir/owner-connector.log"
