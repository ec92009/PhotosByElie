#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
package_root="${script_dir:h}"
configuration="${1:-release}"
output_root="${package_root}/dist"
app="${output_root}/PhotosByElie Backstage.app"
contents="${app}/Contents"
executable="${contents}/MacOS/PhotosByElieBackstage"
repo_root="${package_root:h:h}"
icon_source="${repo_root}/assets/branding/photosbyelie-camera-tripod-logo-1024.png"
iconset="${output_root}/Backstage.iconset"
icon_file="${contents}/Resources/Backstage.icns"
owner_runtime="${contents}/Resources/OwnerRuntime"
release_metadata="${package_root}/release-metadata.zsh"
entitlements="${package_root}/Backstage.entitlements"

if [[ ! -r "$release_metadata" ]]; then
  print -u2 "Missing native release metadata: $release_metadata"
  exit 1
fi
source "$release_metadata"
if [[ "$PBE_BACKSTAGE_BUNDLE_IDENTIFIER" != "com.photosbyelie.backstage" ]]; then
  print -u2 "Native release metadata contains an unexpected bundle identity."
  exit 1
fi
if [[ "$PBE_BACKSTAGE_RELEASE_SOURCE_REF" != refs/heads/* ]] \
  || ! git -C "$repo_root" check-ref-format "$PBE_BACKSTAGE_RELEASE_SOURCE_REF"; then
  print -u2 "Native release metadata contains an invalid canonical source ref."
  exit 1
fi
if ! python3 - "$PBE_BACKSTAGE_UPDATE_MANIFEST_URL" <<'PY'
import sys
from urllib.parse import urlsplit

url = urlsplit(sys.argv[1])
valid = (
    url.scheme.lower() == "https"
    and url.hostname == "download.photos-by-elie.com"
    and url.path == "/backstage/releases/latest.json"
    and not url.query
    and not url.fragment
    and url.username is None
    and url.password is None
)
raise SystemExit(0 if valid else 1)
PY
then
  print -u2 "Native release metadata contains an unapproved Backstage manifest URL."
  exit 1
fi

cd "$package_root"

binary_paths=()
if [[ "$configuration" == "release" ]]; then
  # Official Backstage releases currently target Apple silicon only. Build the
  # arm64 slice explicitly in its own SwiftPM scratch tree so the host
  # architecture cannot leak into the signed artifact. The deployment target
  # remains macOS 14; Intel support can be restored as a deliberate release
  # policy change later.
  release_architectures=(arm64)
  for architecture in "${release_architectures[@]}"; do
    scratch_path="${package_root}/.build/pbe-${configuration}-${architecture}"
    target_triple="${architecture}-apple-macosx14.0"
    build_arguments=(
      -c "$configuration"
      --triple "$target_triple"
      --scratch-path "$scratch_path"
    )
    swift build "${build_arguments[@]}"
    binary_paths+=(
      "$(swift build "${build_arguments[@]}" --show-bin-path)/PhotosByElieBackstage"
    )
  done
else
  swift build -c "$configuration"
  binary_paths+=("$(swift build -c "$configuration" --show-bin-path)/PhotosByElieBackstage")
fi

if [[ -e "$app" || -L "$app" ]]; then
  if [[ -L "$app" || ! -d "$app" ]]; then
    print -u2 "Refusing to replace an unexpected Backstage dist output: $app"
    exit 1
  fi
  # The embedded Owner runtime is deliberately read-only. Restore write access
  # only on this build-owned prior output so a subsequent release can replace it.
  chmod -R u+w "$app"
  rm -rf "$app"
fi
mkdir -p "${contents}/MacOS" "${contents}/Resources"
if (( ${#binary_paths[@]} != 1 )); then
  print -u2 "Apple-silicon-only releases must contain exactly one arm64 build output."
  exit 1
fi
cp "${binary_paths[1]}" "$executable"

if [[ "$configuration" == "release" ]]; then
  executable_architectures="$(/usr/bin/lipo -archs "$executable")"
  if [[ "$executable_architectures" != "arm64" ]]; then
    print -u2 "Release executable is not the required arm64 Apple-silicon slice: $executable_architectures"
    exit 1
  fi
fi

runtime_revision="$(git -C "$repo_root" rev-parse --verify --end-of-options 'HEAD^{commit}')"
materializer_entry="$(git -C "$repo_root" ls-tree "$runtime_revision" -- scripts/owner_connector_runtime.py)"
materializer_path="${materializer_entry#*$'\t'}"
materializer_metadata="${materializer_entry%%$'\t'*}"
materializer_mode="${materializer_metadata%% *}"
materializer_type="${${materializer_metadata#* }%% *}"
materializer_object="${materializer_metadata##* }"
if [[ "$materializer_path" != "scripts/owner_connector_runtime.py" \
      || "$materializer_type" != "blob" \
      || ( "$materializer_mode" != "100644" && "$materializer_mode" != "100755" ) \
      || ! "$materializer_object" =~ '^([0-9a-f]{40}|[0-9a-f]{64})$' ]]; then
  print -u2 "The release commit does not contain a safe Owner runtime materializer."
  exit 1
fi
materializer_temporary="$(mktemp "${TMPDIR:-/tmp}/pbe-owner-runtime.XXXXXX.py")"
cleanup_materializer() {
  [[ ! -f "$materializer_temporary" ]] || rm -f -- "$materializer_temporary"
}
trap cleanup_materializer EXIT HUP INT TERM
git -C "$repo_root" cat-file blob "$materializer_object" > "$materializer_temporary"
chmod 500 "$materializer_temporary"
python3 "$materializer_temporary" materialize \
  --source "$repo_root" \
  --destination "$owner_runtime" \
  --revision "$runtime_revision"
rm -f -- "$materializer_temporary"
trap - EXIT HUP INT TERM

rm -rf "$iconset"
mkdir -p "$iconset"
for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  size="${spec%% *}"
  name="${spec#* }"
  sips -z "$size" "$size" "$icon_source" --out "${iconset}/${name}" >/dev/null
done
iconutil -c icns "$iconset" -o "$icon_file"
rm -rf "$iconset"

cat > "${contents}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>PhotosByElie Backstage</string>
  <key>CFBundleExecutable</key>
  <string>PhotosByElieBackstage</string>
  <key>CFBundleIconFile</key>
  <string>Backstage</string>
  <key>CFBundleIdentifier</key>
  <string>${PBE_BACKSTAGE_BUNDLE_IDENTIFIER}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>PhotosByElie Backstage</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${PBE_BACKSTAGE_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${PBE_BACKSTAGE_BUILD}</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSPhotoLibraryUsageDescription</key>
  <string>Backstage reads Photos for private culling, preview, and export workflows.</string>
  <key>NSPhotoLibraryAddUsageDescription</key>
  <string>Backstage applies approved metadata updates to selected photos.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Backstage reads and applies approved title, caption, and keyword metadata in Apple Photos.</string>
  <key>PBEOwnerRuntimeRevision</key>
  <string>${runtime_revision}</string>
  <key>PBEBackstageReleaseSourceRef</key>
  <string>${PBE_BACKSTAGE_RELEASE_SOURCE_REF}</string>
  <key>PBEBackstageUpdateManifestURL</key>
  <string>${PBE_BACKSTAGE_UPDATE_MANIFEST_URL}</string>
</dict>
</plist>
PLIST

# Keychain ACLs follow the app's designated code requirement. Ad-hoc signatures
# change identity after every rebuild, so release builds must use a stable named
# signing identity. PBE_CODESIGN_IDENTITY remains the explicit override.
identity="${PBE_CODESIGN_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  identity="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' \
      | head -n 1
  )"
fi
if [[ -z "$identity" ]]; then
  identity="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' \
      | head -n 1
  )"
fi
if [[ -z "$identity" ]]; then
  identity="-"
fi

if [[ "$identity" == "-" && "$configuration" == "release" && "${PBE_ALLOW_ADHOC_SIGNING:-0}" != "1" ]]; then
  print -u2 "No stable code-signing identity is available."
  print -u2 "Release installation is blocked because ad-hoc rebuilds cause recurring Keychain prompts."
  print -u2 "Install an Apple Development or Developer ID Application identity, set PBE_CODESIGN_IDENTITY,"
  print -u2 "or set PBE_ALLOW_ADHOC_SIGNING=1 only for a disposable build that will not be installed."
  exit 1
fi

if [[ "$identity" == "-" ]]; then
  codesign \
    --force \
    --deep \
    --sign "$identity" \
    --entitlements "$entitlements" \
    --requirements '=designated => identifier "com.photosbyelie.backstage"' \
    "$app"
else
  codesign --force --deep --options runtime --sign "$identity" --entitlements "$entitlements" "$app"
fi
codesign --verify --deep --strict "$app"
if ! codesign -d --entitlements :- "$app" 2>/dev/null \
  | python3 -c 'import plistlib, sys; entitlements = plistlib.loads(sys.stdin.buffer.read()); raise SystemExit(0 if entitlements.get("com.apple.security.personal-information.photos-library") is True else 1)'; then
  print -u2 "Backstage is missing the signed Photos Library entitlement."
  exit 1
fi
signature_details="$(codesign -dvv "$app" 2>&1)"
if [[ "$identity" != "-" && "$signature_details" == *"Signature=adhoc"* ]]; then
  print -u2 "Backstage unexpectedly received an ad-hoc signature."
  exit 1
fi
codesign -d -r- "$app" 2>&1 | grep -q 'identifier "com.photosbyelie.backstage"'
echo "Signed with: ${identity}"
echo "$app"
