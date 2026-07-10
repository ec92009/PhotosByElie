#!/bin/zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output_path="${1:-$repo_root/tmp/owner-connectors/PhotosByElie-Mac-Connector.zip}"
stage_root="$(mktemp -d "${TMPDIR:-/tmp}/pbe-owner-connector.XXXXXX")"
package_root="$stage_root/PhotosByElie Mac Connector"

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

mkdir -p "$package_root" "$(dirname "$output_path")"
cp "$repo_root/assets/connector-package/README.txt" "$package_root/README.txt"
cp "$repo_root/assets/connector-package/Install PhotosByElie Connector.command" "$package_root/Install PhotosByElie Connector.command"
chmod +x "$package_root/Install PhotosByElie Connector.command"

"$repo_root/scripts/install_sidecar_photos_bridge_app.zsh" --app-dir "$package_root/PhotosByElie Photos Bridge.app"

rm -f "$output_path"
(cd "$stage_root" && /usr/bin/zip -qry "$output_path" "PhotosByElie Mac Connector")
shasum -a 256 "$output_path"
printf 'Built %s\n' "$output_path"
