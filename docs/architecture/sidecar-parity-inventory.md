# Sidecar parity gate for fixture-scoped culling

Fixture mode changes candidate scope only. It passes `pool=<stable-pool-id>` to
the existing Sidecar page and applies that pool's immutable asset IDs to the
existing indexed-library query. The page, decision writer, keyboard layer,
preview/export bridge, and upload bridge are shared with global Sidecar.

## Preserved inventory

| Area | Existing capability retained | Evidence |
| --- | --- | --- |
| Navigation | Culling/Review tabs, window size, paging, search | `sidecar.html`, `sidecar.js` |
| Filters | rating, color, pick state, media type, all/none helpers | `sidecar.html` |
| Decisions | 0-5 rating, five colors, pick, unpick, reject, hide, tombstone/restore | `sidecar_state_db.record_decision` |
| Editorial | title, caption, keywords, approve, rework category/comment, AI evidence | shared Sidecar metadata form and decision writer |
| Selection | click, Cmd-click, Shift-click, arrows, Shift-arrows | shared Sidecar event layer |
| Preview | Space/Quick Look for photos and videos, preview progress | shared preview bridge |
| Safety | Cmd-Z undo, wastebasket review, restore, explicit destructive action | shared state/event ledger |
| Delivery | Upload Bridge plan/execute and Photos commit plan | shared bridge endpoints |
| Shortcuts | C, 0-9, P, A, X, H, U, arrows, Space, Cmd-Z | on-page help and shared key handler |

## Automated gate

`scripts/sidecar_parity_test.py` asserts the inventory controls and shortcut
markers remain in the shared page/JavaScript, and
`scripts/sidecar_performance_test.py` proves a fixture pool limits the existing
index window without changing decision semantics. Both a representative photo
and video are included in the scoped performance fixture.

## Manual regression

Before declaring a fixture migration complete:

1. Open global Sidecar and a `?pool=` Sidecar window.
2. Confirm a representative photo and video preview in both.
3. Apply and undo one rating, color, pick, and metadata edit in fixture scope.
4. Confirm the global view immediately reflects the same decisions.
5. Confirm no out-of-pool asset appears in fixture scope.
6. Run a delivery-plan dry run; do not message a client during rehearsal.

Any failed row blocks parity acceptance. A new fixture-specific culling UI is
not an acceptable workaround.
