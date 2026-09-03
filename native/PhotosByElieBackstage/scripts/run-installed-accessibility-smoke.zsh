#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
app_path="${1:-/Applications/PhotosByElie Backstage.app}"
runner_dir="$(mktemp -d "${TMPDIR:-/tmp}/pbb-accessibility-smoke.XXXXXX")"
smoke_app="${runner_dir}/PhotosByElie Backstage Accessibility Smoke.app"
smoke_process='PhotosByElieBackstageAccessibilitySmoke'
smoke_bundle='com.photosbyelie.backstage.accessibility-smoke'

cleanup() {
  chmod -R u+w "$runner_dir" 2>/dev/null || true
  rm -rf -- "$runner_dir"
}
trap cleanup EXIT HUP INT TERM

ditto "$app_path" "$smoke_app"
mv \
  "$smoke_app/Contents/MacOS/PhotosByElieBackstage" \
  "$smoke_app/Contents/MacOS/$smoke_process"
plutil -replace CFBundleIdentifier \
  -string "$smoke_bundle" \
  "$smoke_app/Contents/Info.plist"
plutil -replace CFBundleDisplayName \
  -string 'PhotosByElie Backstage Accessibility Smoke' \
  "$smoke_app/Contents/Info.plist"
plutil -replace CFBundleExecutable \
  -string "$smoke_process" \
  "$smoke_app/Contents/Info.plist"
codesign --force --deep --sign - "$smoke_app" >/dev/null
codesign --verify --deep --strict "$smoke_app"

open -na "$smoke_app" --args --pbe-accessibility-smoke-read-only

smoke_pid=''
for attempt in {1..120}; do
  smoke_pid="$(pgrep -x "$smoke_process" | head -n 1 || true)"
  [[ -n "$smoke_pid" ]] && break
  sleep 0.1
done
if [[ -z "$smoke_pid" ]]; then
  print -u2 'FAIL installed accessibility smoke: the isolated app did not start.'
  exit 1
fi

finish_smoke() {
  kill -TERM "$smoke_pid" 2>/dev/null || true
  for attempt in {1..50}; do
    kill -0 "$smoke_pid" 2>/dev/null || break
    sleep 0.1
  done
}
trap 'finish_smoke; cleanup' EXIT HUP INT TERM

ui_snapshot() {
  osascript - "$smoke_process" <<'APPLESCRIPT'
on run arguments
    set processName to item 1 of arguments
    tell application "System Events" to tell process processName
        return entire contents of window 1
    end tell
end run
APPLESCRIPT
}

wait_for_text() {
  local expected_text="$1"
  local timeout_tenths="$2"
  for attempt in {1..$timeout_tenths}; do
    if ui_snapshot 2>/dev/null | grep -Fq -- "$expected_text"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

select_sidebar_row() {
  local row_index="$1"
  osascript - "$smoke_process" "$row_index" <<'APPLESCRIPT'
on run arguments
    set processName to item 1 of arguments
    set rowIndex to item 2 of arguments as integer
    tell application "System Events" to tell process processName
        set frontmost to true
        if rowIndex is less than or equal to 9 then
            keystroke (rowIndex as text) using command down
        else if rowIndex is 10 then
            keystroke "1" using {command down, option down}
        else if rowIndex is 11 then
            keystroke "2" using {command down, option down}
        else
            keystroke "3" using {command down, option down}
        end if
        repeat 20 times
            try
                set sidebarOutline to first outline of first scroll area of first group of first splitter group of first group of window 1
                if value of attribute "AXSelected" of row rowIndex of sidebarOutline is true then return true
            end try
            delay 0.1
        end repeat
        return false
    end tell
end run
APPLESCRIPT
}

for attempt in {1..120}; do
  if ui_snapshot >/dev/null 2>&1; then break; fi
  sleep 0.1
done
if ! wait_for_text 'Read-only accessibility smoke' 120; then
  print -u2 'FAIL installed accessibility smoke: the app did not expose its isolated read-only state.'
  exit 1
fi

surface_names=(
  'Overview'
  'Activity'
  'Fixtures'
  'People & Access'
  'Gallery'
  'Review'
  'Metadata'
  'Waste Basket'
  'Uploads'
  'Client Delivery'
  'Storage Maintenance'
  'Updates'
)
surface_receipts=(
  'Read-only workspace: Overview'
  'Read-only workspace: Activity'
  'Read-only workspace: Fixtures'
  'Read-only workspace: People & Access'
  'Read-only workspace: Gallery'
  'Read-only workspace: Review'
  'Read-only workspace: Metadata'
  'Read-only workspace: Waste Basket'
  'Read-only workspace: Uploads'
  'Read-only workspace: Client Delivery'
  'Read-only workspace: Storage Maintenance'
  'Read-only workspace: Updates'
)

for surface_index in {1..${#surface_names}}; do
  selected="$(select_sidebar_row "$surface_index")"
  if [[ "$selected" != 'true' ]]; then
    print -u2 "FAIL installed accessibility smoke: ${surface_names[$surface_index]} did not expose selected state."
    exit 1
  fi
  if ! wait_for_text "${surface_receipts[$surface_index]}" 50; then
    print -u2 "FAIL installed accessibility smoke: ${surface_names[$surface_index]} did not expose its runtime workspace."
    exit 1
  fi
  print "PASS surface: ${surface_names[$surface_index]}"
done

select_sidebar_row 5 >/dev/null
osascript -e "tell application \"System Events\" to tell process \"$smoke_process\" to keystroke \"a\" using command down"
if ! wait_for_text 'Keyboard Select All reached the guarded Gallery handler' 30; then
  print -u2 'FAIL installed accessibility smoke: Command-A did not reach the guarded Gallery handler.'
  exit 1
fi
print 'PASS keyboard: Command-A reached guarded Gallery Select All'

selected="$(select_sidebar_row 9)"
if [[ "$selected" != 'true' ]] || ! wait_for_text 'Read-only workspace: Uploads' 50; then
  print -u2 'FAIL installed accessibility smoke: Uploads could not be reopened for state checks.'
  exit 1
fi
upload_selection_state="$(osascript - "$smoke_process" <<'APPLESCRIPT'
on run arguments
    set processName to item 1 of arguments
    tell application "System Events" to tell process processName
        set allElements to entire contents of window 1
        repeat with candidate in allElements
            try
                if role of candidate is "AXButton" then
                    set candidateIdentifier to value of attribute "AXIdentifier" of candidate as text
                    if candidateIdentifier is "backstage.uploads.primary-selection" then
                        set candidateName to name of candidate as text
                        return candidateName & "|" & candidateIdentifier & "|" & (enabled of candidate as text)
                    end if
                end if
            end try
        end repeat
    end tell
    return "missing"
end run
APPLESCRIPT
)"
if [[ "$upload_selection_state" != 'Upload selection|backstage.uploads.primary-selection|false' ]]; then
  print -u2 "FAIL installed accessibility smoke: Upload selection state was ${upload_selection_state}."
  exit 1
fi

selected="$(select_sidebar_row 12)"
if [[ "$selected" != 'true' ]] || ! wait_for_text 'Read-only workspace: Updates' 50; then
  print -u2 'FAIL installed accessibility smoke: Updates could not be reopened for state checks.'
  exit 1
fi
if ! wait_for_text 'Failed safely' 30; then
  print -u2 'FAIL installed accessibility smoke: Updates did not expose the safe failure state.'
  exit 1
fi
print 'PASS state: busy, selected, disabled, and failed states are exposed'

version="$(plutil -extract CFBundleShortVersionString raw "$app_path/Contents/Info.plist")"
build="$(plutil -extract CFBundleVersion raw "$app_path/Contents/Info.plist")"
print "PASS installed accessibility smoke: Backstage v${version} build ${build}"
