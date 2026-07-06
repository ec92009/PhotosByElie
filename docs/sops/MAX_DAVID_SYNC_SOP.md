# Max/David Sync SOP

Use this SOP when moving work between Max and David, especially when one machine has local Owner state that should not go through Git.

## Roles

- GitHub is for code, public-safe metadata, schema scripts, SOPs, handoff notes, and current Max/David handoff instructions/reports.
- R2 is for private shared artifacts, including `Owner.sqlite` snapshots, client-project media, generated PDFs, and private handoff bundles.
- Gmail self-email is retired for Max/David handoff instructions and reports. Do not search, send, or treat Gmail as authoritative for this workflow unless the user explicitly asks about a specific message.
- SSH or Codex Remote SSH is for remote execution on the other Mac.
- Codex mobile can be used as a control channel for David when Max cannot reach David directly.
- Direct Tailscale/mesh coordination is the primary path. Use the central Tickets API for routine ticket state, SSH/Codex Remote SSH for remote execution when available, and live mesh/remote channels for Codex-to-Codex delegation.
- GitHub handoff polling is a legacy/manual fallback notification path when direct Tailscale/mesh coordination is unavailable or the user explicitly asks for file-based handoff.

Do not commit `assets/owner-actions/Owner.sqlite`, SQLite WAL/SHM files, private client data, passwords, token hashes, signed URLs, or private media binaries.

## Repo Handoff Fallback

- Max-to-David prompts belong in `MAX2DAVID.md` only during an active file-based fallback.
- David-to-Max acknowledgements, progress, blocked states, decisions, recommended prompt/spec changes, and final reports belong in `DAVID2MAX.md` only during an active file-based fallback.
- `MAX_DAVID_CHAT.md` remains a legacy/manual quick-note scratchpad for short conversational context when useful.
- Pull `main` with `git pull --ff-only origin main` before reading inbound notes when possible.
- Commit and push durable handoff-file updates only when the other machine needs to receive that file-based fallback.
- Treat old `MAX2DAVID` or `DAVID2MAX` Gmail subject conventions as obsolete and non-authoritative for this workflow.

## GitHub Poller

Install this on David only when repo-file fallback handoffs should trigger automatic local refresh and notification:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
zsh scripts/install_david_instruction_poll.zsh
```

The installer writes a user LaunchAgent:

```text
~/Library/LaunchAgents/com.photosbyelie.max-instruction-poll.plist
```

The poller:

- Runs only on machines whose ComputerName or hostname starts with `David`, unless `PBE_POLL_ALLOW_NON_DAVID=1` is set for a deliberate test.
- Runs `git fetch origin main`, then `git pull --ff-only origin main` when `origin/main` is ahead.
- Watches `MAX2DAVID.md` and `MAX_DAVID_CHAT.md` by SHA-256.
- Copies the latest notes to `.review-logs/MAX2DAVID.latest.md` and `.review-logs/MAX_DAVID_CHAT.latest.md`.
- Logs to `.review-logs/max-instruction-poll.log`.
- Shows a macOS notification when either watched file changes.

The poller does not execute instructions. It only makes sure David has the latest notes locally and alerts the user/Codex session that new Max/David notes exist.

## Start Acknowledgement

When David begins acting on a new file-based fallback task from `MAX2DAVID.md`, David should first write or queue a short acknowledgement in `DAVID2MAX.md`.

Use this format:

```text
David: starting <short task name>
```

This acknowledgement proves David has moved from "received the instruction" to "trying the task." Commit and push the acknowledgement when Max needs to see it through GitHub. After the work finishes, David should write a final `DAVID2MAX.md` report and commit/push it when it is meant for Max.

## Current Owner DB Sync Target

Use the private R2 bucket with this key for the latest David-to-Max Owner DB snapshot:

```text
photosbyelie-private/owner-sync/snapshots/david/Owner-latest.sqlite.gz
```

Use this key for the latest Max-to-David Owner DB snapshot if needed:

```text
photosbyelie-private/owner-sync/snapshots/max/Owner-latest.sqlite.gz
```

Timestamped snapshots may also be kept under the same folders when audit history matters.

## Source Machine: Create And Upload Snapshot

Run this on the machine that currently has the good `Owner.sqlite`.

```bash
cd /Users/ecohen/Dev/PhotosByElie
mkdir -p tmp/owner-sync
sqlite3 assets/owner-actions/Owner.sqlite ".backup tmp/owner-sync/Owner-sync.sqlite"
gzip -f tmp/owner-sync/Owner-sync.sqlite
shasum -a 256 tmp/owner-sync/Owner-sync.sqlite.gz
npx wrangler r2 object put photosbyelie-private/owner-sync/snapshots/david/Owner-latest.sqlite.gz \
  --file tmp/owner-sync/Owner-sync.sqlite.gz \
  --remote
npx wrangler r2 object head photosbyelie-private/owner-sync/snapshots/david/Owner-latest.sqlite.gz --remote
```

If the source machine is Max, change the object key from `david/Owner-latest.sqlite.gz` to `max/Owner-latest.sqlite.gz`.

Always use SQLite `.backup`. Do not upload a raw copy of a live database file.

## Destination Machine: Download And Restore Snapshot

Run this on the machine that needs the DB.

```bash
cd /Users/ecohen/Dev/PhotosByElie
mkdir -p tmp/owner-sync
npx wrangler r2 object get photosbyelie-private/owner-sync/snapshots/david/Owner-latest.sqlite.gz \
  --file tmp/owner-sync/Owner-from-david.sqlite.gz \
  --remote
shasum -a 256 tmp/owner-sync/Owner-from-david.sqlite.gz
gzip -t tmp/owner-sync/Owner-from-david.sqlite.gz
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
cp assets/owner-actions/Owner.sqlite "assets/owner-actions/Owner.sqlite-before-sync-${timestamp}" 2>/dev/null || true
gunzip -c tmp/owner-sync/Owner-from-david.sqlite.gz > tmp/owner-sync/Owner-from-david.sqlite
cp tmp/owner-sync/Owner-from-david.sqlite assets/owner-actions/Owner.sqlite
sqlite3 assets/owner-actions/Owner.sqlite "PRAGMA integrity_check;"
sqlite3 assets/owner-actions/Owner.sqlite ".tables"
```

If downloading from Max, change the object key and local filename from `david` to `max`.

Before replacing a non-empty local `Owner.sqlite`, confirm the intended direction. Newer local work can be overwritten by a restore.

## Phone Prompt For David

When controlling David through Codex mobile, paste this prompt instead of typing commands:

```text
In /Users/ecohen/Dev/PhotosByElie, pull latest main, read docs/sops/MAX_DAVID_SYNC_SOP.md, then create and upload the David Owner.sqlite R2 snapshot for Max. Use SQLite .backup, not a raw copy. Report the R2 object key, remote size, gzip SHA-256, and Owner table counts.
```

For installing the recurring instruction poller, paste this:

```text
In /Users/ecohen/Dev/PhotosByElie, pull latest main, read docs/sops/MAX_DAVID_SYNC_SOP.md, then run zsh scripts/install_david_instruction_poll.zsh. Confirm the LaunchAgent was installed and that the poll log exists. Do not change Owner.sqlite.
```

## Verification Report

The source machine should report:

- R2 object key.
- R2 HEAD result, including size and content type.
- Local gzip SHA-256.
- Source DB size.
- Source Owner table counts.

The destination machine should report:

- Downloaded gzip size.
- SHA-256 match against the source report.
- `gzip -t` result.
- `PRAGMA integrity_check` result.
- Restored Owner table counts.
- Location of the local pre-restore backup.

## Mounted-Machine Fallback

If the peer machine is mounted under `/Volumes`, the existing local sync helper can pull a file directly:

```bash
python3 scripts/sync_local_assets.py david \
  --direction pull \
  --path assets/owner-actions/Owner.sqlite \
  --apply \
  --progress
```

Prefer the R2 snapshot workflow for `Owner.sqlite` when the database may be open or when the machines are not directly mounted.
