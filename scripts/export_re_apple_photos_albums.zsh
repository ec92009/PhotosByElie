#!/usr/bin/env zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

destination_root="/Volumes/Saturn/Pictures/RE"
customer="Corine"
allow_existing=0
dry_run=0
albums=()

usage() {
  cat <<'EOF'
Usage:
  zsh scripts/export_re_apple_photos_albums.zsh [options]

Exports current rendered versions from Apple Photos albums into:
  <destination-root>/<customer>/<album name>

Options:
  --destination-root PATH   Default: /Volumes/Saturn/Pictures/RE
  --customer NAME           Default: Corine
  --album NAME              Album to export. Repeatable.
  --allow-existing          Allow non-empty destination folders.
  --dry-run                 Print planned folders without exporting.
  -h, --help                Show this help.

Default albums:
  RE 2026 La Concha 1 Apt 8AB1
  RE 2026 La Concha 2 Apt 8A5

Safety:
  This exports rendered/current Apple Photos versions, not originals. RAW/DNG/NEF
  files are not requested from Photos, and the script fails if any appear in the
  destination folders.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --destination-root)
      destination_root="${2:?--destination-root requires a path}"
      shift 2
      ;;
    --customer)
      customer="${2:?--customer requires a name}"
      shift 2
      ;;
    --album)
      albums+=("${2:?--album requires a name}")
      shift 2
      ;;
    --allow-existing)
      allow_existing=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if (( ${#albums[@]} == 0 )); then
  albums=(
    "RE 2026 La Concha 1 Apt 8AB1"
    "RE 2026 La Concha 2 Apt 8A5"
  )
fi

if [[ ! -d "$destination_root" ]]; then
  printf 'Destination root is not mounted or does not exist: %s\n' "$destination_root" >&2
  exit 1
fi

if ! command -v osascript >/dev/null 2>&1; then
  printf 'osascript is required on macOS to control Apple Photos.\n' >&2
  exit 1
fi

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
review_dir=".review-logs/corine-real-estate-export"
mkdir -p "$review_dir"
report_path="$review_dir/export-${timestamp}.md"
applescript_path="$repo_root/scripts/export_apple_photos_album.applescript"

folder_file_count() {
  find "$1" -type f ! -name '.DS_Store' | wc -l | tr -d ' '
}

folder_total_bytes() {
  find "$1" -type f ! -name '.DS_Store' -print0 \
    | perl -0MFile::stat -ne 'chomp; next unless -f $_; $stat = stat($_); $total += $stat ? $stat->size : 0; END { print $total + 0 }'
}

extension_breakdown() {
  find "$1" -type f ! -name '.DS_Store' -print0 \
    | perl -0ne 'chomp; if (/\.([^.\/]+)$/) { $ext = lc($1) } else { $ext = "(none)" } $count{$ext}++; END { for $ext (sort keys %count) { print "$ext: $count{$ext}\n" } }'
}

raw_hits() {
  find "$1" -type f \( -iname '*.raw' -o -iname '*.dng' -o -iname '*.nef' \) -print
}

{
  printf '# Corine Apple Photos Real Estate Export\n\n'
  printf '- Started: `%s`\n' "$timestamp"
  printf '- Machine: `%s`\n' "$(scutil --get ComputerName 2>/dev/null || hostname)"
  printf '- Repo: `%s`\n' "$repo_root"
  printf '- Destination root: `%s`\n' "$destination_root"
  printf '- Customer: `%s`\n' "$customer"
  printf '- Dry run: `%s`\n\n' "$dry_run"
} > "$report_path"

for album in "${albums[@]}"; do
  destination="$destination_root/$customer/$album"
  printf 'Album: %s\nDestination: %s\n' "$album" "$destination"

  if (( dry_run )); then
    {
      printf '## %s\n\n' "$album"
      printf '- Destination: `%s`\n' "$destination"
      printf '- Status: dry run only\n\n'
    } >> "$report_path"
    continue
  fi

  mkdir -p "$destination"
  existing_count="$(folder_file_count "$destination")"
  if (( existing_count > 0 && allow_existing == 0 )); then
    printf 'Destination is not empty (%s files): %s\n' "$existing_count" "$destination" >&2
    printf 'Use --allow-existing only when continuing an intentional export.\n' >&2
    exit 1
  fi

  before_count="$(folder_file_count "$destination")"
  osascript "$applescript_path" "$album" "$destination"
  after_count="$(folder_file_count "$destination")"
  total_bytes="$(folder_total_bytes "$destination")"
  breakdown="$(extension_breakdown "$destination")"
  raw_files="$(raw_hits "$destination")"

  {
    printf '## %s\n\n' "$album"
    printf '- Destination: `%s`\n' "$destination"
    printf '- Files before export: `%s`\n' "$before_count"
    printf '- Files after export: `%s`\n' "$after_count"
    printf '- New files observed: `%s`\n' "$(( after_count - before_count ))"
    printf '- Total bytes: `%s`\n' "$total_bytes"
    printf '- Extension breakdown:\n\n'
    if [[ -n "$breakdown" ]]; then
      printf '```text\n%s\n```\n\n' "$breakdown"
    else
      printf '```text\n(no files)\n```\n\n'
    fi
  } >> "$report_path"

  if [[ -n "$raw_files" ]]; then
    {
      printf '- RAW/DNG/NEF files found: FAILED\n\n'
      printf '```text\n%s\n```\n\n' "$raw_files"
    } >> "$report_path"
    printf 'RAW/DNG/NEF files appeared in %s; leaving files untouched and failing.\n' "$destination" >&2
    printf 'Report: %s\n' "$report_path" >&2
    exit 1
  fi

  printf -- '- RAW/DNG/NEF files found: `0`\n\n' >> "$report_path"
done

printf 'Report written: %s\n' "$report_path"
