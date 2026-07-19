# Universal Build a Fixture pipeline

## Purpose

A fixture is the stable organizing object for any Photos By Elie job or body of
work. It is not a Real Estate track alias. Fixtures can be roots or children of
other fixtures to arbitrary depth, and the same source asset can be placed in
more than one fixture without copying or deleting it.

The canonical flow is:

1. create or choose a fixture;
2. search the indexed asset library without changing it;
3. snapshot selected candidates into an immutable culling pool;
4. open that pool in the existing Sidecar UI;
5. pick and approve independently, then configure per-asset destinations;
6. deliver to R2 and, after same-version verification, give approved metadata
   back to Apple Photos.

## Local authority

Ignored `assets/owner-actions/Owner.sqlite` remains the private workflow store.
`fixture_pipeline.py` adds recursive fixture, source-batch, culling-pool,
placement, destination, receipt, deliverable-link, and access-grant tables
alongside the existing Sidecar tables. Sidecar remains authoritative for
rating, color, pick state, editorial state, title, caption, keywords, and undo
history. Renames and moves retain the fixture ID, grants, placements, pools,
and deliverable recovery links.

Owner can create roots and children, rename or move them, archive a complete
subtree, and reopen it later. Archive/reopen never deletes source batches,
pools, placements, grants, delivery destinations, or receipts.

The Owner surface talks to this model through the enrolled per-Mac connector.
Neither asset search nor pool creation publishes media or messages a client.
Owner search filters can be combined across free text, dates, album identity,
media type, camera, lens, fixture placement, rating, color, decision/editorial
state, and delivery state. Exact dedupe uses only stable source identity or an
explicit checksum; capture-time proximity is never treated as duplicate proof.

## Stable pools and reversible placement

A pool records an ordered list of asset IDs, source identities, provenance, and
a SHA-256 hash of the candidate IDs plus search criteria. Repeating an identical
snapshot for the same fixture returns the same pool. Later changes to an Apple
Photos album cannot silently change an existing pool.

Placements are separate from pools and record an event ledger for place, move,
remove, and restore. A single asset can have active placements in multiple
fixtures. Owner can bulk-place selected search/pool assets into several
fixtures, review their placement ledger, and move, remove, or restore each
relationship without touching the source asset. Fixture moves reject cycles.

## Delivery and verification

Delivery destinations are configured per fixture placement and editorial
version. Current destinations are `r2`, `apple_photos`, and `archive`. Each
attempt has an independent receipt containing status, object key, checksum,
visibility policy, verification evidence, and error detail. A changed editorial
version does not inherit a previous version's receipt.

R2 Upload Bridge results are attached only to active R2-enabled placements for
the exact configured version. A successful PUT is not enough: the bridge
downloads each remote object, hashes the returned bytes, and records a verified
receipt only when that checksum matches the local upload. Apple Photos
write-back is blocked until the asset is picked, metadata-approved, and
R2-verified for that same version.

When Sidecar uploads before fixture routing, the completed run is not silently
written back or assigned. Its ledger captures the editorial version at planning
time. Sidecar links the completed run to Owner, where an operator chooses a real
fixture, previews the exact checksum-verified completed rows, selects only the
items belonging to that fixture, and commits adoption separately. Cancelled
runs adopt completed uploads only; unprocessed planned rows are excluded. The
adoption creates reversible placements, configures `r2` plus `apple_photos`, and
reconstructs verified R2 receipts from the run ledger. The older July 19 run
predates version capture, so it additionally requires an explicit historical
backfill acknowledgement and is eligible only when the indexed asset and
editorial decision timestamps both predate the run.

Photos is then written, re-read, and verified before its receipt becomes
verified. Partial failures remain independently retryable.

The Photos dry-run reads the current Photos title, caption, and keywords and
reports exact before/after changes. It never writes. Commit is a separate,
explicit operation.

## La Concha migration checkpoint

The first live fixture tree is:

- La Concha
  - Apartment 1
  - Apartment 2
  - Common
    - Street
    - Main lobby
    - Pool
    - Tennis court

The July source refresh produced stable pools for 70 Apartment 1 sources, 66
Apartment 2 sources, and 14 common-area sources routed across the four Common
children. The current Corine gallery and access policy were not changed and no
client message was sent. Existing public/private gallery deliverables remain
the recovery path while the fixture delivery receipts are built forward.

## Safety boundaries

- Search is read-only.
- Pool creation does not mutate source media.
- Fixture mode changes only Sidecar scope; it does not fork Sidecar behavior.
- Pick and Approved are distinct.
- Apple Photos commit is explicit and preceded by a dry run.
- Upload-run adoption is explicit, fixture-scoped, subset-selectable, and
  preceded by a dry run.
- Unrelated Apple Photos keywords are preserved.
- Corine must not be messaged until the migrated gallery is live and tested.
