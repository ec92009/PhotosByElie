# PBB-79 Waste Basket lifecycle

Status: local implementation contract; production acceptance remains gated by
the PBB-79 ticket. `Owner.sqlite` is the authority. JSON files are derived
compatibility views only.

## Invariants

- Ordinary X is reversible: `pre-X -> recoverable Waste Basket`.
- Restore reconstitutes the exact pre-X source, source-version, fixture,
  gallery, decision, pick, hidden, approval, editorial, delivery, publication,
  sale, upload, and lifecycle context captured in the same transaction.
- Only an explicitly confirmed **Empty Waste Basket** operation may create an
  active global tombstone. It retains source media, R2 objects, and history.
- Local catalog generation excludes active tombstones and recoverable basket
  entries. Immediate deployed search, delivery, and commerce revocation still
  requires the dedicated ACCESS_DB deny projection described below; a pending
  catalog publish is not equivalent enforcement. Tombstone restore is a
  separate explicit and auditable operation.
- Repeated requests converge by durable `request_key`; the SQLite transaction
  uses `BEGIN IMMEDIATE` and records an operation plus per-asset receipt.
- A restore acknowledgement distinguishes the committed Owner transaction from
  its derived static projection. Projection failure returns authoritative
  success plus a retryable pending projection; a new request may safely resolve
  the same fixture-bound restored receipt and reconcile the projection.

## Authoritative writer and schema

[`scripts/waste_basket_gateway.py`](../../scripts/waste_basket_gateway.py) is
the single normal lifecycle writer. It creates these Owner SQLite tables:

- `owner_waste_basket_entries`: one immutable lifecycle entry per X, with
  recoverable, tombstoned, and restored state plus actor/source/context;
- `owner_waste_basket_provenance`: immutable row-level snapshots keyed by
  relation and primary-key values;
- `owner_waste_basket_operations`: idempotency, authorization, confirmation,
  result, and failure state;
- `owner_waste_basket_receipts`: before/after evidence for each asset.

The public Python boundary is:

- `move_to_waste_basket(...)` for single and batch X;
- `restore_from_waste_basket(...)` for normal undo/restore;
- `empty_waste_basket(..., confirmed=True,
  confirmation_token="EMPTY_WASTE_BASKET")` for the only normal tombstone
  transition;
- `restore_tombstone(..., explicit_tombstone_restore=True)` for the separate
  recovery path.

## Call paths

| Surface | Route | Gateway contract |
| --- | --- | --- |
| Native Culling | `LifecycleService.moveToWasteBasket` -> `photo-moderation` connector action | `source=backstage-culling` |
| Native Review | `BackstageViewModel.moveReviewSelectionToWasteBasket` -> same service/action | `source=backstage-review` |
| Backstage-hosted PBE Owner gallery | `hidden-actions.js` -> authenticated loopback session -> `apply_photo_action` | `source=owner-gallery` is derived from the frozen lease |
| Waste Basket | native or web Empty/Put back controls -> same gateway | Empty confirmation and exact token are required |

PBE-122 does not get a second host or writer. Its hosted Owner gallery uses the
existing loopback host and the `owner-gallery` authorization seam; the browser
cannot assert the trusted booleans itself.

## Bypass and compatibility policy

Normal UI, API, import, cleanup, and R2 routes cannot write a tombstone:

- the old `discard` alias is recoverable X;
- the old `undo-hide` compatibility alias only restores the historical hidden
  view and cannot create a tombstone;
- `wipe-hidden-r2` is rejected and cannot empty the basket or delete media;
- the retired direct `media_lifecycle='discarded'` Owner helper is rejected;
- `owner_state_db.py --sync-media-lifecycle` is a dry-run by default. Its
  `--sync-media-lifecycle-apply` form requires a non-empty legacy audit receipt
  and plan digest; read paths use existing SQLite rows and never invoke it;
- direct local/cloud legacy Sidecar tombstone decisions are rejected;
- the generic `sidecar_cloud_migration.py` refuses to upsert active legacy
  tombstones;
- `migrate_sidecar_tombstones_to_cloud.py` is inventory-only. Its retained
  `--apply` flag exits before reading inputs, credentials, or lifecycle state;
- no legacy marker re-enables a Sidecar tombstone writer. PBB-78 requires a
  separately designed canonical PBB-79 gateway migration plus receipt-backed
  deployed deny projection before any live apply path can exist.

Existing cleanup and migration tools remain separately named legacy/repair
surfaces. They are not allowed to masquerade as X or Empty Waste Basket.
Sidecar itself is obsolete as a product, authority, and launch path.

## Retained immediate-revocation blocker

PBB-79 remains the sole authority, but this source candidate does not yet have
the complete receipt-backed cloud materialization required for immediate
runtime denial. The retained slice must use dedicated ACCESS_DB lifecycle deny,
control/barrier, and receipt tables—not `pbe_sidecar_decisions`—and must:

- arm a persistent fail-closed barrier before the local authoritative mutation;
- commit the Owner transaction, lifecycle revision, receipt, and outbox
  atomically;
- project both recoverable and tombstoned rows as denied, idempotently apply
  only newer canonical-ID revisions, and clear the barrier only after receipt
  application;
- keep restore denied until a higher-revision restore receipt applies, without
  republishing it; and
- deny generically when projection/barrier state is unavailable across public
  search, checkout, fulfillment, ZIP, old/new download tokens, and media
  GET/HEAD/Range.

Failure must over-deny and no timeout may clear the barrier. Until replay,
stale-revision, duplicate, partial-batch, persistence, race, and canonical-ID
tests prove this entire path, deployed immediate revocation remains a P1 and
`catalog_publish_pending` remains evidence of unfinished propagation only.

## Rollback and operational gate

Rollback is data-preserving: stop the new UI/connector caller, leave the
gateway receipts and provenance intact, and use the explicit restore operation
for recoverable entries. Do not delete source/R2 objects, rewrite catalog
history, or run a live migration as part of rollback. A tombstoned entry first
requires the explicit tombstone-restore path. Production acceptance still
requires native build/rehearsal, connector/API integration, real Owner auth
verification, backup/merge/rollback evidence, and a fresh PBB-79 acceptance
review; this local change does not deploy or mutate the live Owner database.
