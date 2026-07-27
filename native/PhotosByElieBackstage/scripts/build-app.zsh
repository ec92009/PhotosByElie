#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
package_root="${script_dir:h}"
configuration="${1:-release}"
output_root="${package_root}/dist"
app="${output_root}/PhotosByElie Backstage.app"
contents="${app}/Contents"
executable="${contents}/MacOS/PhotosByElieBackstage"

cd "$package_root"
swift build -c "$configuration"
binary_path="$(swift build -c "$configuration" --show-bin-path)/PhotosByElieBackstage"

rm -rf "$app"
mkdir -p "${contents}/MacOS" "${contents}/Resources"
cp "$binary_path" "$executable"

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
  <key>CFBundleIdentifier</key>
  <string>com.photosbyelie.backstage</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>PhotosByElie Backstage</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.4.0</string>
  <key>CFBundleVersion</key>
  <string>11</string>
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
