# PBB-100 — Preserve Gallery preview quality across decisions

On build 348, hiding one photo called the full filter-transition thumbnail cancellation path. That restored cached 180px images, cleared visible asset IDs and cancelled upgrades for every card. SwiftUI retained the surviving cards, so they did not emit another appear event; subsequent idle scrolling had no visible IDs to sharpen.

Ordinary fixture placement and sidecar decisions now invalidate stale database window requests while retaining the unchanged cards' cached sharp images, visibility, request tokens and in-flight preview work. Removed cards still cancel through their disappear lifecycle. Filter/fixture changes and Gallery exit retain full cancellation behavior. Image-version changes retain their explicit invalidation path.

Executable regression: two cases hide one card while another is (a) already sharp or (b) still basic. No second appear event is sent for the surviving card. Before the fix, both cases failed with four preview-retention/sharpening assertions. After the fix, both pass: sharp image identity is preserved, and the basic card upgrades exactly once after scroll idle. All 88 Backstage fixture integration tests pass, including bounded concurrency, cancellation, cache retention, timeout, recovery and filter transitions. Native composition checks are 71/72; the pre-existing unrelated Uploads help-copy assertion remains.

Tests use synthetic preview providers and fixture placement services. No real photo is hidden, restored, approved, uploaded or regenerated for verification.
