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

cd "$package_root"
swift build -c "$configuration"
binary_path="$(swift build -c "$configuration" --show-bin-path)/PhotosByElieBackstage"

rm -rf "$app"
mkdir -p "${contents}/MacOS" "${contents}/Resources"
cp "$binary_path" "$executable"

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

cat > "${contents}/Info.plist" <<'PLIST'
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
  <string>com.photosbyelie.backstage</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>PhotosByElie Backstage</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.4.12</string>
  <key>CFBundleVersion</key>
  <string>23</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSPhotoLibraryUsageDescription</key>
  <string>Backstage reads Photos for private culling, preview, and export workflows.</string>
  <key>NSPhotoLibraryAddUsageDescription</key>
  <string>Verified metadata give-back is performed through the signed PhotosByElie bridge.</string>
</dict>
</plist>
PLIST

# Ad-hoc signing gives local builds a stable application identity. A named
# Developer ID may be supplied by setting PBE_CODESIGN_IDENTITY.
identity="${PBE_CODESIGN_IDENTITY:--}"
if [[ "$identity" == "-" ]]; then
  codesign \
    --force \
    --deep \
    --sign "$identity" \
    --requirements '=designated => identifier "com.photosbyelie.backstage"' \
    "$app"
else
  codesign --force --deep --sign "$identity" "$app"
fi
codesign --verify --deep --strict "$app"
echo "$app"
