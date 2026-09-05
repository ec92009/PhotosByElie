# PBB-173 — Independent visual and metadata requests

Review enables Needs AI when either visual reasons or title/keyword reasons/note exist. Clearing the last reason disables it; changing or clearing selection reloads the exact focused item and clears stale visual drafts. Multi-selection sends both explicitly selected scopes in one atomic Review operation.

Visual requests are stored in `asset_editorial_state.visual_ai_request_json`, with validated reasons, source-version identity, request time and `awaiting-generator` status. The existing title/keyword fields and worker eligibility remain separate. Visual-only requests preserve existing metadata proposals and do not enqueue metadata work. Combined requests retain both scopes. A visual request removes an existing approval so the asset remains in Review; upload receipts and source media remain intact. Explicit Approve or Hide retires the visual request. Native and Python snapshots include the field for atomic Undo. Read-only readers tolerate databases created before the new field; mutation adds it transactionally.

Review rows distinguish Visual AI requested from Visual + title/keyword AI requested. The summary identifies its title/keyword worker count. Saved visual requests state that they await a configured generator. No generation is claimed or performed. A request tied to an old source version does not hydrate the current source's visual reason controls.

Validation uses synthetic/copied SQLite data for visual-only and combined multi-asset requests, exact reason persistence after reopening, proposal preservation, metadata-worker exclusion, stale source versions and Undo. View-model tests exercise enablement, clearing the last reason, combined reasons, changing focus and clearing selection. Existing metadata-only tests remain intact. Installed control verification is recorded separately; no real request or image generation is needed.

Maintainability keeps visual SQL/schema handling in bounded helpers and the visual presentation extension with the visual domain. Narrow legacy ceilings cover the added DTO field, transport parameter, receipt projection and UI wiring; no unrelated ceilings are increased.

The full Node/Python run passes 328 Node and 520 Python tests; the final fixture rerun passes 58. A 404-test native run passed before the final focus-change assertion. The final full native run passed the request-scope checks but hit the existing five-second 2,000-thumbnail backfill deadline under heavy machine load (1,570 thumbnails completed); its unchanged isolated rerun is recorded below. No timeout or assertion was weakened.

The unchanged thumbnail test passed in isolation (6.679 seconds). Final validation therefore covers all 404 native tests, with the timing failure and isolated pass retained; 328 Node, 520 Python and the final 58-test fixture run pass. Maintainability and whitespace checks pass.

## Installed verification

Signed v250.5/build 329 from `1ca93f0e9be729c60f09aa8cf885db0934b984eb` is installed and launched. Strict signature, Owner authentication and Photos access pass; build 328 is retained as rollback. In RE Review, selecting Contrast alone enabled Needs AI; clearing it disabled the action. Visual + Incorrect title enabled it; clearing only the visual reason left metadata-only enabled; clearing the metadata reason disabled it again. No Needs AI submission or generator action was clicked. Original Picked-only filtering was restored and the app returned to Uploads. Build-time isolated 900/1800px preview smoke passed. The local update archive was not published.
