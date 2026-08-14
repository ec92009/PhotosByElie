#!/usr/bin/env zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$HOME/Applications/PhotosByElie Photos Bridge.app"

while (($#)); do
  case "$1" in
    --app-dir)
      shift
      app_dir="${1:?missing path after --app-dir}"
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: zsh scripts/install_sidecar_photos_bridge_app.zsh [--app-dir PATH]

Builds a local app-bundled Apple Photos bridge so macOS grants Photos access to
a stable PhotosByElie helper identity instead of transient /usr/bin/swift.
USAGE
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

bridge_source="$repo_root/scripts/apple_photos_bridge.swift"
if [[ ! -f "$bridge_source" ]]; then
  printf 'Missing Apple Photos bridge source: %s\n' "$bridge_source" >&2
  exit 1
fi

release_metadata="$repo_root/native/PhotosByElieBackstage/release-metadata.zsh"
if [[ -r "$release_metadata" ]]; then
  source "$release_metadata"
else
  backstage_info="${PBE_BACKSTAGE_INFO_PLIST:-$HOME/Applications/PhotosByElie Backstage.app/Contents/Info.plist}"
  if [[ ! -r "$backstage_info" ]]; then
    printf 'Missing native release metadata and installed Backstage Info.plist: %s\n' "$backstage_info" >&2
    exit 1
  fi
  PBE_BACKSTAGE_BUNDLE_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$backstage_info")"
  PBE_BACKSTAGE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$backstage_info")"
  PBE_BACKSTAGE_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$backstage_info")"
  PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :PBEPhotosBridgeBundleIdentifier' "$backstage_info")"
  PBE_PHOTOS_BRIDGE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :PBEPhotosBridgeVersion' "$backstage_info")"
  PBE_PHOTOS_BRIDGE_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :PBEPhotosBridgeBuild' "$backstage_info")"
fi
if [[ "$PBE_BACKSTAGE_BUNDLE_IDENTIFIER" != "com.photosbyelie.backstage" || \
      "$PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER" != "com.photosbyelie.photos-bridge" ]]; then
  printf 'Native release metadata contains an unexpected bundle identity.\n' >&2
  exit 1
fi
if [[ "$PBE_BACKSTAGE_VERSION" != "$PBE_PHOTOS_BRIDGE_VERSION" || \
      "$PBE_BACKSTAGE_BUILD" != "$PBE_PHOTOS_BRIDGE_BUILD" ]]; then
  printf 'Backstage and Photos Bridge release metadata must match.\n' >&2
  exit 1
fi

app_contents="$app_dir/Contents"
macos_dir="$app_contents/MacOS"
resources_dir="$app_contents/Resources"
executable="$macos_dir/PhotosByElie Photos Bridge"
icon_name="PhotosBridgeIcon"
icon_path="$resources_dir/$icon_name.icns"
source_icon="$repo_root/assets/branding/photosbyelie-camera-tripod-logo-1024.png"
source_fingerprint_path="$resources_dir/BridgeSource.sha256"

mkdir -p "$macos_dir" "$resources_dir"

cat > "$app_contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>PhotosByElie Photos Bridge</string>
  <key>CFBundleExecutable</key>
  <string>PhotosByElie Photos Bridge</string>
  <key>CFBundleIconFile</key>
  <string>$icon_name</string>
  <key>CFBundleIdentifier</key>
  <string>$PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>PhotosByElie Photos Bridge</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$PBE_PHOTOS_BRIDGE_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$PBE_PHOTOS_BRIDGE_BUILD</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPhotoLibraryUsageDescription</key>
  <string>PhotosByElie Sidecar indexes Apple Photos metadata locally for culling and review.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>PhotosByElie writes explicitly approved titles and keywords to Apple Photos and verifies the result.</string>
</dict>
</plist>
PLIST

xcrun swiftc "$bridge_source" -o "$executable"
chmod +x "$executable"
shasum -a 256 "$bridge_source" | awk '{print $1}' > "$source_fingerprint_path"

if [[ -f "$source_icon" ]]; then
  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/pbe-photos-bridge-icon.XXXXXX")"
  tmp_iconset="$tmp_root/$icon_name.iconset"
  mkdir -p "$tmp_iconset"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$source_icon" --out "$tmp_iconset/icon_${size}x${size}.png" >/dev/null
    retina=$((size * 2))
    sips -z "$retina" "$retina" "$source_icon" --out "$tmp_iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$tmp_iconset" -o "$icon_path"
  rm -rf "$tmp_root"
fi

touch "$app_dir"
# Seal the whole bundle rather than relying on swiftc's linker-only signature.
# A Developer ID may be supplied in production; local builds retain a stable
# bundle identifier under an explicit ad-hoc app signature.
identity="${PBE_CODESIGN_IDENTITY:--}"
if [[ "$identity" == "-" ]]; then
  # Ad-hoc signatures normally use the changing binary cdhash as their
  # designated requirement, which makes every rebuild look like a new app to
  # TCC. Embed a stable local requirement so Photos/Automation grants continue
  # to identify this bundle across local upgrades.
  codesign --force --deep --sign - \
    --requirements '=designated => identifier "com.photosbyelie.photos-bridge"' \
    "$app_dir"
else
  codesign --force --deep --sign "$identity" "$app_dir"
fi
codesign --verify --deep --strict "$app_dir"
printf 'Installed %s\n' "$app_dir"
