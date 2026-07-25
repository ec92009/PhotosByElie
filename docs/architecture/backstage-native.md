# PhotosByElie Backstage native architecture

## Purpose

PhotosByElie Backstage is the private macOS replacement for browser Owner
mutation surfaces. Public buyer pages and private client pages remain web
applications. The first production writer is Max; future Mac and mobile
clients are readers and action submitters until an explicit authority
migration is rehearsed.

## Modules

- **BackstageApp** — SwiftUI navigation, window lifecycle, commands, status,
  and AppKit adapters for dense grids, Quick Look, keyboard selection, and
  menus. `BackstageSelectionController`, `BackstageQuickLookCoordinator`, and
  `BackstageContextMenuFactory` are the initial adapters; selection range
  semantics live in the independently tested OwnerCore model.
- **OwnerCore** — value types, use cases, API client, authentication session,
  Keychain vault, database gate, PhotoKit service, action/job progress, and
  dependency protocols. It contains no view code.
- **Worker `/api/v1`** — authentication, authorization, D1/R2 access, audit,
  durable action ledger, delivery, and sharing.
- **Max connector** — claims exact opaque actions, validates target and kind,
  owns all private `Owner.sqlite` mutations, and reports terminal results.
- **Photos Bridge** — the existing signed PhotoKit writer for title, keyword,
  and receipt give-back. Backstage may read, select, preview, and export
  through PhotoKit; it does not create a second metadata writer.

## Native media and Photos give-back

`PhotoKitLibraryService` is read/export-only:

- it requests the app's Photos permission, indexes stable local identifiers,
  filename, capture date and media kind;
- it prepares bounded JPEG previews without exporting originals;
- it exports the preferred original resource only after an explicit folder
  choice and returns byte count, UTI and a streamed SHA-256 receipt.

The Metadata screen never calls an Apple Photos mutation API. It creates a
`sidecar-culling-review` action containing the existing
`fixture-photos-writeback-plan` or `fixture-photos-writeback-commit` manifest.
The Worker is the authorization, idempotency and audit gate. Backstage then
posts only the opaque action ID to the allowlisted Max localhost wake endpoint;
if the endpoint is unavailable, the durable connector poller picks up the same
action.

The connector invokes `PhotosByElie Photos Bridge.app` for both the batch
read used by the dry run and the batch write. JavaScript for Automation runs
inside that stable signed app identity. The bridge preserves unrelated
keywords, returns per-item before/after values, and the connector records an
Apple Photos receipt only after a re-read verifies title, caption and managed
keywords. Failed item IDs remain independently retryable; retry submits only
those IDs. No production give-back path invokes the legacy in-process JXA
adapter.

## Authority and data flow

```mermaid
flowchart LR
  UI["BackstageApp"] --> Core["OwnerCore"]
  Core -->|short lived bearer| Worker["Worker API v1"]
  Worker -->|opaque action ID| Connector["Max connector"]
  Connector --> DB[("Owner.sqlite")]
  Connector --> Bridge["Signed Photos Bridge"]
  Worker --> D1[("D1 access and audit")]
  Worker --> R2[("R2 media and delivery")]
  Core -. read, preview, export .-> PhotoKit["PhotoKit"]
```

`Owner.sqlite` is the only local curation authority. Native code opens it
read-only for inspection unless running a named, transactional schema
migration after a verified backup. Normal mutations travel through the Worker
ledger and Max connector; no native screen writes business rows directly.
Native migrations record portable identifiers in GRDB's
`grdb_migrations(identifier)` convention while retaining `PRAGMA user_version`
for compatibility with the existing connector. A migration starts only after
a SQLite backup passes `integrity_check`; schema, migration history and version
advance in one `BEGIN IMMEDIATE` transaction and roll back together on error.

## Authentication and secrets

- Human enrollment starts from a current Owner session.
- A device credential is returned once and stored in Keychain.
- OwnerCore exchanges it for a 15-minute bearer token and rotating 30-day
  refresh token.
- Refresh tokens and connector credentials are different security classes.
- Sign-out deletes the local Keychain items and revokes the refresh token.
- Device revocation is independent and invalidates its indexed refresh tokens.
- Cookies, OAuth secrets, connector credentials, and permanent R2 credentials
  are never embedded in the app.

## Threat model

| Threat | Control |
| --- | --- |
| A compromised web view or browser sends a raw SQLite operation | Local wake accepts only an opaque action ID; connector claims and validates it through the Worker |
| A stolen device token remains useful | Short-lived access token, rotating refresh token, per-device revocation, Keychain storage |
| A connector acts for another Mac | Target and claim ownership are checked on every exact action |
| A crash partially mutates private state | Connector and migration writes use transactions; action is completed only after receipts are durable |
| A retry duplicates work | Mutation idempotency keys and durable action IDs |
| A PhotoKit failure silently loses give-back | Dry-run, explicit commit, per-item verified/failed receipts, partial retry |
| A native release breaks public delivery | Public/client sites remain independent; parity rehearsal and rollback precede web Owner retirement |

## Application lifecycle

1. Launch and load non-secret preferences.
2. Read Keychain identity; refresh or request enrollment.
3. Check Worker health and Max connector status.
4. Open `Owner.sqlite` read-only and show its schema/version.
5. Resume non-terminal actions/jobs without resubmission.
6. On backgrounding, cancel UI-only tasks but keep durable action IDs.
7. On sign-out, revoke refresh state, clear Keychain, close the database, and
   discard cached private previews.

## Extension seams

- `OwnerAPITransport` allows URLSession now and test/offline transports.
- `OwnerDatabaseReading` keeps UI use cases independent of SQLite details.
- `PhotoLibraryServing` isolates PhotoKit authorization and export.
- `OwnerActionServing` and `OwnerActionRunner` allow future Macs and mobile devices to submit
  actions without becoming writers.
- Server-declared capabilities hide unsupported workflows on non-authoritative
  devices.

Multi-Mac writer election, mobile Owner UI, and browser Owner retirement are
deliberately not implemented by this architecture.
