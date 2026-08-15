#!/usr/bin/env zsh
set -euo pipefail

app_dir="${PBE_BACKSTAGE_APP:-$HOME/Applications/PhotosByElie Backstage.app}"
executable="$app_dir/Contents/MacOS/PhotosByElieBackstage"

if [[ ! -x "$executable" ]]; then
  print -r -- '{"schemaVersion":1,"ok":false,"error":{"code":"backstage_not_installed","message":"PhotosByElie Backstage is not installed at the configured app path."}}'
  exit 2
fi

control_root="$(mktemp -d "${TMPDIR:-/tmp}/pbe-backstage-control.XXXXXX")"
stdout_path="$control_root/stdout"
stderr_path="$control_root/stderr"
launcher_stderr_path="$control_root/launcher-stderr"
trap 'rm -rf -- "$control_root"' EXIT HUP INT TERM

# LaunchServices supplies the installed app's bundle identity to TCC. Executing
# Contents/MacOS directly makes Photos authorization appear not_determined even
# when macOS has granted the app Full Access.
if ! /usr/bin/open -n -j \
  --stdout "$stdout_path" \
  --stderr "$stderr_path" \
  "$app_dir" \
  --args --control "$@" \
  >/dev/null 2>"$launcher_stderr_path"; then
  cat "$launcher_stderr_path" >&2
  exit 1
fi

timeout_seconds="${PBE_BACKSTAGE_CONTROL_TIMEOUT_SECONDS:-300}"
deadline=$(( SECONDS + timeout_seconds ))
while [[ ! -s "$stdout_path" ]]; do
  if (( SECONDS >= deadline )); then
    [[ ! -s "$stderr_path" ]] || cat "$stderr_path" >&2
    print -r -- '{"schemaVersion":1,"ok":false,"error":{"code":"backstage_control_timeout","message":"PhotosByElie Backstage did not return a control response before the timeout."}}'
    exit 1
  fi
  sleep 0.05
done

[[ ! -s "$stderr_path" ]] || cat "$stderr_path" >&2
[[ ! -s "$stdout_path" ]] || cat "$stdout_path"

python3 - "$stdout_path" "$@" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
arguments = [argument for argument in sys.argv[2:] if argument not in {"--json", "--pretty"}]
text = path.read_text(encoding="utf-8") if path.exists() else ""

if arguments == ["help"] and text.strip():
    raise SystemExit(0)

try:
    payload = json.loads(text)
except (json.JSONDecodeError, OSError):
    raise SystemExit(1)

if payload.get("ok") is True:
    raise SystemExit(0)

error = payload.get("error")
if not isinstance(error, dict):
    raise SystemExit(2)

if error.get("code") in {
    "invalid_arguments",
    "invalid_items_file",
    "items_file_unreadable",
}:
    raise SystemExit(64)

raise SystemExit(1)
PY
