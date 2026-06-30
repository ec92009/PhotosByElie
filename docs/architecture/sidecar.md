# Photos By Elie Sidecar Architecture

Date: 2026-06-30

Sidecar is a local-only Apple Photos triage workstation that rides beside Owner.
It is deliberately not the commercial app. Sidecar decides library fate and
metadata; Owner decides publication and commerce.

## Version

Sidecar has its own local visible version in `SIDECAR_VERSION`.

- Current Sidecar version: `v122.9`
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
- Persistent current-window culling, one-row-per-item metadata editing, and
  explicit wastebasket tombstoning.

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

Sidecar has two primary pages backed by the same current window:

- **Culling:** keyboard-first, fast review of the current Apple Photos window.
  `1`-`5` rates, `0` clears rating, `6`-`9` toggle red/yellow/green/blue,
  `P` picks, `X` rejects, `H` hides, `U` unpicks, and arrows select. Click,
  Command-click, and Shift-click support single, toggle, and range selection.
  Actions update local SQLite and advance without blocking on Photos. The
  **Cull bursts** action applies the conservative one-second burst pass to the
  visible current-window photos, skips picked/videos/already rejected items, and
  stages reject decisions for non-survivor frames. Culling stays full-width and
  grid-first; the former persistent Decision side panel is intentionally removed
  in favor of Space-bar Quick Look and the dedicated Editing page. Quick Look
  remains an active culling mode: rating, color, pick/reject/hide/unpick, and
  arrow navigation shortcuts keep acting on the selected item while the preview
  stays open and follows the active selection. Quick Look also repeats the
  active item status with explicit stars, color, decision, metadata, and pending
  Photos write-back reminders. Quick decisions patch affected items in place so
  thumbnails do not blink, and single-item auto-advance follows the latest
  left/right arrow travel direction. `Cmd-Z` provides session-local multilevel
  undo for staged local decision operations while leaving native text-field undo
  alone in title/keyword fields.
- **Editing:** Owner-style title/keyword review of the same current window,
  rendered as one item per row with preview, current state, title/keyword fields,
  approve, reject, resubmit to AI, pick, and unpick actions.

Videos are first-class Sidecar review items. The UI marks video previews with a
standard play icon and duration chip, filters photos/videos separately, asks
PhotoKit for local poster frames without iCloud downloads, plays local videos in
place when Photos can expose the video resource locally, starts video playback
immediately in Quick Look with a muted fallback when browser autoplay policy
requires it, and supports Space-bar Quick Look previews for the active item.

Source controls should include:

- date from/to
- preview count
- offset/page plus slide back and slide forward
- album/smart album later
- horizontal rating, color, decision-state, and media-type filters
- search terms later

## Current V0 Slice

The first implemented slice includes:

- `library-index` PhotoKit bridge command for date/limit/offset slices.
- `preview` PhotoKit bridge command for best-available local JPEG still previews
  and video poster frames with iCloud/network access disabled.
- `video` PhotoKit bridge command for selected-video local playback when the
  underlying video resource is already local.
- Sidecar helper endpoints under `/__sidecar/*`.
- SQLite-backed local decisions and pending sync queue.
- Sidecar web UI for automatically loading the persistent current window,
  sliding the window
  forward/back, filtering by rating/color/decision state, staging cull decisions,
  applying current-window burst culling,
  editing metadata in row form, previewing the active item with Space,
  tombstoning the wastebasket explicitly, viewing upload eligibility, and
  viewing the pending Photos commit plan.
- Dock launcher script for `PhotosByElie Sidecar.app`.

Remaining near-term slices:

- Actual Photos title/keyword write-back for pending sync records.
- Whole-library incremental indexing with durable progress.
- Album/smart-album source filters.
- AI nightly queue generation from the undecided middle.
- Owner consumption of Sidecar upload plans.
