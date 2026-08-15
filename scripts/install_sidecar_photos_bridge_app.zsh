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
fi

# Transitional compatibility only. The standalone helper is no longer part of
# Backstage's release identity and keeps its last independent legacy identity
# until the remaining Python callers move behind Backstage-native IPC.
PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER="${PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER:-com.photosbyelie.photos-bridge}"
PBE_PHOTOS_BRIDGE_VERSION="${PBE_PHOTOS_BRIDGE_VERSION:-141.10}"
PBE_PHOTOS_BRIDGE_BUILD="${PBE_PHOTOS_BRIDGE_BUILD:-1}"

if [[ "$PBE_BACKSTAGE_BUNDLE_IDENTIFIER" != "com.photosbyelie.backstage" || \
      "$PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER" != "com.photosbyelie.photos-bridge" ]]; then
  printf 'Native release metadata contains an unexpected bundle identity.\n' >&2
  exit 1
fi

installed_info="$app_dir/Contents/Info.plist"
if [[ "${PBE_ALLOW_PHOTOS_BRIDGE_DOWNGRADE:-0}" != "1" && -r "$installed_info" ]]; then
  installed_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$installed_info" 2>/dev/null || true)"
  installed_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$installed_info" 2>/dev/null || true)"
  installed_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$installed_info" 2>/dev/null || true)"
  if [[ "$installed_identifier" == "$PBE_PHOTOS_BRIDGE_BUNDLE_IDENTIFIER" ]] && \
    python3 - "$installed_version" "$installed_build" "$PBE_PHOTOS_BRIDGE_VERSION" "$PBE_PHOTOS_BRIDGE_BUILD" <<'PY'
import sys


def release(version: str, build: str) -> tuple[tuple[int, ...], int]:
    parts = tuple(int(part) for part in version.split("."))
    if not parts or any(part < 0 for part in parts):
        raise ValueError("invalid version")
    return parts, int(build)


try:
    installed = release(sys.argv[1], sys.argv[2])
    requested = release(sys.argv[3], sys.argv[4])
except (IndexError, TypeError, ValueError):
    raise SystemExit(1)

raise SystemExit(0 if installed > requested else 1)
PY
  then
    printf 'Preserved newer Photos Bridge %s build %s at %s\n' \
      "$installed_version" "$installed_build" "$app_dir"
    exit 0
  fi
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
# Match Backstage's release policy: prefer a stable named identity so future
# helper rebuilds retain the same Keychain/TCC identity. Ad-hoc signing is only
# available as an explicit disposable-development escape hatch.
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
if [[ "$identity" == "-" && "${PBE_ALLOW_ADHOC_SIGNING:-0}" != "1" ]]; then
  printf 'No stable code-signing identity is available.\n' >&2
  printf 'Photos Bridge installation is blocked because ad-hoc rebuilds can lose Photos and Keychain authorization.\n' >&2
  printf 'Install an Apple Development or Developer ID Application identity, set PBE_CODESIGN_IDENTITY,\n' >&2
  printf 'or set PBE_ALLOW_ADHOC_SIGNING=1 only for a disposable local build.\n' >&2
  exit 1
fi
if [[ "$identity" == "-" ]]; then
  # Ad-hoc signatures normally use the changing binary cdhash as their
  # designated requirement, which makes every rebuild look like a new app to
  # TCC. Embed a stable local requirement so Photos/Automation grants continue
  # to identify this bundle across local upgrades.
  codesign --force --deep --sign - \
    --requirements '=designated => identifier "com.photosbyelie.photos-bridge"' \
    "$app_dir"
else
  codesign --force --deep --options runtime --sign "$identity" "$app_dir"
fi
codesign --verify --deep --strict "$app_dir"
signature_details="$(codesign -dvv "$app_dir" 2>&1)"
if [[ "$identity" != "-" && "$signature_details" == *"Signature=adhoc"* ]]; then
  printf 'Photos Bridge unexpectedly received an ad-hoc signature.\n' >&2
  exit 1
fi
printf 'Installed %s\n' "$app_dir"
