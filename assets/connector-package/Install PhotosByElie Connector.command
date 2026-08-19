#!/bin/zsh
set -euo pipefail

if [[ "${PBE_ENABLE_LEGACY_CONNECTOR_LAUNCHAGENT:-0}" != "1" ]]; then
  print -u2 "This legacy Owner connector package is retired. Use signed PhotosByElie Backstage for on-demand work."
  print -u2 "For a deliberate rollback rehearsal only, set PBE_ENABLE_LEGACY_CONNECTOR_LAUNCHAGENT=1 before running this command."
  exit 64
fi

repo_root="$HOME/Dev/PhotosByElie"

mkdir -p "$HOME/Dev"

if [[ ! -d "$repo_root/.git" ]]; then
  git clone https://github.com/ec92009/PhotosByElie.git "$repo_root"
else
  git -C "$repo_root" fetch origin main
  git -C "$repo_root" pull --ff-only origin main
fi

"$repo_root/scripts/install_new_owner_connector.zsh" "$repo_root"
