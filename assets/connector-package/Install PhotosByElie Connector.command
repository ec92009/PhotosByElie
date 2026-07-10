#!/bin/zsh
set -euo pipefail

bundle_root="$(cd "$(dirname "$0")" && pwd)"
repo_root="$HOME/Dev/PhotosByElie"
app_source="$bundle_root/PhotosByElie Photos Bridge.app"
app_target="$HOME/Applications/PhotosByElie Photos Bridge.app"

mkdir -p "$HOME/Applications" "$HOME/Dev"
if [[ -e "$app_target" ]]; then
  mv "$app_target" "$HOME/Applications/PhotosByElie Photos Bridge-before-$(date -u +%Y%m%dT%H%M%SZ).app"
fi
cp -R "$app_source" "$app_target"

if [[ ! -d "$repo_root/.git" ]]; then
  git clone https://github.com/ec92009/PhotosByElie.git "$repo_root"
else
  git -C "$repo_root" fetch origin main
  git -C "$repo_root" pull --ff-only origin main
fi

PBE_SKIP_BRIDGE_BUILD=1 "$repo_root/scripts/install_new_owner_connector.zsh" "$repo_root"
