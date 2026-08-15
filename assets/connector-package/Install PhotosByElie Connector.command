#!/bin/zsh
set -euo pipefail

repo_root="$HOME/Dev/PhotosByElie"

mkdir -p "$HOME/Dev"

if [[ ! -d "$repo_root/.git" ]]; then
  git clone https://github.com/ec92009/PhotosByElie.git "$repo_root"
else
  git -C "$repo_root" fetch origin main
  git -C "$repo_root" pull --ff-only origin main
fi

"$repo_root/scripts/install_new_owner_connector.zsh" "$repo_root"
