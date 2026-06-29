#!/usr/bin/env zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$HOME/Applications/PhotosByElie Sidecar.app"
add_to_dock=0
open_after=0

while (($#)); do
  case "$1" in
    --app-dir)
      shift
      app_dir="${1:?missing path after --app-dir}"
      ;;
    --add-to-dock)
      add_to_dock=1
      ;;
    --open)
      open_after=1
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: zsh scripts/install_sidecar_dock_app.zsh [--app-dir PATH] [--add-to-dock] [--open]

Builds a local Dock-friendly "PhotosByElie Sidecar.app" launcher. The app starts
the Sidecar helper, then opens Safari to the local Sidecar culling workspace.
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

app_contents="$app_dir/Contents"
macos_dir="$app_contents/MacOS"
resources_dir="$app_contents/Resources"
executable="$macos_dir/PhotosByElie Sidecar"
icon_name="SidecarIcon"
icon_path="$resources_dir/$icon_name.icns"
source_icon="$repo_root/assets/branding/photosbyelie-camera-tripod-logo-1024.png"

mkdir -p "$macos_dir" "$resources_dir"

cat > "$app_contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>PhotosByElie Sidecar</string>
  <key>CFBundleExecutable</key>
  <string>PhotosByElie Sidecar</string>
  <key>CFBundleIconFile</key>
  <string>$icon_name</string>
  <key>CFBundleIdentifier</key>
  <string>com.photosbyelie.sidecar-launcher</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>PhotosByElie Sidecar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$(tr -d '\n' < "$repo_root/SIDECAR_VERSION")</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPhotoLibraryUsageDescription</key>
  <string>PhotosByElie Sidecar reviews Apple Photos library previews and stages local culling metadata before explicit Photos write-back.</string>
</dict>
</plist>
PLIST

cat > "$executable" <<LAUNCHER
#!/usr/bin/env zsh
set -euo pipefail

export PBE_REPO_ROOT="$repo_root"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"

cd "\$PBE_REPO_ROOT"
exec python3 "\$PBE_REPO_ROOT/scripts/open_sidecar_main.py"
LAUNCHER
chmod +x "$executable"

if [[ -f "$source_icon" ]]; then
  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/pbe-sidecar-icon.XXXXXX")"
  tmp_iconset="$tmp_root/$icon_name.iconset"
  mkdir -p "$tmp_iconset"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$source_icon" --out "$tmp_iconset/icon_${size}x${size}.png" >/dev/null
    retina=$((size * 2))
    sips -z "$retina" "$retina" "$source_icon" --out "$tmp_iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$tmp_iconset" -o "$icon_path"
  rm -rf "$tmp_root"
else
  printf 'Warning: source icon missing: %s\n' "$source_icon" >&2
fi

touch "$app_dir"

if (( add_to_dock )); then
  dock_url="$(python3 - "$app_dir" <<'PY'
import pathlib
import sys
print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"
  dock_items="$(defaults read com.apple.dock persistent-apps 2>/dev/null || true)"
  if [[ "$dock_items" != *"PhotosByElie Sidecar.app"* && "$dock_items" != *"PhotosByElie%20Sidecar.app"* ]]; then
    defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$dock_url</string><key>_CFURLStringType</key><integer>15</integer></dict></dict><key>tile-type</key><string>file-tile</string></dict>"
    killall Dock >/dev/null 2>&1 || true
  fi
fi

printf 'Installed %s\n' "$app_dir"

if (( open_after )); then
  open "$app_dir"
fi
