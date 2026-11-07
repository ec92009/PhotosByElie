# PBB-owned Apple Photos discovery (PBB-195)

PBB is one independent consumer of Apple Photos, not its exclusive client.
Discovery uses a read-only PhotoKit persistent change token, stored under
`photos.pbb-sync.v1:<connector>` in Owner.sqlite. No Photos item is marked as
globally consumed. Other apps can import, edit, delete or restore items; those
changes remain available to every consumer's independent checkpoint.

Without a usable checkpoint, one complete inventory includes hidden photos,
all burst frames, and every capture date. Supported stills use the existing
source eligibility, RAW recovery and metadata importer. The completion receipt
counts previously unindexed supported identities. Unsupported stills remain
excluded; this is discovery, not automatic picking, approval or publication.

Subsequent passes fetch persistent inserted/updated/deleted identities. Expired
or unreadable history requires another complete inventory. A baseline captures
its token before fetching; deltas use the last enumerated change token. Changes
arriving during a scan therefore replay next time rather than being skipped.

The native reader retains one PHFetchResult per accepted helper job and examines
resources only for its bounded current page. Pagination advances by inspected
identities, including unsupported sources and deletions, never by eligible row
count. Empty filtered pages do not terminate a scan. Completed snapshots are
evicted; abandoned ones expire. Full Photos authorization is required to certify
an inventory or absence. Revoked/limited access cannot advance the cursor.

The private signed helper capability freezes session, checkpoint and query
bounds. Python validates snapshot continuity, reuses the existing metadata
importer, then commits membership, missing-source observations and the new
checkpoint together. A cursor compare prevents a concurrent stale completion.
Failure before completion leaves the previous cursor; imported source batches
may replay idempotently. Opaque tokens remain local rather than appearing in
cloud action receipts.

`pbb_photos_sync_members` records this consumer's exact local/source identities.
A rebuild reconciles previously owned membership, not unrelated libraries or
non-Photos sources. Before this ledger exists, the bounded exact source checks
from PBB-194 still reconcile existing Gallery entries. Source-only upserts and
missing markers preserve fixture decisions, editorial approvals, source-version
history, publication receipts and permanent sold deliveries. Capture date
remains a Gallery filter, never a discovery cursor.

Implementation: `PhotoLibraryChangeReader.swift`, the existing signed Photos IPC,
`scripts/pbb_photos_sync.py` and `sidecar_server.py`. Focused regression coverage:
`pbb_photos_sync_test.py`, `BackstagePhotosJobAuthorityTests`, and the existing
Photos IPC/import/connector and Gallery parity suites.
