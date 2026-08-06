#!/usr/bin/env zsh
set -euo pipefail

app_dir="${PBE_BACKSTAGE_APP:-$HOME/Applications/PhotosByElie Backstage.app}"
executable="$app_dir/Contents/MacOS/PhotosByElieBackstage"

if [[ ! -x "$executable" ]]; then
  print -r -- '{"schemaVersion":1,"ok":false,"error":{"code":"backstage_not_installed","message":"PhotosByElie Backstage is not installed at the configured app path."}}'
  exit 2
fi

exec "$executable" --control "$@"
