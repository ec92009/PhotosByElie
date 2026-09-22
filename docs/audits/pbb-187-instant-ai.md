# PBB-187 — Perform AI; PBB-186 Hidden precedence correction

Review now has one **Perform AI** action. It immediately starts title/keyword/context review for the selected picked photos using all six substantive metadata reasons. The optional detailed instructions field is retained. In an RE fixture subtree, the same activation starts all five visual repairs. The instructions are saved in the version-bound visual request and passed to the image editor.

The action acquires its busy/conflict locks synchronously. Metadata preview authority and the detached worker are scoped to exact selected IDs; other legacy requests remain untouched. The launcher checks current fixture placement and source versions, refuses an unrelated active run, and preserves provider/run receipts. Per-photo results distinguish metadata and visual work. Retry uses the captured fixture, versions and instructions and repeats only incomplete components. Successful results remain proposals for explicit acceptance; this action does not approve, upload or publish a photo.

Removed the reason selectors, standalone metadata/visual run controls, requested-AI counter, deferred instructions and nightly scheduling control. The app no longer starts a schedule task, including when an older installation had enabled its preference. Internal request records remain available for compatibility and recovery. Proposal filtering, editing, acceptance, and Before / After remain.

Hidden precedence: Review excludes hidden fixture photos whenever Hidden is unchecked, including under Uploaded. This exclusion is applied before counts/pagination and in optimistic membership. Gallery semantics are unchanged.

Validation before packaging:
- 111 native Review/Backstage integration tests passed, including single/multi-photo, RE/non-RE, inherited scope, immediate duplicate suppression, all reasons, exact selected IDs and partial metadata/visual retry.
- 63 Python fixture tests, 17 Photos job/launcher tests and 13 visual-generation tests passed. Coverage includes Hidden precedence, preserving unrelated legacy requests, source changes, instruction delivery and immutable originals.
- 71 of 72 native UI source checks passed. The remaining Uploads help-text assertion already fails on unchanged release commit 4264461b; no Uploads code was changed. Three other stale baseline assertions were updated to current Review UI where this change required them.
- Tests use synthetic fixtures/providers. No real-photo AI generation, approval, upload or publication was triggered during implementation.

Installed version and visible behavior will be recorded after signing.
