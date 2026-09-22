# PBB-149 — Select All must transfer keyboard focus

The application-level Command-A monitor selects loaded Gallery photos even when the Sidebar owns first-responder focus. Gallery H/P/U handlers belong to the grid, so the next H was ignored until the user clicked the grid. The user confirmed that focusing first makes Hide work.

Each Gallery Select All now publishes a fresh focus request, including when all items were already selected. The Gallery binds SwiftUI focus to its scroll viewport and fulfills that request. Open Quick Look retains its own keyboard routing; existing text-editor Command-A behavior remains unchanged.

Verification: all 89 Backstage fixture integration tests pass. A new executable regression selects all 35 synthetic photos twice, verifies each focus request, applies H through the model, and confirms one audited writer call hides all 35. The UI composition check verifies the request-to-grid focus binding and Quick Look guard. Composition checks: 72/73; the pre-existing unrelated Uploads help-copy assertion remains. No real photo decisions are used as test data.
