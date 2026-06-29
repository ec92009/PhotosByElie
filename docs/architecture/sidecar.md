# Photos By Elie Sidecar Architecture

Date: 2026-06-29

Sidecar is a local-only Apple Photos triage workstation that rides beside Owner.
It is deliberately not the commercial app. Sidecar decides library fate and
metadata; Owner decides publication and commerce.

## Version

Sidecar has its own local visible version in `SIDECAR_VERSION`.

- Current Sidecar version: `v121.4`
- Versioning follows the canonical `~/Dev/.SOPs/VERSIONING_SOP.md` default
  calendar visible-version rule for this local web-app surface.
- Sidecar version bumps do not imply a public Photos By Elie site version bump.

## Architecture

Sidecar v0 uses the existing repo shape:

- `sidecar.html`, `sidecar.js`, `sidecar.css`: local web UI.
- `scripts/sidecar_server.py`: localhost helper and JSON endpoints.
- `scripts/sidecar_state_db.py`: Sidecar tables in `assets/owner-actions/Owner.sqlite`.
- `scripts/apple_photos_bridge.swift`: PhotoKit bridge for library slices and
  best-available local previews.
- `scripts/install_sidecar_dock_app.zsh` and `scripts/open_sidecar_main.py`:
  Dock-friendly launcher that starts the helper and opens Safari.

This keeps the UI fast to prototype, Python responsible for local orchestration
and SQLite, and Swift responsible only for Apple Photos/PhotoKit boundaries.

## Product Boundary

Sidecar owns:

- Whole Apple Photos library indexing and date/search slices.
- Regular albums and smart albums as review sources.
- Local-first culling: rating, color, pick, unpick, reject, hide.
- Title/keyword editing and AI proposal review state.
- Pending Photos write-back plans.
- Next-upload eligibility plans.

Owner owns:

- Forced Apple Photos/iCloud materialization for picked assets.
- Public/private derivative generation.
- R2 upload and repair.
- Public catalog SQLite rebuilds.
- Validation, versioned publication, checkout, and delivery.

The commercial app owns:

- Buyer browsing, search, basket, checkout, account/order history, and download
  delivery.

## State Model

Sidecar starts from the entire Apple Photos library, roughly 57K items. Every
item should be reachable by capture date, even when album membership is messy.

Core states:

- `undecided`
- `picked`
- `rejected`
- `hidden`
- `metadata proposed`
- `metadata approved`
- `metadata rework`
- `ready for Owner upload`

Upload eligibility is local and immediate:

```text
picked
AND metadata approved
AND not rejected
AND not hidden
AND not already current in Owner publication state
```

## Photos Write-Back

Sidecar decisions are instant local SQLite writes. Apple Photos write-back must
not happen on each keystroke.

Sidecar queues pending sync records for explicit commit:

- Save current batch.
- Commit all pending.
- Prompt before exit if pending changes exist.

Photos write-back uses namespaced PBE keyword families:

```text
PBE Rating 1
PBE Rating 2
PBE Rating 3
PBE Rating 4
PBE Rating 5

PBE Color Red
PBE Color Yellow
PBE Color Green
PBE Color Blue
PBE Color Purple

PBE Picked
PBE Rejected
PBE Hidden
PBE Tombstoned
```

Exclusive families are enforced by Sidecar before write-back. For example,
setting `PBE Rating 4` removes other `PBE Rating *` keywords from the intended
Photos update, but preserves non-PBE user keywords.

## UI Model

Sidecar has two primary modes:

- **Cull:** keyboard-first, fast review of date/search slices. `1`-`5` rates,
  `0` clears rating, `P` picks, `X` rejects, `H` hides, `U` unpicks, and arrows
  select. Actions update local SQLite and advance without blocking on Photos.
- **Edit:** Owner-style title/keyword review. It supports approve, reject,
  resubmit to AI, manual title/keyword edits, and batch operations.

Source controls should include:

- date from/to
- preview count
- offset/page
- album/smart album later
- state filters later
- search terms later

## Current V0 Slice

The first implemented slice includes:

- `library-index` PhotoKit bridge command for date/limit/offset slices.
- `preview` PhotoKit bridge command for best-available local JPEG previews with
  iCloud/network access disabled.
- Sidecar helper endpoints under `/__sidecar/*`.
- SQLite-backed local decisions and pending sync queue.
- Sidecar web UI for loading slices, staging cull decisions, editing metadata,
  viewing upload eligibility, and viewing the pending Photos commit plan.
- Dock launcher script for `PhotosByElie Sidecar.app`.

Remaining near-term slices:

- Actual Photos title/keyword write-back for pending sync records.
- Whole-library incremental indexing with durable progress.
- Album/smart-album source filters.
- AI nightly queue generation from the undecided middle.
- Owner consumption of Sidecar upload plans.
