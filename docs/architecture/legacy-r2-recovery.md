# Exact legacy R2 photo recovery

PBE-213 supports one owner-approved, already-listed JPEG whose exact private
master and both existing public previews remain in R2 but whose current Owner
source/publication chain is absent. This is not a PhotoKit identity migration,
bulk import, new upload, new listing, or a way around public-photo readiness.

## Evidence and operator authorization

Use `scripts/legacy_r2_recovery.py` from the installed signed Backstage
OwnerRuntime for production writes. Source-only planning is read-only. Live
Owner writes from a development checkout are refused; temporary test databases
remain usable without a native installation.

The exact request contains media ID, existing public root fixture ID, approved
original SHA-256 and size, immutable weekly-selection digest, and separate
durable selection/recovery approval references. The operator must resolve these
references to the actual owner decisions and unchanged selection before
approving the plan digest. Bounded strings do not themselves prove approval.

`--repo-root ROOT --request REQUEST.json` builds a no-write plan. It requires
current approved Owner/catalog authority and deployed full-catalog parity,
checks local denials/conflicts, then authenticated full-GET hashes all three
exact existing R2 objects without saving the original. JPEG SOF dimensions are
observed; this header check is not a full pixel decoder. The daily readiness
guard still independently verifies current bytes and decoded public previews.

Review the exact plan and its SHA-256. `--apply-plan PLAN.json
--approved-plan-sha256 HASH --backup ABSOLUTE_PRIVATE_BACKUP.sqlite` rechecks
all evidence and Owner authority. The backup must be a new mode-0600 file
directly inside this root's `assets/owner-actions`. Registration uses one
immediate transaction and leaves the public-catalog publication `local`, not
`live`. No catalog, R2 object, cloud lifecycle or provider post is changed.
Object observations retain their real timestamps and must be at most 120
seconds old at the write boundary.

The source anchor is explicit `legacy-r2`, never an invented Apple Photos
identifier. The immutable recovery batch binds original bytes, approvals and
catalog provenance. Photos scan immunity requires that proof; a prefix alone
does not grant it. Photos export, metadata writeback, sync and preview paths
reject legacy sources rather than deriving a new media family. Ordinary
approval withdrawal, tombstoning and missing-remote checks still apply.

Replaying the same registration reconciles its immutable provenance and makes
no write. Its result explicitly requires fresh current readiness; it does not
reinstate a denied asset or assert present public access.

## Missing or stale preview metadata

When `catalogMetadataRepairRequired` is true, the separate
`--apply-plan PLAN.json --approved-plan-sha256 HASH --repair-catalog-metadata`
operation rechecks current approval/version/placement/receipts and fresh exact
object evidence. It changes only width, height and byte count in the same
three existing catalog asset rows. All listings, editorial copy, commerce,
other assets and private-original access semantics are preserved.

The candidate goes through the existing guarded `store_projection` authority
protocol. Its result is **prepared, not deployed**. The ordinary supported
catalog projection/deployment/parity-commit workflow must finish next. A repeat
after preparation must reconcile the pending authority operation; never
prepare another projection merely because a response was lost.

For Córdoba's September 28 recovery, observed previews are portrait
675×900 / 218,260 bytes and 1350×1800 / 773,607 bytes. The old catalog has
landscape dimensions and NULL preview sizes. The original full row is already
5712×4284 / 8,100,667 bytes and must stay semantically unchanged. These facts
are plan-bound observations, not permanent substitutes for fresh verification.

## Completion and rollback

After supported catalog deployment, verify exact public-catalog parity and
the native publication audit. Reconcile the exact current public-preview
lifecycle bindings through the existing supported PBE-214 path when needed.
Run the unchanged Marketing readiness gate for every ordered selected photo.
One repaired photo is not whole-subject readiness, public hosting, or daily
completion. Existing social/video provider receipts are never reposted.

If registration fails, its transaction rolls back and the private backup is
retained. If later deployment/authority is pending or uncertain, reconcile it
before retry; do not restore an older Owner over an active catalog authority.
Disable hosting before any separately authorized whole-Owner/runtime rollback.
Keep the subject blocked and record the actual dependency until all proof is
current. Never edit blocked receipts into successful ones.

Offline tests: `legacy_r2_recovery_test`, `legacy_r2_catalog_test`, and
`test_legacy_r2_photos_isolation`, plus the touched native/Photos suites.
