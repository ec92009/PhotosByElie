# PBB-112: Python in the Backstage and Owner runtime

Status: architecture decision complete; remaining product-runtime replacements
are split to PBB-106 and PBB-114, 2026-08-21

This record reconciles the 2026-08-20 runtime inventory against the current
isolated v233.3/build134 candidate at `ba093d05` on 2026-08-21. The shared Max
checkout and installed Backstage app were not modified.

## Decision

The target architecture is zero Python process spawn and JSON IPC in the
interactive native Backstage runtime.

Python remains an explicit compatibility and tooling surface, but no Python
process is required to keep Backstage, Owner, or the local connector alive
while idle. The retained exceptions are:

1. action-scoped external connector work that still crosses the Worker,
   Photos, R2, delivery, or publication boundary;
2. the PBB-launched PBE Owner web host for the lifetime of its explicit browser
   session, plus legacy Sidecar/local Owner surfaces when deliberately enabled;
3. batch, migration, repair, test, release, and scheduled tooling.

The exceptions must be launched for one bounded operation or an explicit
operator-selected legacy surface. They must not become a hidden always-on
dependency of native Backstage.

## Current native reachability inventory

| Entry point or boundary | Current reachability | Classification | Decision |
| --- | --- | --- | --- |
| `LocalFixtureReviewService` -> native Owner SQLite stores | Native fixture-tree, Review, and Culling reads; Review Apply/Undo and Culling placement writes | Interactive runtime-critical (Swift) | Keep the direct OwnerCore transaction. It preserves the existing SQLite tables, snapshots, receipts, conflict checks, fixture scope, and timing fields. An unresolved database fails closed; it does not select Python, HTTP, or the generic action runner. Fixture selection must not wait on a cloud action or connector wake. |
| `MetadataReviewService` -> `MetadataModelLadderSQLiteStore` | Metadata reads only its saved model ladder from authoritative `Owner.sqlite`; native Backstage Review owns title/keyword proposal review | Interactive runtime-critical read (Swift) | Keep the read-only ladder lookup and fail closed when the database cannot be resolved. Direct metadata edits, blacklist changes, and ladder saves remain separate Worker-authorized Max actions. Historical proposal rows stay retained without a second Metadata review surface in Backstage. |
| `OwnerWorkflowRecoverySQLiteStore` | Backstage bootstrap classifies stale Photos sync and Upload Bridge bookkeeping | Interactive runtime-critical maintenance (Swift) | Keep one short native SQLite transaction. Legacy rows without durable worker identity remain nonterminal and are marked `needs-review`; only a stale row whose recorded worker is verifiably gone becomes interrupted/failed. This policy must not depend on launching the retired Python local host. |
| `OnDemandOwnerActionWaker` -> `scripts/new_owner_connector.py --action-id` | Native Owner action wake for broader Worker actions | External connector compatibility | Retain temporarily as an action-scoped process. Migrate or replace capability-by-capability under PBB-106; do not restore a daemon to support it. |
| `LocalOwnerActionWaker` -> localhost `wake-owner-action` | Former native fallback to the daemon/status server | Legacy/removable daemon coupling | Removed. Native Backstage has no localhost wake client; the action-scoped waker is the only production `OwnerActionWaking` implementation. |
| `OwnerActionRunner` | Fixture mutations plus Photos sync, uploads, delivery, publication, and proposal actions through the Worker action contract | External connector compatibility | Keep the authorization boundary and opaque action IDs for work that crosses it. The implementation may use the action-scoped connector until its individual capability has a verified native or dedicated bridge replacement. The fixture-tree read no longer crosses this boundary. |
| `LocalOwnerConnectorIdentity` | Selects the connector authority attached to new Worker actions | Interactive runtime-critical (Swift) | Use the explicit non-secret authority target (`max` by default). Do not contact a daemon or read the credential-bearing connector config; a future writer migration must inject a rehearsed target. |
| `PBEOwnerHostClient` -> `scripts/local_server.py` | PBB launches one loopback PBE Owner web host after the user presses Open | Interactive compatibility boundary | Retain temporarily for the explicit web session. PBB owns the child, fixture lease, bootstrap secret, and shutdown; closing PBB drains started durable work and terminates the host. It is not a daemon or idle dependency. PBB-114 owns its native replacement. |
| `PhotoLibraryService` and `PhotoMetadataService` | Photos authorization, previews, exports, and approved metadata writes | Interactive runtime-critical (Swift) | Keep in the signed Backstage bundle. There is no separately installed Photos helper and no Python on this path. |
| `new_owner_connector.py` with no bounded flag | LaunchAgent/background polling, local status server, retry/backoff, and action drain | Legacy/removable daemon | Refuse by default before reading connector config. `--once` and `--action-id` remain bounded forms; a deliberate rollback may opt in with `PBE_ENABLE_LEGACY_CONNECTOR_DAEMON=1`. |
| `new_owner_connector.py` -> `sidecar_server.py` | Legacy Sidecar browser launch when `PBE_ENABLE_LEGACY_SIDECAR=1` | Legacy compatibility | Retain only for explicit rollback/rehearsal; native Backstage must not depend on it. |
| `new_owner_connector.py` -> `local_server.py` | Legacy local Owner/Waste Basket/browser helper | Legacy compatibility | Retain only for the legacy web surface until its owner-facing replacement is confirmed; never use it as the native Review/Undo path. |
| `open_sidecar_main.py` -> `sidecar_server.py` | Dock-launched legacy Sidecar | Legacy compatibility | Keep isolated behind its existing explicit enablement; no LaunchAgent requirement. |
| `open_owner_main.py` -> `local_server.py` | Dock-launched legacy local Owner | Legacy compatibility | Refuse before filesystem, process, or browser side effects unless `PBE_ENABLE_LEGACY_BROWSER_OWNER=1` is set for a deliberate rollback rehearsal. Do not make it a native Backstage dependency. |
| `fixture_pipeline.py` | Used by bounded connector, parity, migration, repair, and batch paths; no longer imported by native interactive Review/Culling | Reference and bounded tooling | Keep as a reference contract while parity evidence is collected. It is not a native Backstage runtime dependency and must not be reintroduced as a fallback writer. |
| `sidecar_state_db.py` | Imported by Sidecar, upload bridge, and maintenance paths | Compatibility and scheduled tooling | Retain while those bounded paths remain; do not add new native interactive calls. |
| `owner_state_db.py` | Imported by legacy local Owner and a small set of Node/Python maintenance tools | Compatibility and tooling | Retain until those callers have explicit replacements; it is not a reason for an always-on connector. |
| `sidecar_maintenance.py`, `sidecar_upload_bridge.py`, and `sidecar_upload_bridge_drain.py` | Scheduled or explicitly requested Photos/index/AI/upload work | Bounded tooling | Retain as bounded jobs; schedule only when a documented demand exists. |
| `native_fixture_delivery.py`, `native_fixture_publication.py`, `native_asset_publication.py`, `native_catalog_promotion.py`, and `native_publication_pipeline.py` | Connector-triggered delivery/publication or release/rehearsal operations | External connector and release tooling | Retain until each verified native/Worker replacement is complete. They are not idle daemons. |
| `generate_owner_swift_contract.py` | Contract generation/check at build/validation time | Build tooling | Retain until the generator is replaced; never run from the interactive app. |
| Remaining `scripts/*.py` entry points | Imports, catalog builds, migration, repair, AI passes, exports, tests, or release rehearsal | Batch/tooling | Retain by explicit command ownership. This record does not turn a build or repair script into an app runtime dependency. |

## Evidence for the decision

The remaining direct native Python process launches are:

- `native/PhotosByElieBackstage/Sources/OwnerCore/OwnerActionRunner.swift`:
  it starts `/usr/bin/python3 scripts/new_owner_connector.py --config ...
  --once --action-id ...` for one opaque Worker action and waits for exit; and
- `native/PhotosByElieBackstage/Sources/OwnerCore/OwnerAPIClient.swift`:
  `PBEOwnerHostClient` starts `/usr/bin/python3 scripts/local_server.py ...`
  only after the user opens PBE Owner, and owns that child for the explicit
  browser session.

The former native `LocalOwnerActionWaker` localhost client has been removed.
Although no production caller constructed it, retaining the client kept the
daemon wake endpoint in the native module and obscured the actual action-scoped
runtime boundary. The rollback-only Python daemon may still expose its private
endpoint when explicitly enabled, but native Backstage cannot call it.

`LocalFixtureReviewService` no longer creates a `Process`, opens a local HTTP
endpoint, or encodes a JSON Review request. It calls `OwnerReviewSQLiteStore`
directly for the native interactive path and fails closed when the
Owner-private database cannot be resolved.

`MetadataReviewService` no longer requests the legacy
`localhost:8766/photosbyelie/title-keyword-review-queue` endpoint. Metadata reads
only the saved model ladder through `MetadataModelLadderSQLiteStore`; the store
exposes no write method. Native Backstage Review is Backstage's sole
title/keyword proposal-review surface, while historical proposal rows remain
retained in `Owner.sqlite`.

`scripts/new_owner_connector.py` has two materially different modes:

- `--once --action-id`: claims and executes exactly one Worker action, then
  exits; and
- no bounded flag: starts the local status server and a polling loop, with
  retry/backoff and an interactive lease. This is the daemon mode that caused
  the battery/idle-process concern, and it now refuses to start unless the
  explicit rollback variable `PBE_ENABLE_LEGACY_CONNECTOR_DAEMON=1` is set.

The Swift `OwnerReviewSQLiteStore` and `OwnerCullingSQLiteStore` now own the
interactive transaction, snapshot validation, event recording, and guarded
Undo contract. `scripts/fixture_pipeline.py` remains a bounded connector and
parity/tooling implementation, not a fallback selected by native Backstage.

The fixture picker now reads the hierarchy through `OwnerFixtureSQLiteStore`.
This removes a startup dependency on a queued `fixture-tree-list` action and
prevents slower proposal/status actions from consuming the fixture refresh
deadline. Fixture mutations remain audited Worker actions.

## Timing result

The original Review Hide/Undo reproduction exceeded ten seconds while crossing
the mixed Swift/Python boundary. With the native SQLite path in signed
v233.1/build132, the live Expo fixture completed a five-item Hide in about 1.0
second and exact Undo in about 0.7 seconds, then a 25-item Hide in about 1.0
second and exact Undo in about 0.65 seconds. A user-run single-item Culling and
Review replay also passed. Read-only receipt checks showed exact undone
operations and no net decision drift. No connector or Python process was on the
native Review critical path, so the former unexplained multi-second process/IPC
component is removed; PBB-111 owns the detailed acceptance evidence.

## Migration sequence

1. Define and test the OwnerCore SQLite store protocol for Review/Culling state
   reads, transactional mutations, audit events, receipts, and exact Undo.
2. Add copied-fixture parity tests that compare Swift results with the current
   Python reference across Hide, Approve, Request AI, metadata edits,
   propagation, filter transitions, conflict rejection, and Undo.
3. Move the latency-sensitive Review Apply/Undo path to Swift and remove its
   `Process`/JSON-stdin path. Keep a development-only reference harness, not a
   production fallback that can silently select a second writer. **Completed
   in this slice.**
4. Measure UI click-to-refresh, SQLite transaction, and post-action refresh
   separately. Once the process/IPC component is gone, any remaining delay is
   attributable to SQLite or refresh work instead of an opaque helper launch.
5. Keep broader Worker/Photos/R2/delivery/publication actions action-scoped
   until their own native or dedicated bridge contracts are verified.
6. Keep the Owner LaunchAgent installer and daemon/status-server mode behind
   explicit rollback-only opt-ins. The native path cannot start the daemon
   implicitly. The legacy Sidecar and local Owner launchers remain explicit
   rollback tools only.

## Quit contract

Normal Backstage Quit still drains active Owner, Photos, fixture, delivery,
publication, and settings work before replying to macOS termination. When that
drain would keep the app open, Backstage presents one modal that names every
active operation. The safe default waits and quits; Cancel leaves the app and
its work untouched; Force Quit explicitly bypasses the drain and warns that
in-flight work may require recovery. Repeated Quit requests share the same
pending termination request instead of opening additional prompts.

A confirmed requested-AI proposal pass has an additional safe boundary. Its
worker is already launched in an independent process group and persists its
own proposals and terminal receipt, so **Detach AI Pass and Quit** stops only
Backstage's progress monitor and lets the durable worker continue. Backstage
does not offer detach during the start handshake or for work that has no
independent durable worker.

## Non-negotiable invariants

- `assets/owner-actions/Owner.sqlite` remains the single authoritative local
  workflow state store; no JSON compatibility view becomes authoritative.
- Fixture-local Pick/Hide/Exclude state remains distinct from global editorial,
  approval, delivery, and publication state.
- Every mutation remains idempotent, receipt-backed, conflict-safe, and
  undoable where the current contract promises Undo.
- The native app never receives the connector credential; the Worker/Max
  authorization boundary remains explicit.
- PhotoKit access continues through the signed Backstage app identity.
- No idle LaunchAgent or daemon is required by the chosen architecture.

## Follow-up ownership

The completed decision settles the native Review/Culling boundary, removes its hidden
Python/HTTP fallback, keeps the Metadata model-ladder read off its localhost helper,
removes the connector-status lookup from native identity resolution without
loading connector credentials into Swift, removes the unused native localhost
action-wake client, and makes the unbounded connector daemon fail closed by
default.

Python is not fundamentally required by the finished Backstage/PBE Owner
product runtime. It remains appropriate for bounded batch, migration, repair,
test, and release tooling. The two remaining product-runtime compatibility
boundaries are deliberately split instead of keeping this architecture ticket
open as an unbounded rewrite:

- PBB-106 owns capability-by-capability replacement and live acceptance of the
  action-scoped external connector, including lifecycle, KV attribution, soak,
  rollback, and credential recovery.
- PBB-114 owns replacing the explicit PBE Owner `local_server.py` browser-session
  host with a Backstage-owned native host and proving close/drain/security parity.
- PBB-92 separately retains its final controlled approved metadata-write gate
  for the already completed standalone Photos Bridge retirement.
