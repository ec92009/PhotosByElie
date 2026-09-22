# PBB-186 — Review approval and upload stages

The Review checkbox `Approved · awaiting upload` selects picked, approved photos whose current available source version has no completed upload receipt. `Uploaded` selects completed uploads of the current version. Selecting both includes both groups, without duplicates. Picked and Hidden retain their existing meanings; Gallery is unchanged.

This supersedes the Approved portion of Review's historical inclusive filter contract in PBB-175. Completed upload does not establish public website publication.

Native SQLite and the Python reference query compare `asset_delivery_state.source_version_hash` with the latest available `asset_source_versions.version_id`. A receipt for an older original does not hide a newer approved After; Review presents it as needing upload. Native copied databases predating the source-version table retain their legacy delivery-state behavior. Optimistic Review membership uses the same pending/completed distinction.

Validation:
- 24 native OwnerReviewSQLiteStore tests passed, including disjoint stages, combined pagination, read-only queries, and the old-receipt/new-edit/new-receipt transition.
- 86 Backstage fixture integration tests passed, including Review optimistic actions and refresh behavior.
- 63 Python fixture pipeline tests passed, including equivalent source-version transitions and existing fixture-scoped Gallery/Review coverage.
- Live read-only diagnostic on 2026-09-22: all 156 picked RE Marketing photos had a completed receipt for their current version. The pending filter is therefore expected to be empty. Uploaded also retains the prior behavior of including hidden photos with completed receipts.

Installed signed personal build: **v265.0, build 345**, source `2d8f769197bba5aab0844420eb6f27f7b641679a`. Build-source verification, isolated packaged-runtime smoke and strict signature verification passed.

Installed UI verification on 2026-09-22:
- Picked + Approved awaiting upload: **0** matching, with the new empty-state explanation.
- Add Uploaded: **189** matching: 156 approved and 33 previously hidden uploaded photos. Both edited photos, D5H_2967 and D5H_2970, show Full-resolution Uploaded and retain Before / After comparison.
- Remove Uploaded: **0** matching. Left the app on the requested pending view.
- A digest covering all 189 fixture decisions, editorial states, delivery states, receipt versions and current source versions remained identical before and after installed checks (`22021de1f723a93130eddebccdcb7e273e31028eb156c5ab145d4368a45f4b7b`).
- Prior build 344 retained locally for rollback. App Quit automation was unreliable; the exact verified app process was terminated before replacing its bundle.

 No photo decisions, files, upload receipts, or publication state were changed for this task.

## Hidden precedence correction — 2026-09-22

The user explicitly rejected the former Uploaded-includes-hidden behavior. Build **346 / v265.1** supersedes that part of the verification above: Hidden unchecked excludes all fixture-hidden photos regardless of Uploaded. Native/Python predicates and optimistic membership now enforce the exclusion before counts and pagination. Installed checks return 156 with Hidden off, 189 with Hidden on, then 156 when off again. See [PBB-187 installed proof](pbb-187-instant-ai.md).

## Approved precedence and direct AI approval — 2026-09-22

The user's next correction supersedes the remaining Uploaded override: Approved unchecked excludes all editorially approved photos even when Uploaded is checked. The label is now Approved. With Approved enabled and Uploaded disabled, only pending uploads qualify; enabling both includes current-version uploads too. Hidden exclusion remains independent and applies before counts and pagination. Native SQLite, Python and optimistic membership agree.

The user also requested simpler AI approval in this same build. Approve (including keyboard/Quick Look) now selects a pending ready After through the existing immutable-original, hash-verified, source-version-checked upscaling pipeline. Every selected pending After is checked before approval starts. Missing/incomplete generation never silently approves the original. Metadata-only/original approval retains the existing route. Reject AI replaces Perform AI while results are pending: it rejects the visual draft and withdraws pending metadata with the audited empty-request action, retaining stored metadata, originals and upload receipts. Approval and rejection do not upload. Removed the separate Use After for Uploads button.

Validation: 125 Swift tests in the Review integration, SQLite and external-edit suites passed. The direct approval regression exercises rendered After selection and original dimensions, rejection without a new rendition, missing image, and no recorded draft. 63 Python fixture tests passed. UI composition checks: 71/72 pass; the pre-existing Uploads help-copy assertion still fails (unchanged Uploads code). All provider/image inputs in automated approval tests are synthetic fixtures; no real-photo approval, rejection or generation was performed for verification.
