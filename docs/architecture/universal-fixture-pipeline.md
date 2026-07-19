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
placement, destination, and receipt tables alongside the existing Sidecar
tables. Sidecar remains authoritative for rating, color, pick state, editorial
state, title, caption, keywords, and undo history.

The Owner surface talks to this model through the enrolled per-Mac connector.
Neither asset search nor pool creation publishes media or messages a client.

## Stable pools and reversible placement

A pool records an ordered list of asset IDs, source identities, provenance, and
a SHA-256 hash of the candidate IDs plus search criteria. Repeating an identical
snapshot for the same fixture returns the same pool. Later changes to an Apple
Photos album cannot silently change an existing pool.

Placements are separate from pools and record an event ledger for place, move,
remove, and restore. A single asset can have active placements in multiple
fixtures. Fixture moves reject cycles.

## Delivery and verification

Delivery destinations are configured per fixture placement and editorial
version. Current destinations are `r2`, `apple_photos`, and `archive`. Each
attempt has an independent receipt containing status, object key, checksum,
visibility policy, verification evidence, and error detail. A changed editorial
version does not inherit a previous version's receipt.

R2 Upload Bridge results are attached only to active R2-enabled placements for
the exact configured version. Apple Photos write-back is blocked until the
asset is picked, metadata-approved, and R2-verified for that same version.
Photos is then written, re-read, and verified before its receipt becomes
verified. Partial failures remain independently retryable.

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
- Unrelated Apple Photos keywords are preserved.
- Corine must not be messaged until the migrated gallery is live and tested.
