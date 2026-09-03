#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
source_file="${script_dir}/backstage_accessibility_smoke.swift"
app_path="${1:-/Applications/PhotosByElie Backstage.app}"
runner_dir="$(mktemp -d "${TMPDIR:-/tmp}/pbb-accessibility-smoke.XXXXXX")"
runner_path="${runner_dir}/backstage-accessibility-smoke"

cleanup() {
  rm -rf -- "$runner_dir"
}
trap cleanup EXIT HUP INT TERM

swiftc \
  -parse-as-library \
  -framework AppKit \
  -framework ApplicationServices \
  "$source_file" \
  -o "$runner_path"

"$runner_path" "$app_path"
