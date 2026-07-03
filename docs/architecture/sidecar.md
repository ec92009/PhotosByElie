# Photos By Elie Sidecar Architecture

Date: 2026-07-03

Sidecar is a local-only Apple Photos triage workstation that rides beside Owner.
It is deliberately not the commercial app. Sidecar decides library fate and
metadata; Owner decides publication and commerce.

## Version

Sidecar has its own local visible version in `SIDECAR_VERSION`.

- Current Sidecar version: `v125.4`
- Versioning follows the canonical `~/Dev/.SOPs/VERSIONING_SOP.md` default
  calendar visible-version rule for this local web-app surface.
- Sidecar version bumps do not imply a public Photos By Elie site version bump.

## Architecture

Sidecar v0 uses the existing repo shape:

- `sidecar.html`, `sidecar.js`, `sidecar.css`: local web UI.
- `scripts/sidecar_server.py`: localhost helper and JSON endpoints.
- `scripts/sidecar_state_db.py`: Sidecar tables in `assets/owner-actions/Owner.sqlite`.
- `scripts/apple_photos_bridge.swift`: PhotoKit bridge for metadata index scans,
  compatibility library slices, and best-available local previews.
- `scripts/install_sidecar_dock_app.zsh` and `scripts/open_sidecar_main.py`:
  Dock-friendly launcher that starts the helper and opens Safari.
- `scripts/sidecar_maintenance.py`: non-UI scheduled maintenance entrypoints
  for Photos index sync and picked-only AI metadata planning.
- `scripts/install_sidecar_scheduled_tasks.zsh`: optional local LaunchAgent
  fallback for the same maintenance entrypoints; Codex Scheduled is the primary
  scheduler when available.

This keeps the UI fast to prototype, Python responsible for local orchestration
and SQLite, and Swift responsible only for Apple Photos/PhotoKit boundaries.

## Product Boundary

Sidecar owns:

- Whole Apple Photos library indexing and local working-set windows.
- Regular albums and smart albums as review sources.
- Local-first culling: rating, color, pick, unpick, reject, hide.
- Title/keyword editing and AI proposal review state.
- Pending Photos write-back plans.
- Next-upload eligibility plans.
- Persistent current-window culling, one-row-per-picked-item metadata review, and
  explicit wastebasket tombstoning.
- Compact star/color filter controls with group-level All/None toggles and
  star/color checkbox pills for culling-speed scans.
- Local-index search across filenames, Apple Photos titles/keywords, local
  decision metadata, seed keywords, and coarse location labels.

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

Sidecar now treats `sidecar_assets` in `assets/owner-actions/Owner.sqlite` as
the local Photos metadata index. A metadata-only refresh walks PhotoKit once,
writes JSONL, imports batches into SQLite, reports scan/import progress, and
does not ask Photos for previews, originals, video resources, or iCloud
downloads. Current-window load/refill reads this local index first; the older
PhotoKit offset slice path remains only as a cold-start fallback when the local
index is empty. Date bounds and index-start jumps are not exposed in Sidecar.
Normal culling loads, refills, and moves between persisted working-set windows
from the local index.

Core states:

- `undecided`
- `picked`
- `rejected`
- `hidden`
- `metadata proposed`
- `metadata approved`
- `metadata rework`
- `ready for Upload Bridge`

Upload eligibility is local and immediate:

```text
picked
AND metadata approved
AND not rejected
AND not hidden
AND not already current in Owner publication state
```

Sidecar's Upload Bridge is the handoff boundary for picked, metadata-approved
items. The current bridge queue is still backed by the compatibility
`sidecar_mock_uploads` table, but user-facing workflow language treats these
rows as bridge-queued, not uploaded.

The bridge derives the Owner-style photo id from the stable source anchor,
computes the expected private master and public preview R2 keys, then checks
Owner's current `r2_objects` state for exact bucket/key coverage. A bridge
collision warning means the planned key already exists in current R2 state; it
is not a perceptual duplicate detector for visually similar files with different
source anchors. Bridge-queued items are treated as having crossed the Owner
handoff boundary and are hidden from active Culling and Review surfaces.

Bridge execution now has a durable local run ledger:

- `sidecar_upload_bridge_runs` records each bridge dry run, status, spool path,
  summary, and whether upload execution was requested.
- `sidecar_upload_bridge_run_items` records the queued asset, derived Owner
  photo id, planned R2 keys, export status, exported file path, byte count, and
  failure reason when Photos cannot materialize the item. It also records
  per-key R2 upload results for live bridge executions.

The current execution slice can materialize one queued item from Apple Photos
into `assets/owner-actions/sidecar-upload-runs/<run-id>/export/`. Without
`--execute`, this is export-only and performs no R2 writes. With
`--execute --limit 1`, Sidecar uploads the private master to
`photosbyelie-private/masters/<photo-id>.<ext>` and uploads the watermarked
public preview pair to `photosbyelie-public/expo/`. Planned key collisions are
skipped by default unless `--allow-r2-overwrite` is passed. Owner catalog
registration is still a separate downstream slice.

Upload Bridge does not generate private JPG render triplets. Private renders are
an on-demand Worker cache: checkout/delivery can lazily create
`renders/<media_id>_1mp.jpg`, `renders/<media_id>_3mp.jpg`, and
`renders/<media_id>_6mp.jpg` from the private master, then leave those cached
objects in R2.

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
  `P` picks, `X` rejects, `H` hides, `U` unpicks, arrows select, Up/Down move
  by the rendered row stride on the culling grid, and Shift-arrows extend
  selection. Click, Command-click, and Shift-click support single, toggle, and
  range selection.
  The **Refill window** action preserves the current working-set start and
  filters while scanning forward through later local-index rows to fill depleted
  visible space after bridge queueing, rejects, tombstones, or active filters
  remove rows from the working view. Refill reports each local scan chunk and
  cumulative progress. Photos index sync and AI metadata planning are not
  Sidecar UI actions; they run through Codex Scheduled tasks backed by
  scheduler-facing maintenance entrypoints.
  Actions update local SQLite and advance without blocking on Photos. The
  **Cull bursts** action applies the conservative one-second burst pass to the
  visible current-window photos, skips picked/videos/already rejected items, and
  stages reject decisions for non-survivor frames. Culling stays full-width and
  grid-first; the former persistent Decision side panel is intentionally removed
  in favor of Space-bar Quick Look and the dedicated Review page. Quick Look
  remains an active culling mode: rating, color, pick/reject/hide/unpick, and
  arrow navigation shortcuts keep acting on the selected item while the preview
  stays open and follows the active selection. Quick Look also repeats the
  active item status with explicit stars, color, decision, metadata, and pending
  Photos write-back reminders. Quick decisions patch affected items in place so
  thumbnails do not blink, and single-item auto-advance follows the most recent
  arrow travel direction. Cull and Review selection is tracked by stable Apple
  Photos asset IDs across local refresh/refill/decision writes, so background
  work preserves the intended item set when those assets remain visible. Bulk
  Pick, rating, color, and metadata decisions keep the visible multi-selection
  alive so another bulk action can be applied without reselecting. `Cmd-Z`
  provides session-local multilevel undo for staged local decision operations
  while leaving native text-field undo alone in title/keyword fields.
- **Review:** Owner-style title/keyword review of picked current-window items
  only, rendered oldest-to-newest so propagation moves forward through a shoot.
  Each row shows a taller contained preview, current state, title/keyword fields,
  approve, reject, AI rework, pick, and unpick actions. Approve saves the
  visible title and keywords as approved metadata; picked assets do not enter
  the Upload Bridge until this page marks their metadata approved. The
  Upload Bridge rail loads by default with the current window, stays visible even
  when empty, and refreshes after local decision changes such as approval or
  undo. The title and keyword field arrows propagate that single field to the
  current and following picked rows inside the same two-hour capture window,
  then approve those rows locally.
  Unedited rows seed those fields from existing Apple Photos title/keywords
  when PhotoKit exposes them. If GPS maps to a known place and the Photos title
  is blank, Review seeds a compact fallback title such as `2026 Paris` and adds
  human place labels to the keyword seed without exposing exact coordinates.
  When Photos exposes a useful title but not the keyword list, Sidecar derives
  starter keywords from comma/section-separated title parts.
  The toolbar **AI title pass** action runs the same safe picked-only proposal
  writer in the foreground for visible Review rows; the scheduled picked-only AI
  task remains the non-UI nightly path. The row **Propagate** action carries the
  review decision itself: metadata approval or additive AI rework
  category/comment guidance. AI rework categories match Owner review: incorrect,
  too generic, placeholder, use keywords, add details, use shoot, and other.
  They are checkboxes, not radio buttons; their default notes combine with any
  manual note. Staged Sidecar keywords are filtered through
  Owner's keyword blacklist before they become local decisions. Sidecar reads
  the SQLite table first and falls back to the JSON compatibility export when
  the table is missing or empty.

Videos are first-class Sidecar review items. The UI marks video previews with a
standard play icon and duration chip, filters photos/videos separately, asks
PhotoKit for local poster frames without iCloud downloads, plays local videos in
place when Photos can expose the video resource locally, starts video playback
immediately in Quick Look with a muted fallback when browser autoplay policy
requires it, and supports Space-bar Quick Look previews for the active item.

Source controls should include:

- preview count
- load/refill plus previous/next working-window movement
- album/smart album later
- horizontal rating, color, decision-state, and media-type filters
- search terms later

## Current V0 Slice

The first implemented slice includes:

- `library-index` PhotoKit bridge command for date/limit/offset slices.
- `library-index-file` PhotoKit bridge command for one-pass, metadata-only
  JSONL index refreshes with progress events.
- `preview` PhotoKit bridge command for best-available local JPEG still previews
  and video poster frames with iCloud/network access disabled.
- `video` PhotoKit bridge command for selected-video local playback when the
  underlying video resource is already local.
- Sidecar helper endpoints under `/__sidecar/*`.
- SQLite-backed local Photos metadata index, local decisions, and pending sync
  queue.
- Picked-only AI metadata planning through `/__sidecar/ai-plan`, with candidate
  counts for unreviewed, rework, proposed, approved, and blocked picked items.
  The plan also carries explicit vision guidance to consider likely
  AI-generated images and photos of 3D printed artefacts, adding those keyword
  families only when visual evidence supports them.
  Location keywords stay city-level for private or ambiguous places; street,
  building, and neighborhood precision is reserved for supported public places
  such as museums, landmarks, parks, stations, galleries, or venues.
- Sync planning through `/__sidecar/sync-status`, reporting index freshness,
  picked-only AI pressure, pending Photos write-back, and upload readiness.
- Non-UI scheduler entrypoints: `sidecar_maintenance.py photos-index-sync` and
  `sidecar_maintenance.py picked-ai-plan`. These are run by separate Codex
  Scheduled tasks so Photos metadata sync and picked-only AI planning can keep
  different schedules. The optional LaunchAgent installer remains only as a
  local fallback.
- Sidecar web UI for automatically loading the persistent current window,
  moving the window forward/back, refilling depleted space from the local index,
  filtering by rating/color/decision state, staging cull decisions,
  applying current-window burst culling,
  reviewing picked-item metadata in oldest-to-newest row form with field and
  decision propagation, AI rework categories, previewing the active item with Space,
  tombstoning the wastebasket explicitly, viewing upload eligibility as a
  right-side thumbnail rail, queueing that plan into Upload Bridge with Owner R2
  key collision warnings, hiding bridge-queued items from active Culling/Review
  surfaces, and viewing the pending Photos commit plan.
- Dock launcher script for `PhotosByElie Sidecar.app`.

Remaining near-term slices:

- Actual Photos title/keyword write-back for pending sync records.
- Actual picked-only AI metadata proposal generation beyond queue planning.
- Incremental index refresh refinements, such as cheaper change detection and
  richer missing-asset reporting.
- Album/smart-album source filters.
- Upload Bridge Owner registration: take successful bridge upload ledger rows,
  mark the uploaded R2 objects in Owner's state, and publish them through the
  normal catalog build path.
- Private render cache pruning for existing `renders/<media_id>_<size>mp.jpg`
  objects, protecting sold media and leaving future Worker-created renders in
  place.
