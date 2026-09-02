#!/bin/zsh
set -euo pipefail

usage() {
  print -u2 "Usage: $0 --repo /path/to/repo --revision COMMIT"
}

repo=""
revision=""
while (( $# > 0 )); do
  case "$1" in
    --repo) repo="${2:-}"; shift 2 ;;
    --revision) revision="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) print -u2 "Unknown argument: $1"; usage; exit 64 ;;
  esac
done

if [[ -z "$repo" || -z "$revision" ]]; then
  usage
  exit 64
fi
if [[ ! -d "$repo/.git" && ! -f "$repo/.git" ]]; then
  print -u2 "The Backstage build source must be a Git working tree."
  exit 1
fi
if [[ ! "$revision" =~ '^([0-9a-f]{40}|[0-9a-f]{64})$' ]]; then
  print -u2 "The Backstage build source revision must be a full lowercase commit ID."
  exit 1
fi

current_revision="$(git -C "$repo" rev-parse --verify --end-of-options 'HEAD^{commit}')" || {
  print -u2 "The Backstage build source HEAD could not be resolved."
  exit 1
}
if [[ "$current_revision" != "$revision" ]]; then
  print -u2 "The Backstage build source HEAD changed after provenance was recorded."
  exit 1
fi
if [[ -n "$(git -C "$repo" status --porcelain=v1 --untracked-files=all)" ]]; then
  print -u2 "The Backstage build source is dirty; commit or remove every tracked and untracked input before building a signed app."
  exit 1
fi

print "Verified clean Backstage build source: $revision"
