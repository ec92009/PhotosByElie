# PBB-132: compact current-fixture chooser

Source and synthetic-render evidence, 2026-08-27; not installed acceptance.

The sidebar's first row is the existing left-aligned hierarchy dropdown with
Refresh beside it. There is no separate `Current fixture` heading or repeated
selected name. The dropdown keeps `Current fixture` as its accessible label and
the full selected breadcrumb as its accessible value. Hierarchical menu items,
stable-ID selection, archive restrictions, persistence and refresh guards are
unchanged. Loading/unavailable messages and session notices remain below it.
The transitional PBE Owner row is unchanged; retirement is separate work.

Verification:

- Three focused source-contract tests pass, covering the compact layout,
  left alignment, accessibility metadata, refresh/selection guards and feedback.
- All 260 native tests across 20 suites pass in the serial Swift package run,
  including existing fixture persistence and selection tests.
- The new `compactFixturePicker` test renders four states (loading, ready,
  long breadcrumb and unavailable), two sidebar widths (230/320 points) and both
  appearances. All 16 offscreen AppKit renders were visually inspected: no
  overlap, and long names truncate within the narrow dropdown. The full
  breadcrumb remains in its accessible value and menu item labels.
- Rendering uses an inert Photos service and isolated preferences, without an
  app window, Owner session, Photos/Owner data changes or selection persistence.

To save render artifacts, set `PBB132_SNAPSHOTS` to an existing private temporary
directory when running `swift test --package-path native/PhotosByElieBackstage
--no-parallel --filter compactFixturePicker`.

Next gate: separately approve arm64 promotion/install, then verify keyboard
operation, VoiceOver label/value and the compact chooser in the running app.
No version bump, signing, install or publication is included in this change.
