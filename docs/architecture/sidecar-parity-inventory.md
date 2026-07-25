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
| Photo/video preview | Sidecar preview bridge | Culling native preview/Quick Look | Photos Bridge only where PhotoKit/TCC export is required | Space opens photo or video preview; navigation stays inside the pool; no browser window opens |
| Burst review and filters | Sidecar JavaScript + local index | Culling | `Owner.sqlite` index | Search, paging/refill, rating/color/decision/media filters, burst grouping, and picked-only review preserve scope |
| Editorial metadata | `Owner.sqlite` accepted/applied metadata state | Metadata | Worker action + Max connector | Title, caption, keywords, approve/reject/rework/comment, blacklist filtering, propagation, and AI proposal review work natively |
| Apple Photos metadata give-back | Worker action + Max connector | Metadata progress and receipt UI | Headless Photos Bridge with stable TCC identity | Backstage shows per-item planned/written/verified/failed receipts; no raw Swift or bare executable path exists |
| Recoverable reject lifecycle | `Owner.sqlite` media lifecycle | Waste Basket | Worker action + local wake/connector | Review, multi-select, restore, discard, empty, and undo respect recoverable/destructive confirmation rules |
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
- Retirement deletes launchers and obsolete services only after the same
  fixture pool passes the native rehearsal from snapshot through delivery.

## Evidence required to close the epic

1. Automated unit/contract tests cover every native service and the
   native-only entry-point gate.
2. A fixture-scoped rehearsal includes a representative photo and video.
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
