# PBE-164: Gallery idle-thumbnail working set

Status: source and synthetic verification only, 2026-08-27. Separate signed
promotion, installation and live Gallery acceptance are still required.

## Contract

- The roughly 40–50 actually visible cards get ordinary 180px Photos previews
  first. On macOS 15+, viewport visibility drives work, not LazyVGrid allocation.
- After scrolling stops, at most four visible cards at a time request 900px
  upgrades. Each card is attempted once per idle/visibility interval; a completed
  upgrade is not repeatedly requested. Failed upgrades keep the ordinary image.
- Resuming scrolling cancels upgrades and the idle backfill. Late cancelled
  completions cannot replace images. Offscreen cards release the larger image
  and retain their ordinary thumbnail. Gallery exit and termination cancel all
  Gallery preview work; no new preview work starts after termination is requested.
- A utility-priority idle pass replenishes a bounded set of up to 2,000 ordinary
  thumbnails, with visible/window assets ahead of the already-loaded APL items.
  It does not fetch a new Photos inventory or export originals. Existing cache
  entries and failures are skipped. Explicit Retry remains available for failures.
- The cache retains up to 2,000 entries with least-recently-used offscreen
  eviction. Visible cards are protected. Quick Look recovery is reduced to a
  180px aspect-correct image before entering this cache, not retained at 4000px.
- The four backfill slots reuse the normal thumbnail task, timeout, cancellation
  and retry path. Stalled requests cannot occupy these slots indefinitely.
- The 2,000 limit bounds the combined current-window/loaded-APL working set. It
  does not mean 2,000 full-size photos or an unbounded whole-library prefetch.

## Evidence and regression coverage

The original candidate's completion handler repeated the first four visible
upgrades. An existing two-photo idle test observed four requests instead of two;
a 50-card test demonstrated starvation. The original 300-entry cache evicted
ordinary thumbnails during the 2,000-item pass, including a visible thumbnail.
Both failures were reproduced before correcting the implementation.

The existing Swift package includes `BackstageUI`; tests are runnable with
`swift test --package-path native/PhotosByElieBackstage`. Earlier reports that
tests were blocked by a missing module described the Xcode test-target path,
not this supported package path.

Synthetic coverage includes 50 visible cards visited exactly once, four concurrent
upgrades, cancellation and late completion, offscreen downgrade, 2,000 cached
180px thumbnails, foreground-safe eviction, idle backfill cancellation/resume,
Gallery exit, timeout/Retry, and bounded Quick Look recovery. Tests use fake
Photos services; they do not prove live PhotoKit timing or installed UI behavior.

Final verification: all 259 tests across 20 suites pass with
`swift test --package-path native/PhotosByElieBackstage --skip-build --no-parallel`.
The concurrent run passed the thumbnail regressions but exceeded an existing
200ms wall-clock assertion in `BackstagePreviewIPCTests.timeoutReturnsPromptly`
(283ms observed). That unrelated assertion was not weakened. The 2,000-item
regression waits for cached results, not merely request starts.
The unsigned Debug Xcode build also passes, with an arm64-only executable.
No installed app, signing, publication, Photos or Owner data was changed.

The macOS 14 compatibility branch still uses appearance-based visibility and
does not have SwiftUI's macOS 15 scroll-phase/visibility callbacks. Do not claim
the macOS 15+ viewport cancellation contract has been live-validated on macOS 14.

## Next acceptance gate

After separately approved arm64 promotion/install: scroll quickly at minimum
thumbnail size, pause, scroll again during upgrades, and pause on a different
window. Confirm basic thumbnails appear, only current cards sharpen, scrolling
remains responsive, cached cards return promptly, and leaving Gallery stops
preview work. Exercise one stalled card's Retry/Quick Look recovery. Preserve
selection, scroll position, fixture decisions, ratings and colors throughout.
Customer-page handoff and browser Owner retirement retain their separate gates.
