# PBB-186 — Review approval and upload stages

The Review checkbox `Approved · awaiting upload` selects picked, approved photos whose current available source version has no completed upload receipt. `Uploaded` selects completed uploads of the current version. Selecting both includes both groups, without duplicates. Picked and Hidden retain their existing meanings; Gallery is unchanged.

This supersedes the Approved portion of Review's historical inclusive filter contract in PBB-175. Completed upload does not establish public website publication.

Native SQLite and the Python reference query compare `asset_delivery_state.source_version_hash` with the latest available `asset_source_versions.version_id`. A receipt for an older original does not hide a newer approved After; Review presents it as needing upload. Native copied databases predating the source-version table retain their legacy delivery-state behavior. Optimistic Review membership uses the same pending/completed distinction.

Validation:
- 24 native OwnerReviewSQLiteStore tests passed, including disjoint stages, combined pagination, read-only queries, and the old-receipt/new-edit/new-receipt transition.
- 86 Backstage fixture integration tests passed, including Review optimistic actions and refresh behavior.
- 63 Python fixture pipeline tests passed, including equivalent source-version transitions and existing fixture-scoped Gallery/Review coverage.
- Live read-only diagnostic on 2026-09-22: all 156 picked RE Marketing photos had a completed receipt for their current version. The pending filter is therefore expected to be empty; Uploaded should show 156.

Target signed personal build: v265.0, build 345. Installed verification to be recorded after packaging. No photo decisions, files, upload receipts, or publication state were changed for this task.
