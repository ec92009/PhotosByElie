#!/bin/zsh
set -euo pipefail

repo_root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
connector_id="${2:-$(scutil --get ComputerName 2>/dev/null || hostname)}"
connector_id="$(printf '%s' "$connector_id" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9._-')"
data_root="${PBE_CONNECTOR_DATA_ROOT:-$HOME/Dev/PhotosByElie}"
runtime_parent="${PBE_CONNECTOR_RUNTIME_PARENT:-$HOME/Library/Application Support/PhotosByElie}"
config_dir="${PBE_CONNECTOR_CONFIG_DIR:-$HOME/.config/photosbyelie}"
launch_agents="${PBE_CONNECTOR_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
log_dir="${PBE_CONNECTOR_LOG_DIR:-$HOME/Library/Logs/PhotosByElie}"
python_bin="$(command -v python3)"

repo_root="${repo_root:A}"
data_root="${data_root:A}"
if [[ -L "$repo_root/scripts" || -L "$repo_root/scripts/new_owner_connector.py" || -L "$repo_root/scripts/owner_connector_runtime.py" ]]; then
  print -u2 "PhotosByElie connector source must not use symlinks: $repo_root/scripts"
  exit 1
fi
if [[ ! -f "$repo_root/scripts/new_owner_connector.py" || ! -f "$repo_root/scripts/owner_connector_runtime.py" ]]; then
  print -u2 "PhotosByElie repo not found at $repo_root"
  exit 1
fi
if [[ ! -d "$data_root" ]]; then
  print -u2 "PhotosByElie connector data root not found at $data_root"
  exit 1
fi

if [[ "${PBE_SKIP_BRIDGE_BUILD:-0}" != "1" ]]; then
  "$repo_root/scripts/install_sidecar_photos_bridge_app.zsh"
fi

mkdir -p "$runtime_parent" "$config_dir" "$launch_agents" "$log_dir"
runtime_parent="${runtime_parent:A}"
config_dir="${config_dir:A}"
launch_agents="${launch_agents:A}"
log_dir="${log_dir:A}"
config_path="$config_dir/connector.json"
plist_path="$launch_agents/com.photosbyelie.owner-connector.plist"
chmod 700 "$config_dir"

token="${PBE_CONNECTOR_TOKEN:-}"
if [[ -f "$config_path" && -z "$token" ]]; then
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

runtime_revision="${PBE_CONNECTOR_RUNTIME_REVISION:-$(git -C "$repo_root" rev-parse --short=12 HEAD 2>/dev/null || true)}"
if [[ -z "$runtime_revision" || ! "$runtime_revision" =~ '^[A-Za-z0-9._-]{1,80}$' ]]; then
  print -u2 "Could not determine a safe connector runtime revision."
  exit 1
fi
runtime_name="${PBE_CONNECTOR_RUNTIME_NAME:-connector-runtime-${runtime_revision}-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ ! "$runtime_name" =~ '^connector-runtime-[A-Za-z0-9._-]+$' ]]; then
  print -u2 "Connector runtime name is unsafe: $runtime_name"
  exit 1
fi
runtime_path="$runtime_parent/$runtime_name"
runtime_stage="$runtime_parent/.${runtime_name}.staging.$$"
config_temporary=""
plist_temporary=""
if [[ -e "$runtime_path" || -e "$runtime_stage" ]]; then
  print -u2 "Refusing to overwrite an existing connector runtime: $runtime_path"
  exit 1
fi

cleanup() {
  if [[ -n "$runtime_stage" && -d "$runtime_stage" && "${runtime_stage:h}" == "$runtime_parent" && "${runtime_stage:t}" == .connector-runtime-*.staging.* ]]; then
    chmod -R u+w "$runtime_stage" 2>/dev/null || true
    rm -rf -- "$runtime_stage"
  fi
  [[ -n "$config_temporary" && -f "$config_temporary" ]] && rm -f -- "$config_temporary"
  [[ -n "$plist_temporary" && -f "$plist_temporary" ]] && rm -f -- "$plist_temporary"
}
trap cleanup EXIT

mkdir "$runtime_stage"
"$python_bin" "$repo_root/scripts/owner_connector_runtime.py" materialize \
  --source "$repo_root" \
  --destination "$runtime_stage" \
  --revision "$runtime_revision"
mv "$runtime_stage" "$runtime_path"
runtime_stage=""

config_temporary="$config_dir/.connector.json.$$"
plist_temporary="$launch_agents/.com.photosbyelie.owner-connector.plist.$$"
PBE_CONNECTOR_TOKEN="$token" \
PBE_CONNECTOR_ID="$connector_id" \
PBE_CONNECTOR_DATA_ROOT="$data_root" \
PBE_CONNECTOR_RUNTIME_ROOT="$runtime_path" \
PBE_CONNECTOR_CONFIG="$config_temporary" \
PBE_CONNECTOR_FINAL_CONFIG="$config_path" \
PBE_CONNECTOR_PLIST="$plist_temporary" \
PBE_CONNECTOR_PLIST_TEMPLATE="$runtime_path/scripts/new_owner_connector_launch_agent.plist.in" \
PBE_CONNECTOR_PYTHON="$python_bin" \
PBE_CONNECTOR_LOG_DIR="$log_dir" \
"$python_bin" - <<'PY'
import json
import os
from pathlib import Path
import plistlib

config_path = Path(os.environ["PBE_CONNECTOR_CONFIG"])
runtime_root = os.environ["PBE_CONNECTOR_RUNTIME_ROOT"]
data_root = os.environ["PBE_CONNECTOR_DATA_ROOT"]
payload = {
    "workerBase": "https://auth.photos-by-elie.com",
    "connectorId": os.environ["PBE_CONNECTOR_ID"],
    "token": os.environ["PBE_CONNECTOR_TOKEN"],
    "repoRoot": data_root,
    "runtimeRoot": runtime_root,
    "intervalSeconds": 5,
    "localStatusPort": 8766,
}
config_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
config_path.chmod(0o600)

template_path = Path(os.environ["PBE_CONNECTOR_PLIST_TEMPLATE"])
plist = plistlib.loads(template_path.read_bytes())
replacements = {
    "__PYTHON__": os.environ["PBE_CONNECTOR_PYTHON"],
    "__SCRIPT__": str(Path(runtime_root) / "scripts" / "new_owner_connector.py"),
    "__CONFIG__": os.environ["PBE_CONNECTOR_FINAL_CONFIG"],
    "__REPO_ROOT__": data_root,
    "__RUNTIME_ROOT__": runtime_root,
    "__STDOUT__": str(Path(os.environ["PBE_CONNECTOR_LOG_DIR"]) / "owner-connector.log"),
    "__STDERR__": str(Path(os.environ["PBE_CONNECTOR_LOG_DIR"]) / "owner-connector-error.log"),
}

def substitute(value):
    if isinstance(value, str):
        for marker, replacement in replacements.items():
            value = value.replace(marker, replacement)
        return value
    if isinstance(value, list):
        return [substitute(item) for item in value]
    if isinstance(value, dict):
        return {key: substitute(item) for key, item in value.items()}
    return value

plist_path = Path(os.environ["PBE_CONNECTOR_PLIST"])
with plist_path.open("wb") as handle:
    plistlib.dump(substitute(plist), handle, sort_keys=False)
plist_path.chmod(0o600)
PY
unset token

PYTHONDONTWRITEBYTECODE=1 "$python_bin" "$runtime_path/scripts/new_owner_connector.py" \
  --config "$config_temporary" \
  --status >/dev/null
mv "$config_temporary" "$config_path"
config_temporary=""
mv "$plist_temporary" "$plist_path"
plist_temporary=""

if [[ "${PBE_CONNECTOR_SKIP_ACTIVATION:-0}" != "1" ]]; then
  launchctl bootout "gui/$(id -u)" "$plist_path" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist_path"
  launchctl kickstart -k "gui/$(id -u)/com.photosbyelie.owner-connector"
fi

print "Installed PhotosByElie Owner connector '$connector_id'."
print "Runtime: $runtime_path"
print "Data root: $data_root"
print "Config: $config_path"
print "Log: $log_dir/owner-connector.log"
