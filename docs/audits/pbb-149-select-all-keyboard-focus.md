# PBB-149 — Select All must transfer keyboard focus

The application-level Command-A monitor selects loaded Gallery photos even when the Sidebar owns first-responder focus. Gallery H/P/U handlers belong to the grid, so the next H was ignored until the user clicked the grid. The user confirmed that focusing first makes Hide work.

Each Gallery Select All now publishes a fresh focus request, including when all items were already selected. The Gallery binds SwiftUI focus to its scroll viewport and fulfills that request. Open Quick Look retains its own keyboard routing; existing text-editor Command-A behavior remains unchanged.

Verification: all 89 Backstage fixture integration tests pass. A new executable regression selects all 35 synthetic photos twice, verifies each focus request, applies H through the model, and confirms one audited writer call hides all 35. The UI composition check verifies the request-to-grid focus binding and Quick Look guard. Composition checks: 72/73; the pre-existing unrelated Uploads help-copy assertion remains. No real photo decisions are used as test data.

Installed v265.5 / build 350 from clean source d0196a933d240ef2ef646a05b99a515106be2c64. Signed-runtime isolated 900/1800px preview smoke and deep strict signature verification passed. The prior installed build showed the user's successful 35-photo Hide (Affected 35 / skipped 0 / failed 0) after manually focusing the grid, independently confirming the selection/writer were intact. No production decisions were made by the agent.

Installed v265.5 / build350, source d0196a933d240ef2ef646a05b99a515106be2c64. 89/89 integration tests pass, including repeated focus requests and Hide of all 35 synthetic assets in one writer operation. Composition 72/73 (existing unrelated Uploads help-copy failure). Signed-runtime smoke and installed signature verification pass. Live Gallery reloaded with unchanged post-user-Hide totals (0 undecided, 3354 picked, 21191 hidden). Final live keyboard focus check could not finish: accessibility target invalidated, then window unavailable. Computer use released; no agent photo decisions. Marking Fixed pending live keyboard acceptance.
