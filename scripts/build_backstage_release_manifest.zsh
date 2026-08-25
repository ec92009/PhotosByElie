#!/bin/zsh
set -euo pipefail

usage() {
  print -u2 "Usage: $0 --artifact signed-backstage.zip --download-url https://... --release-notes '...' --output manifest.json"
}

artifact=""
download_url=""
release_notes=""
output=""
while (( $# > 0 )); do
  case "$1" in
    --artifact) artifact="${2:-}"; shift 2 ;;
    --download-url) download_url="${2:-}"; shift 2 ;;
    --release-notes) release_notes="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) print -u2 "Unknown argument: $1"; usage; exit 64 ;;
  esac
done

if [[ -z "$artifact" || -z "$download_url" || -z "$release_notes" || -z "$output" ]]; then
  usage
  exit 64
fi
if [[ -z "${release_notes//[[:space:]]/}" ]]; then
  print -u2 "Release notes must contain a human-readable summary."
  exit 1
fi
if [[ ! -f "$artifact" || "${artifact:e:l}" != "zip" ]]; then
  print -u2 "The artifact must be an existing signed ZIP archive."
  exit 1
fi
if ! python3 - "$download_url" <<'PY'
import sys
from urllib.parse import urlsplit

url = urlsplit(sys.argv[1])
valid = (
    url.scheme.lower() == "https"
    and bool(url.hostname)
    and url.username is None
    and url.password is None
)
raise SystemExit(0 if valid else 1)
PY
then
  print -u2 "The approved download URL must use HTTPS."
  exit 1
fi
if [[ "${artifact:A}" == "${output:A}" ]]; then
  print -u2 "The manifest output must not overwrite the signed artifact."
  exit 1
fi

stage_root="$(mktemp -d "${TMPDIR:-/tmp}/pbe-backstage-manifest.XXXXXX")"
temporary_output=""
cleanup() {
  [[ -n "$temporary_output" && -f "$temporary_output" ]] && rm -f -- "$temporary_output"
  if [[ -d "$stage_root" ]]; then
    # Release apps intentionally contain a read-only embedded Owner runtime.
    # Restore write permission only inside this build-owned temporary tree so
    # cleanup remains complete without weakening the signed app or source.
    chmod -R u+w "$stage_root"
    rm -rf -- "$stage_root"
  fi
}
trap cleanup EXIT

extracted="$stage_root/extracted"
mkdir -p "$extracted"
/usr/bin/ditto -x -k "$artifact" "$extracted"

app_paths=("$extracted"/**/*.app(N))
if (( ${#app_paths[@]} != 1 )); then
  print -u2 "The signed archive must contain exactly one .app bundle."
  exit 1
fi
app="${app_paths[1]}"
info="$app/Contents/Info.plist"
if [[ ! -f "$info" ]]; then
  print -u2 "The Backstage app bundle is missing Contents/Info.plist."
  exit 1
fi

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$info"
}

bundle_identifier="$(plist_value CFBundleIdentifier)"
version="$(plist_value CFBundleShortVersionString)"
build="$(plist_value CFBundleVersion)"
minimum_os="$(plist_value LSMinimumSystemVersion)"
executable_name="$(plist_value CFBundleExecutable)"
if [[ "$bundle_identifier" != "com.photosbyelie.backstage" ]]; then
  print -u2 "Unexpected Backstage bundle identifier: $bundle_identifier"
  exit 1
fi

executable="$app/Contents/MacOS/$executable_name"
if [[ ! -f "$executable" || -L "$executable" ]]; then
  print -u2 "The Backstage app bundle is missing its regular executable."
  exit 1
fi
architectures="$(/usr/bin/lipo -archs "$executable" 2>/dev/null)" || {
  print -u2 "The Backstage executable architecture could not be inspected."
  exit 1
}
if [[ " $architectures " != *" arm64 "* || " $architectures " != *" x86_64 "* ]]; then
  print -u2 "Refusing to publish a non-universal Backstage release: $architectures"
  exit 1
fi
if [[ ! "$version" =~ '^[0-9]+(\.[0-9]+)*$' || ! "$build" =~ '^[0-9]+$' || ! "$minimum_os" =~ '^[0-9]+(\.[0-9]+)*$' ]]; then
  print -u2 "The signed artifact has invalid version, build, or minimum OS metadata."
  exit 1
fi

/usr/bin/codesign --verify --deep --strict "$app"
if ! /usr/bin/codesign -d --entitlements :- "$app" 2>/dev/null \
  | python3 -c 'import plistlib, sys; entitlements = plistlib.loads(sys.stdin.buffer.read()); raise SystemExit(0 if entitlements.get("com.apple.security.personal-information.photos-library") is True else 1)'; then
  print -u2 "Refusing to publish Backstage without the signed Photos Library entitlement."
  exit 1
fi
signature_details="$(/usr/bin/codesign -dvvv "$app" 2>&1)"
if [[ "$signature_details" == *"Signature=adhoc"* ]]; then
  print -u2 "Refusing to generate a release manifest for an ad-hoc signed artifact."
  exit 1
fi
team_identifier="$(print -r -- "$signature_details" | sed -n 's/^TeamIdentifier=//p' | head -n 1)"
signing_identity="$(print -r -- "$signature_details" | sed -n 's/^Authority=//p' | head -n 1)"
if [[ -z "$team_identifier" || -z "$signing_identity" ]]; then
  print -u2 "The signed artifact did not expose a trusted team identifier and signing authority."
  exit 1
fi
designated_requirement="$(/usr/bin/codesign -d -r- "$app" 2>&1 | sed -n 's/.*designated => //p' | head -n 1)"
if [[ -z "$designated_requirement" ]]; then
  print -u2 "The signed artifact did not expose a designated requirement."
  exit 1
fi

file_size="$(stat -f '%z' "$artifact")"
sha256="$(shasum -a 256 "$artifact" | awk '{print $1}')"
mkdir -p "${output:h}"
temporary_output="${output}.tmp.$$"
python3 - "$temporary_output" "$version" "$build" "$minimum_os" "$release_notes" "$download_url" "$file_size" "$sha256" "$team_identifier" "$signing_identity" "$designated_requirement" "$architectures" <<'PY'
import json
import pathlib
import sys

(
    output,
    version,
    build,
    minimum_os,
    release_notes,
    download_url,
    file_size,
    sha256,
    team_identifier,
    signing_identity,
    designated_requirement,
    architectures,
) = sys.argv[1:]
manifest = {
    "schemaVersion": 1,
    "product": "PhotosByElie Backstage",
    "bundleIdentifier": "com.photosbyelie.backstage",
    "version": version,
    "build": build,
    "minimumOSVersion": minimum_os,
    "releaseNotes": release_notes,
    "artifactFormat": "zip",
    "architectures": architectures.split(),
    "downloadURL": download_url,
    "fileSize": int(file_size),
    "sha256": sha256,
    "trust": {
        "teamIdentifier": team_identifier,
        "signingIdentity": signing_identity,
        "designatedRequirement": designated_requirement,
    },
}
pathlib.Path(output).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY
mv "$temporary_output" "$output"
temporary_output=""
print "Wrote release manifest: $output"
