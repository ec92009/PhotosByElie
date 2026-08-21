# Native Backstage Review contract

Status: authoritative contract for PBB-44  
Scope: PhotosByElie Backstage Review, Max connector, and `Owner.sqlite`

## Purpose

Review is the fixture-aware editorial gate between culling and delivery. It
must let an owner resolve picked assets without confusing fixture membership
with global editorial state, losing their place in a large queue, or bypassing
the Worker and Max connector audit boundary.

This document defines the state and behavior that PBB-45 through PBB-48 must
preserve. `Owner.sqlite` remains the source of truth. Backstage uses the
transactional OwnerCore SQLite stores for the native Review/Culling slice;
external Worker/Photos/delivery operations remain action-submitted work.

## Queue universe

For a selected, active fixture, the Review universe contains assets that meet
all of these conditions:

1. the asset has an active `picked` placement in that exact fixture;
2. the asset is still present in the local Photos index;
3. the asset is neither globally tombstoned nor in the recoverable Waste
   Basket;
4. the global editorial state is not `approved`.

Fixture membership is exact rather than inherited. A parent and child can both
contain the same asset, but each has its own placement row. Hiding an asset in
one fixture must not hide it in another fixture.

The **Backfill** mode is the complete unresolved universe for the selected
fixture. The **Full queue** mode uses the same fixture universe but includes
approved assets for inspection and correction. Both modes are ordered by
capture time ascending and then stable asset ID ascending. Search narrows the
chosen mode; it does not create a different state model.

## Paging and identity

- A normal page is bounded to 200 items. The connector accepts 1 through 500.
- `offset`, `limit`, `nextOffset`, `hasNext`, and summary counts describe one
  read-only queue snapshot.
- Asset ID is the durable Review identity. PhotoKit local identifier is used
  only for private preview, Quick Look, and explicit export.
- Reloading, searching, or changing page must preserve the focused asset when
  it is still visible. If it left the queue, focus moves to the item at the
  previous index, or the final item when the previous index no longer exists.
- Shift selection extends from the stable anchor. Command selection toggles an
  item. Keyboard movement updates focus and optionally extends from the same
  anchor. Select All is limited to the visible bounded page.

## State ownership and precedence

| State | Scope | Authority |
| --- | --- | --- |
| fixture placement `picked`, `hidden`, `undecided` | fixture-local | `fixture_asset_decisions` |
| fixture eligibility `active`, `dormant` | fixture-local, derived | fixture eligibility recomputation |
| editorial `unreviewed`, `requesting-ai`, `proposed`, `approved` | global asset | `asset_editorial_state` |
| title, caption, keywords, rating, color | global asset | `sidecar_decisions` |
| delivery `not-ready`, `needs-upload`, `uploading`, `live`, `failed` | global asset version | `asset_delivery_state` |
| AI proposal draft and attempt history | global asset | `asset_ai_proposals` and editorial state |

Precedence and invariants:

1. A global tombstone or recoverable Waste Basket entry always removes an
   asset from Review.
2. A fixture-local hide removes the asset only from that fixture's Review
   universe. It resets an outstanding AI request for the asset to
   `unreviewed`, but does not alter another fixture's picked placement.
3. Global approval removes the asset from every fixture Review queue. It sets
   metadata to approved, clears AI request fields, supersedes unresolved AI
   proposals, and moves delivery to `needs-upload`.
4. Request AI with at least one reason sets `requesting-ai` and keeps the
   current fixture placement picked. An empty reason set cancels the request
   and restores `unreviewed`.
5. AI output is draft-only. It cannot replace canonical title or keywords
   until an owner explicitly accepts or edits it.
6. Editing metadata on an approved asset preserves approval and returns the
   asset to `needs-upload`. Editing a proposed draft returns editorial state to
   `unreviewed` and records the proposal decision.

## Actions

Native Review actions handled by OwnerCore execute one audited SQLite
transaction directly against `Owner.sqlite`; they return the same opaque
`operationId` and exact-undo snapshots as the connector contract. The native
path fails closed if the database is unavailable and never falls back to a
Python process or local JSON/HTTP IPC. External actions that cross the Worker,
Photos, delivery, or publication boundary still create a durable Worker action
targeted to Max; Backstage may wake the connector with only the opaque action
ID.

Supported actions are:

- **Approve**: global editorial approval for every selected asset.
- **Hide**: fixture-local placement hide for every selected asset.
- **Request AI**: global AI request state and reasons for every selected asset.
- **Edit metadata**: global title and keyword edits.
- **Propagate title** and **Propagate keywords**: copy the focused asset's
  canonical value to eligible assets in the same shoot window.

Batch actions are all-or-nothing. A missing fixture, asset, or editorial row
must fail the transaction without partially applying the selection.

## Shoot propagation

Propagation is calculated by Max from the focused anchor and current fixture;
the browser or app never supplies an expanded target list as authority.

- The window begins at the anchor capture time and ends two hours later,
  inclusive.
- It uses the same unresolved fixture universe and chronological ordering as
  Review, so it can cross the current 200-item page.
- Main Approve, Hide, or Request AI propagation includes the anchor.
- Title-only and keyword-only propagation begin after the anchor because the
  focused asset is already the source of the copied value.
- A missing anchor timestamp limits the operation to the anchor when the
  action includes it and otherwise yields no propagation targets.

## Requested AI preparation

Request AI is an editorial mark, not an AI execution step. Applying or
propagating the mark updates the requested reasons and note atomically and
returns without opening Photos Bridge or rendering pixels.

The scheduled pass or the explicit **Run AI pass now** action prepares missing
bounded JPEGs at the start of that separate pass. Missing previews are sent
through one signed Backstage `preview-many` IPC request, recorded in Owner
state, and then consumed by proposal generation. Proposal generation remains draft-only;
it cannot approve, hide, publish, or change canonical metadata.

## Audit and undo

Every changed asset records an `asset_editorial_events` row containing the
fixture, action, before state, after state, complete before/after JSON, actor,
and timestamp. Fixture-local placement changes also record a
`fixture_asset_decision_events` row.

Each completed Review mutation also returns an opaque `operationId`. Max stores
the complete before and after snapshots in `fixture_review_operations`; the app
keeps only the opaque ID and its local selection/focus context. An exact undo
must be derived from Max's durable before values, never from the current UI
fields. Max refuses undo if the current state no longer matches the recorded
after snapshot, so an older operation cannot overwrite a later change. Undo
restores, in one transaction:

- the affected fixture placement and eligibility inputs;
- editorial state and AI request fields;
- canonical title and keywords;
- delivery state when the action changed it;
- unresolved AI proposal status when the action superseded or accepted it.

Undo itself is a new audited action and marks the durable operation `undone`.
Repeating the same undo or retrying an already completed Worker action is
idempotent.

## UI continuity

The native Review workspace must expose:

- fixture selection and complete-queue search;
- summary counts and bounded previous/next paging;
- PhotoKit thumbnail rows and private inline preview or Quick Look;
- Shift, Command, keyboard-range, and Select All behavior;
- Approve, fixture-local Hide, Request AI, metadata editing, and propagation;
- visible running, success, and failure status;
- a single exact Undo for the most recent completed Review mutation.

While an action runs, mutation controls are disabled but the queue remains
visible. After success, selection, focus, scroll target, and editable draft are
reconciled against the returned queue. After failure, the prior queue and
selection remain available and no optimistic state becomes authoritative.

## Acceptance evidence

PBB-44 is satisfied when this contract and the existing state tests agree.
PBB-45 through PBB-47 implement the UI and mutation clauses. PBB-48 must prove
the complete contract with automated state, paging, propagation, retry, and
undo tests plus a hands-on read-only or reversible rehearsal on Max.
