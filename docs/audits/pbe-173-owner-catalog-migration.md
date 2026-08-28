# PBE-173 Owner catalog migration

## Outcome

The approved PBE-173 reconciliation policy was applied to the local Max
`Owner.sqlite` authority on 28 August 2026. The public catalog and deployed
storefront were not changed.

The migration preserved all 842 pre-existing `public_catalog_publications`
rows, added 912 exact receipt-backed publication mappings, and recorded all
2,650 production catalog rows in a durable migration ledger. The remaining
1,505 catalog rows stay public and are explicitly unresolved; no identity was
inferred for them. The 102 disagreements between current publication authority
and historical bridge receipts remain recorded for audit and did not overwrite
current publication state.

## Evidence

- Approved policy ticket: `PBE-173`
- Migration ID: `owner-catalog-805268d70781dc9011fc0970`
- Reviewed plan hash:
  `805268d70781dc9011fc09703b3c45555ebd6c9115c04cff7134c1d7dde3ed6f`
- Production catalog SHA-256:
  `efecb290b7b5990ca8791fd81fafcaf549625aa924686775c66b922b6f612579`
- Production rows: 2,650
- Existing authoritative rows: 233
- Backfilled rows: 912
- Explicit unresolved exceptions: 1,505
- Historical receipt disagreements retained: 102
- Conflicts: 0
- Original publication rows changed or missing: 0
- Owner integrity: `ok`
- Backup integrity: `ok`
- Second application: verified no-op

The aggregate machine-readable evidence is retained in
`docs/rehearsals/pbe-173-owner-catalog-reconciliation.json`. Private row-level
plans remain local and must not be committed or published.

## Safety and rollback

The migration tool requires an absolute checkpointed Owner path, the exact
reviewed plan, an unused backup path, `--allow-unresolved`, and
`--approved-policy PBE-173`. It fails closed on changed inputs, identity or
version conflicts, missing source-version receipts, a non-empty WAL, or an
existing backup target. The write occurs in one immediate transaction and
records both run and row receipts. A replay verifies the durable rows and
returns a no-op.

The pre-migration SQLite backup is retained locally as
`assets/owner-actions/Owner.sqlite-backup-20260828T1031Z-pbe-173`. If rollback
is ever required, first stop Backstage and every Owner writer, preserve the
failed database separately, verify that its WAL is empty, restore this backup
as `Owner.sqlite`, and run `PRAGMA integrity_check` before reopening Backstage.
No rollback was required during the accepted migration.

## Verification

- PBE-173 focused tests: 11 passed.
- Repository pretests: 32 passed.
- Repository JavaScript tests: 267 passed.
- Repository Python tests: 465 passed.
- Isolated full-size migration rehearsal: passed.
- Live-local replay and receipt verification: passed.
- Public catalog bytes before and after: unchanged.

## Owner-authoritative projection closure

The follow-up closure slice on 28 August 2026 replaces the remaining
dual-authority behavior with an immutable catalog snapshot held in
`Owner.sqlite`. The checked-in and local website database is now an atomic,
byte-identical projection of that snapshot. Every revision records its
checksum, row counts, provenance, and policy; deployment verification records
the exact remote checksum separately and fails closed on drift.

The reviewed revision 2 was rebuilt from the reconciled Owner policy and the
available catalog source metadata. It contains 3,414 media rows: all 2,650
previously deployed rows plus 764 valid additions, with one newly blocked row
removed. The obsolete `ai` collection/source-origin path was removed. In
particular, `stained glass` is no longer a collection alias; the Bilbao church
regression resolves deterministically to Spain.

Owner currently has 4,479 eligible identities. The remaining 1,065 do not yet
have sufficient source metadata to materialize public catalog rows, so they
remain outside revision 2 rather than being guessed into the website. This is
an explicit source-availability gap, not a second catalog authority.

### Revision 2 evidence

- Owner projection revision: `2`
- Media rows: `3,414`
- Catalog SHA-256:
  `3cd7f3d1d2547811d3b4e4ebef03a9858e45f676379ff9a655a694a350099b19`
- Collections: `7`
- Retired `ai` collection rows: `0`
- Retired `ai` source-origin rows: `0`
- Integrity check: `ok`
- Foreign-key violations: `0`
- Focused projection/publication tests: `23 passed`
- Full Python suite: `533 passed`
- Native Swift suite: `286 passed`
- Checkpoint before projection adoption:
  `assets/owner-actions/Owner.sqlite-backup-20260828T1501Z-pbe-173-projection`

The deployed website remains a separate, failed gate at the time of this
  record: it still serves the old 2,650-row checksum
`efecb290b7b5990ca8791fd81fafcaf549625aa924686775c66b922b6f612579`
and retains the retired unused `ai` source-origin row. PBE-173 must remain
Active until revision 2 is deployed and exact remote parity is recorded.
