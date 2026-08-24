#!/bin/zsh
set -euo pipefail

usage() {
  print -u2 "Usage: $0 --app 'PhotosByElie Backstage.app' --release-notes 'Summary' [--dry-run]"
}

app=""
release_notes=""
dry_run=0
while (( $# > 0 )); do
  case "$1" in
    --app) app="${2:-}"; shift 2 ;;
    --release-notes) release_notes="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) print -u2 "Unknown argument: $1"; usage; exit 64 ;;
  esac
done

if [[ -z "$app" || -z "${release_notes//[[:space:]]/}" ]]; then
  usage
  exit 64
fi
if [[ ! -d "$app" || "${app:e}" != "app" ]]; then
  print -u2 "The release input must be an existing Backstage .app bundle."
  exit 1
fi

script_dir="${0:A:h}"
manifest_builder="${script_dir}/build_backstage_release_manifest.zsh"
bucket="photosbyelie-public"
release_prefix="backstage/releases"
public_base="https://download.photos-by-elie.com/${release_prefix}"
info="${app}/Contents/Info.plist"

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$info"
}

bundle_identifier="$(plist_value CFBundleIdentifier)"
version="$(plist_value CFBundleShortVersionString)"
build="$(plist_value CFBundleVersion)"
manifest_url="$(plist_value PBEBackstageUpdateManifestURL)"
if [[ "$bundle_identifier" != "com.photosbyelie.backstage" \
      || "$manifest_url" != "${public_base}/latest.json" \
      || ! "$version" =~ '^[0-9]+(\.[0-9]+)*$' \
      || ! "$build" =~ '^[0-9]+$' ]]; then
  print -u2 "The app does not match the approved Backstage cloud-release identity."
  exit 1
fi

stage_root="$(mktemp -d "${TMPDIR:-/tmp}/pbe-backstage-publish.XXXXXX")"
cleanup() {
  [[ ! -d "$stage_root" ]] || rm -rf -- "$stage_root"
}
trap cleanup EXIT HUP INT TERM

archive_name="PhotosByElie-Backstage-v${version}-build-${build}.zip"
archive="${stage_root}/${archive_name}"
manifest="${stage_root}/latest.json"
download_url="${public_base}/${archive_name}"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
"$manifest_builder" \
  --artifact "$archive" \
  --download-url "$download_url" \
  --release-notes "$release_notes" \
  --output "$manifest"

if (( dry_run )); then
  print "Dry run passed for ${archive_name}. No Cloudflare object changed."
  exit 0
fi

wrangler=(npx --yes wrangler)
existing_archive="${stage_root}/existing.zip"
if "${wrangler[@]}" r2 object get "${bucket}/${release_prefix}/${archive_name}" --file "$existing_archive" --remote >/dev/null 2>&1; then
  if [[ "$(shasum -a 256 "$existing_archive" | awk '{print $1}')" != "$(shasum -a 256 "$archive" | awk '{print $1}')" ]]; then
    print -u2 "Refusing to replace a different object at the immutable archive key."
    exit 1
  fi
else
  "${wrangler[@]}" r2 object put "${bucket}/${release_prefix}/${archive_name}" \
    --file "$archive" \
    --content-type "application/zip" \
    --content-disposition "attachment; filename=\"${archive_name}\"" \
    --cache-control "public, max-age=31536000, immutable" \
    --remote \
    --force
fi

verified_archive="${stage_root}/verified.zip"
"${wrangler[@]}" r2 object get "${bucket}/${release_prefix}/${archive_name}" --file "$verified_archive" --remote >/dev/null
if [[ "$(shasum -a 256 "$verified_archive" | awk '{print $1}')" != "$(shasum -a 256 "$archive" | awk '{print $1}')" ]]; then
  print -u2 "The uploaded archive failed exact SHA-256 verification; latest.json was not changed."
  exit 1
fi

previous_manifest="${stage_root}/previous-latest.json"
if "${wrangler[@]}" r2 object get "${bucket}/${release_prefix}/latest.json" --file "$previous_manifest" --remote >/dev/null 2>&1; then
  previous_name="$(python3 - "$previous_manifest" <<'PY'
import json
import re
import sys

try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
    version = str(value["version"])
    build = str(value["build"])
except Exception:
    raise SystemExit(1)
if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", version) or not build.isdigit():
    raise SystemExit(1)
print(f"PhotosByElie-Backstage-v{version}-build-{build}.json")
PY
)" || {
    print -u2 "The current cloud manifest is invalid; refusing to replace it."
    exit 1
  }
  "${wrangler[@]}" r2 object put "${bucket}/${release_prefix}/history/${previous_name}" \
    --file "$previous_manifest" \
    --content-type "application/json" \
    --cache-control "public, max-age=31536000, immutable" \
    --remote \
    --force
fi

# The mutable pointer is deliberately the final write. Any earlier failure
# leaves clients on the previously verified release.
"${wrangler[@]}" r2 object put "${bucket}/${release_prefix}/latest.json" \
  --file "$manifest" \
  --content-type "application/json" \
  --cache-control "public, max-age=60, must-revalidate" \
  --remote \
  --force

verified_manifest="${stage_root}/verified-latest.json"
"${wrangler[@]}" r2 object get "${bucket}/${release_prefix}/latest.json" --file "$verified_manifest" --remote >/dev/null
cmp -s "$manifest" "$verified_manifest" || {
  print -u2 "The published latest manifest failed exact verification."
  exit 1
}
print "Published Backstage ${version} build ${build}: ${download_url}"
