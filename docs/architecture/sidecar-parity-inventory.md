# Native Backstage retirement contract

> PBB-92 update: the separately signed Photos Bridge described in this
> historical PBB-19 contract is retired. Backstage is now the sole signed
> PhotoKit/TCC process and exposes the same narrow operations through
> authenticated in-process IPC. No normal compile, install, launch, repair,
> update, rollback, connector, or health path may recreate the Bridge.

This is the acceptance contract for PBB-19. It replaces the earlier rule that a
fixture-scoped workflow should open the browser Sidecar. The target is one
visible operator application:

- **PhotosByElie Backstage** is the only operator UI.
- **Backstage** owns the stable Photos/TCC identity and narrow PhotoKit IPC
  surface; there is no separately installed Bridge helper.
- **Owner.sqlite**, the Worker action ledger, R2, and the catalog remain the
  authoritative durable stores described below.
- The browser Sidecar and legacy Owner writer surfaces remain available only as
  a compatibility rollback until the native rehearsal and soak gates pass.

No ticket may call a capability complete merely because the browser Sidecar can
still perform it.

## Authority and boundary matrix

| Capability | Current authority | Native Backstage destination | Retained backend/helper | Cutover acceptance |
| --- | --- | --- | --- | --- |
| Authentication and device enrollment | Worker + revocable device credential | Backstage session and re-enrollment UI | Signed-in browser may mint the one-time enrollment code | Cold launch restores the Keychain credential; expiry renews without losing the workspace |
| Fixture tree and placement ledger | Worker-authorized actions applied to `Owner.sqlite` | Fixtures | Max connector + `Owner.sqlite` | Create, rename, move, archive/reopen, place, remove, and restore work without Safari |
| Immutable fixture snapshot | `Owner.sqlite` fixture pool | Fixtures opens the exact pool directly in Culling | `Owner.sqlite` | Snapshot order and membership are unchanged; no localhost/Safari link is shown |
| Indexed Photos scope | PhotoKit read access | Culling | PhotoKit | Global and fixture-pool scopes are explicit; an out-of-pool asset cannot appear in pool scope |
| Selection and navigation | Sidecar JavaScript | Culling | None | Click, Command-click, Shift-click, arrows, Shift-arrows, select all/none, and visible selection count work natively |
| Culling decisions | `Owner.sqlite` decision ledger | Culling | Worker authorization + Max connector | Rating 0-5, five colors, pick/unpick, reject, hide, restore, and session undo are audited and immediately reflected |
| Still-photo preview | Sidecar preview bridge | Culling native preview/Quick Look | Backstage authenticated PhotoKit IPC | Space opens a still-photo preview; source video assets are rejected before candidate, snapshot, and review workflows; generated Real Estate videos are handled only by Delivery; no browser window opens |
| Burst review and filters | Sidecar JavaScript + local index | Culling | `Owner.sqlite` index | Search, paging/refill, rating/color/decision filters, burst grouping, and picked-only review preserve scope; source media is fixed to still photos |
| Editorial metadata | `Owner.sqlite` accepted/applied metadata state | Native Backstage Review for title/keyword proposals; Metadata for direct edits, blacklist, ladder, and give-back | Native Review transaction plus Worker action + Max connector for external writes | Review is Backstage's sole proposal surface with Approve and Needs AI; Metadata retains direct title/caption/keyword editing, blacklist filtering, ladder configuration, and give-back |
| Apple Photos metadata give-back | Worker action + Max connector | Metadata progress and receipt UI | Backstage authenticated PhotoKit IPC with stable TCC identity | Backstage shows per-item planned/written/verified/failed receipts; no raw Swift or bare executable path exists |
| Recoverable reject lifecycle | `Owner.sqlite` Waste Basket gateway, provenance, operations, and receipts | Waste Basket | Worker action + local wake/connector | Culling/Review/Owner-gallery X is recoverable; restore is exact; only confirmed Empty activates a tombstone; explicit tombstone restore is separate |
| Upload plan and execution | Upload Bridge state in `Owner.sqlite` | Uploads | R2 + Max connector + Backstage PhotoKit IPC | Fixture-scoped materialize, checksum upload, placement, Photos give-back, progress, stop, resume, retry, and verified-run adoption work natively |
| Delivery assembly | Worker-authorized fixture delivery | Delivery | Cloud renderer, R2, catalog | Exact selected assets produce the requested PDF/video with progress and retryable failures |
| Publication | Explicit fixture publication gate | Publication | Worker, R2, catalog | Preview is read-only; publish is separately confirmed and produces an auditable catalog result |
| Activity and diagnostics | Worker action ledger + connector timings | Activity | Worker + Max connector | Queued, locally awakened, claimed, executed, and completed stages are visible without exposing credentials |
| Legacy browser operator UI | Sidecar and Owner writer pages | Deliberate retirement | Compatibility rollback only during rehearsal/soak | No visible launcher or production workflow points to Sidecar; obsolete local routes/services are removed after soak |

## Retired Photos Bridge contract

Photos Bridge is no longer a second application or helper process. Its former
separate bundle identity is retired; Backstage owns the stable Photos access
identity and authenticated PhotoKit IPC surface.

The replacement boundary:

1. runs inside the signed Backstage application;
2. accepts only narrow, validated authenticated requests;
3. never accepts raw moderation operations as an authority source;
4. cannot be launched independently;
5. returns per-item receipts to the durable action/lifecycle ledger; and
6. is versioned, updated, and rolled back only as part of Backstage.

Any live `PhotosByElie Photos Bridge.app`, `.previous`, or `.rollback` root
is a legacy artifact. Backstage cold launch moves it into the recoverable
retired-artifact archive and never recreates it.

## Rollback contract

Cutover is reversible until PBB-27 rehearsal and the PBB-28 soak window both
pass.

- The native-only switch controls entry points, not durable data formats.
- Existing Sidecar data and action kinds may remain readable during the
  compatibility window.
- Rolling back must not copy or fork `Owner.sqlite`, catalog, R2, or Worker
  state.
- A failed native operation may fall back to connector polling, but must not
  silently open a browser UI.
- During rehearsal only, an operator may set
  `PBE_ENABLE_LEGACY_SIDECAR=1` before starting the connector or legacy Dock
  installer. Without that explicit switch the local Sidecar launch route
  returns HTTP 410 and no Owner or fixture page exposes a Sidecar launcher.
- Retirement deletes launchers and obsolete services only after the same
  fixture pool passes the native rehearsal from snapshot through delivery.

## Evidence required to close the epic

1. Automated unit/contract tests cover every native service and the
   native-only entry-point gate.
2. A fixture-scoped rehearsal includes a representative still-photo fixture
   and a generated Real Estate video delivery artifact; source videos do not
   enter the fixture or review pool.
3. Membership and ordering of the immutable pool are compared before and after
   the native run.
4. Reversible culling and metadata actions are applied and undone.
5. An upload/delivery dry run proves progress, stop/recovery, and receipts.
6. Public gallery, buyer, Real Estate, ACS, and client-delivery smoke tests pass.
7. Backstage is the only visible operator app and no active workflow opens
   Safari or `127.0.0.1`.
8. No standalone Photos Bridge process or live app root exists or respawns.
9. The rollback control is exercised once before the soak begins.
10. After the soak, Sidecar launchers, browser entry points, and obsolete local
    services are removed and their absence is tested.

## Native culling parity scenarios

PBB-34 uses executable OwnerCore scenarios rather than visual resemblance as
the culling acceptance gate.

- The **10-item rehearsal** proves ordered scope, search, media/decision/rating/
  color filters, counts, and fixture breadcrumbs without a network dependency.
- The **1,140-item rehearsal** proves deterministic bounded windows, navigation
  at page boundaries, and picked-only Review without constructing every row in
  SwiftUI at once.
- Selection is always evaluated against the visible filtered order. The
  immutable fixture-pool membership and order remain unchanged.
- Search covers title, filename, accepted title, and accepted keywords with
  case- and diacritic-insensitive matching.
- Counts distinguish total scope from matching items and the visible bounded
  window. A filter must never silently widen a fixture pool.
- Backstage remains the sole Photos writer. These pure scenarios neither
  mutate Photos nor create a second decision ledger.
