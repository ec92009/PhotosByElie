# Native Backstage retirement contract

This is the acceptance contract for PBB-19. It replaces the earlier rule that a
fixture-scoped workflow should open the browser Sidecar. The target is one
visible operator application:

- **PhotosByElie Backstage** is the only operator UI.
- **Photos Bridge** remains a separately signed, permission-bearing macOS
  helper, but is headless and is launched only by Backstage or the connector.
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
| Still-photo preview | Sidecar preview bridge | Culling native preview/Quick Look | Photos Bridge only where PhotoKit/TCC export is required | Space opens a still-photo preview; source video assets are rejected before candidate, snapshot, and review workflows; generated Real Estate videos are handled only by Delivery; no browser window opens |
| Burst review and filters | Sidecar JavaScript + local index | Culling | `Owner.sqlite` index | Search, paging/refill, rating/color/decision filters, burst grouping, and picked-only review preserve scope; source media is fixed to still photos |
| Editorial metadata | `Owner.sqlite` accepted/applied metadata state | Metadata | Worker action + Max connector | Title, caption, keywords, approve/reject/rework/comment, blacklist filtering, propagation, and AI proposal review work natively |
| Apple Photos metadata give-back | Worker action + Max connector | Metadata progress and receipt UI | Headless Photos Bridge with stable TCC identity | Backstage shows per-item planned/written/verified/failed receipts; no raw Swift or bare executable path exists |
| Recoverable reject lifecycle | `Owner.sqlite` Waste Basket gateway, provenance, operations, and receipts | Waste Basket | Worker action + local wake/connector | Culling/Review/Owner-gallery X is recoverable; restore is exact; only confirmed Empty activates a tombstone; explicit tombstone restore is separate |
| Upload plan and execution | Upload Bridge state in `Owner.sqlite` | Uploads | R2 + Max connector + headless Photos Bridge | Fixture-scoped materialize, checksum upload, placement, Photos give-back, progress, stop, resume, retry, and verified-run adoption work natively |
| Delivery assembly | Worker-authorized fixture delivery | Delivery | Cloud renderer, R2, catalog | Exact selected assets produce the requested PDF/video with progress and retryable failures |
| Publication | Explicit fixture publication gate | Publication | Worker, R2, catalog | Preview is read-only; publish is separately confirmed and produces an auditable catalog result |
| Activity and diagnostics | Worker action ledger + connector timings | Activity | Worker + Max connector | Queued, locally awakened, claimed, executed, and completed stages are visible without exposing credentials |
| Legacy browser operator UI | Sidecar and Owner writer pages | Deliberate retirement | Compatibility rollback only during rehearsal/soak | No visible launcher or production workflow points to Sidecar; obsolete local routes/services are removed after soak |

## Photos Bridge contract

Photos Bridge is not a second application in the operator experience. Its
separate bundle identity is retained because macOS binds Photos access and
automation consent to that identity.

The final helper:

1. has no Dock icon, app window, menu workflow, or user-facing launcher;
2. accepts only narrow, validated requests from Backstage/the trusted local
   connector;
3. never accepts raw moderation operations as an authority source;
4. runs only while fulfilling an invocation and exits when idle;
5. returns per-item receipts to the durable action/lifecycle ledger; and
6. is always invoked through LaunchServices as the installed signed app, never
   through raw Swift or a bare executable.

The installed bundle is an `LSUIElement` background helper. It has no Dock
presence, menu bar, or operator window. Its read-only `health` command reports
the stable bundle identity and current Photos authorization; Backstage surfaces
that result on Overview. A permission request can still present a macOS-owned
TCC prompt when access has never been decided, but the helper itself does not
become a visible application.

Local ad-hoc builds embed a stable designated requirement for
`com.photosbyelie.photos-bridge` instead of accepting the default changing
binary cdhash. A Developer ID can replace the local identity through
`PBE_CODESIGN_IDENTITY`; either route keeps the permission-bearing identity
stable across upgrades.

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
8. Photos Bridge has no visible UI and retains its working TCC identity.
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
- Photos Bridge remains the sole Photos writer. These pure scenarios neither
  mutate Photos nor create a second decision ledger.
