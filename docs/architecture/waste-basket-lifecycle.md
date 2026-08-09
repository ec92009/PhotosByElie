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
- Active tombstones and recoverable basket entries are fail-closed for global
  eligibility, publication, search, delivery, and commerce. Tombstone restore
  is a separate explicit and auditable operation.
- Repeated requests converge by durable `request_key`; the SQLite transaction
  uses `BEGIN IMMEDIATE` and records an operation plus per-asset receipt.

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
| Owner web / Owner gallery | `hidden-actions.js` -> local server or Worker connector -> `apply_photo_action` | `source=owner-gallery` requires `owner_mode` and `owner_authorized` |
| Waste Basket | native or web Empty/Put back controls -> same gateway | Empty confirmation and exact token are required |

PBE-122 does not get a second host or writer in this change. Its future
Owner-mode gallery call is defined by the `owner-gallery` authorization seam.

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
- direct local/cloud Sidecar tombstone decisions are rejected;
- the generic `sidecar_cloud_migration.py` refuses to upsert active legacy
  tombstones; only the separately named, dry-run-by-default PBB-78 migration
  carries its audited legacy marker;
- the low-level Python Sidecar primitive accepts a tombstone only with the
  explicit `PBB-78-legacy-expo-hidden` marker, non-empty plan digest, and audit
  receipt;
- the PBB-78 migration remains dry-run by default and emits that marker only
  on its explicitly audited apply path.

Existing cleanup and migration tools remain separately named legacy/repair
surfaces. They are not allowed to masquerade as X or Empty Waste Basket.

## Rollback and operational gate

Rollback is data-preserving: stop the new UI/connector caller, leave the
gateway receipts and provenance intact, and use the explicit restore operation
for recoverable entries. Do not delete source/R2 objects, rewrite catalog
history, or run a live migration as part of rollback. A tombstoned entry first
requires the explicit tombstone-restore path. Production acceptance still
requires native build/rehearsal, connector/API integration, real Owner auth
verification, backup/merge/rollback evidence, and a fresh PBB-79 acceptance
review; this local change does not deploy or mutate the live Owner database.
