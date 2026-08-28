#!/bin/zsh
set -euo pipefail

usage() {
  print -u2 "Usage: $0 --repo /path/to/repo --revision COMMIT --canonical-ref refs/heads/release/backstage [--remote origin]"
}

repo=""
revision=""
canonical_ref=""
remote="origin"
while (( $# > 0 )); do
  case "$1" in
    --repo) repo="${2:-}"; shift 2 ;;
    --revision) revision="${2:-}"; shift 2 ;;
    --canonical-ref) canonical_ref="${2:-}"; shift 2 ;;
    --remote) remote="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) print -u2 "Unknown argument: $1"; usage; exit 64 ;;
  esac
done

if [[ -z "$repo" || -z "$revision" || -z "$canonical_ref" || -z "$remote" ]]; then
  usage
  exit 64
fi
if [[ ! -d "$repo/.git" && ! -f "$repo/.git" ]]; then
  print -u2 "The release source must be a Git working tree."
  exit 1
fi
if [[ ! "$revision" =~ '^([0-9a-f]{40}|[0-9a-f]{64})$' ]]; then
  print -u2 "The release source revision must be a full lowercase commit ID."
  exit 1
fi
if [[ "$canonical_ref" != refs/heads/* ]] \
  || ! git -C "$repo" check-ref-format "$canonical_ref"; then
  print -u2 "The canonical release source must be a valid full branch ref."
  exit 1
fi

resolved_revision="$(git -C "$repo" rev-parse --verify --end-of-options "${revision}^{commit}")" || {
  print -u2 "The release source revision is not present as a local commit."
  exit 1
}
if [[ "$resolved_revision" != "$revision" ]]; then
  print -u2 "The release source revision did not resolve exactly."
  exit 1
fi

remote_lines="$(git -C "$repo" ls-remote --exit-code "$remote" "$canonical_ref")" || {
  print -u2 "The canonical release ref is unavailable from the approved remote."
  exit 1
}
remote_tips=("${(@f)remote_lines}")
if (( ${#remote_tips[@]} != 1 )); then
  print -u2 "The approved remote returned an ambiguous canonical release ref."
  exit 1
fi
remote_tip="${remote_tips[1]%%$'\t'*}"
remote_ref="${remote_tips[1]#*$'\t'}"
if [[ ! "$remote_tip" =~ '^([0-9a-f]{40}|[0-9a-f]{64})$' \
      || "$remote_ref" != "$canonical_ref" ]]; then
  print -u2 "The approved remote returned malformed canonical release metadata."
  exit 1
fi

# FETCH_HEAD is intentionally the only local Git metadata changed here. No
# branch, tag, worktree file, or remote-tracking ref is created or rewritten.
git -C "$repo" fetch --quiet --no-tags "$remote" "$canonical_ref"
fetched_tip="$(git -C "$repo" rev-parse --verify --end-of-options 'FETCH_HEAD^{commit}')"
if [[ "$fetched_tip" != "$remote_tip" ]]; then
  print -u2 "The fetched canonical release tip differs from the advertised tip."
  exit 1
fi
if ! git -C "$repo" merge-base --is-ancestor "$revision" "$fetched_tip"; then
  print -u2 "The release source revision is not reachable from the canonical release ref."
  exit 1
fi

print "Verified release source: ${revision} via ${canonical_ref} at ${remote_tip}"
