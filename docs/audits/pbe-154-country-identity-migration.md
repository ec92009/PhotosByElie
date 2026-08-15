# PBE-154 Country identity migration gate

Date: 2026-08-14

Fresh read-only report generation: `2026-08-14T01:10:06.207867Z`

Status: read-only inventory and copy-only rehearsal complete; canonical apply not
authorized or performed

## Result

The committed row-level report is
`docs/audits/pbe-154-country-identity-report.json`.

| Check | Result |
| --- | ---: |
| Legacy Country assignments | 1,553 |
| Accounted rows | 1,553 |
| Deterministically mapped to native assets | 0 |
| Explicitly unmapped | 1,553 |
| Conflicts | 0 |
| Legacy IDs still present in the public catalog | 71 |
| Direct native `sidecar_assets.asset_id` matches | 0 |
| `public_catalog_publications` receipt matches | 0 |
| Reviewed identity-map matches | 0 |

Country totals remain 249 France, 434 Mexico, 475 Portugal, 52 Spain, and 343
USA. The report plan hash is
`67ff4a7f2ae6311953018c277a91eb8f03070325cb7bbb032ee2cc8b5c08e47a`.

The 71 public-catalog rows are diagnostic presence only. A catalog `media_id`
does not identify a native Apple Photos/Sidecar asset. Filename, capture date,
location text, source path, and visual resemblance were intentionally not used
as mapping evidence.

## Accepted mapping evidence

The planner accepts only:

1. an exact existing native asset ID;
2. an explicit `public_catalog_publications` asset-to-media receipt; or
3. a reviewed map row carrying a supported evidence type, evidence reference,
   reviewer, and review timestamp.

Every target must exist in `sidecar_assets`. Multiple targets, missing targets,
source-country disagreements, duplicate legacy claims on one native target, and
invalid reviewed-map rows fail closed as conflicts.

## Proposed authoritative schema

The copy-only rehearsal upgrades `country_assignments` in place. It remains the
single current-state Country table and gains:

- `assignment_id`, the stable row key;
- nullable unique `asset_id`, the durable native identity;
- nullable unique `media_id`, retained only as the legacy/public compatibility
  identity;
- `identity_status`, `identity_source`, and `identity_evidence_json`;
- migration receipt fields.

Mapped rows are addressable by `asset_id`. Unmapped legacy rows retain Country
and provenance in the same authoritative table but are not exposed as native
assignments. Separate migration tables are append-only receipts, not another
current-state store. The JSON export is regenerated from SQLite and contains a
legacy `photos` view plus a native `native_assets` view.

## Safety gates

Report mode opens SQLite read-only. Apply mode requires all of the following:

- the exact reviewed report and matching plan hash;
- zero conflicts and zero invalid reviewed-map rows;
- a new, non-overwritten SQLite backup path;
- an explicit compatibility-export path; and
- `--allow-unmapped` when unresolved rows remain.

The source report is rebuilt immediately before apply. Any source or evidence
change invalidates the reviewed plan. A second application of the same plan is a
no-op; a different plan against schema v2 is refused.

## Rehearsal evidence

The exact 1,553-row report was applied only to a disposable copy of canonical
`Owner.sqlite`:

- 1,553 rows migrated and 1,553 migration audit rows recorded;
- 0 mapped and 1,553 unmapped, exactly matching the report;
- compatibility export retained all 1,553 legacy rows and exposed 0 native rows;
- `PRAGMA integrity_check` returned `ok`;
- the second run returned `applied=false`, `noOp=true` with the same migration
  receipt;
- the generated pre-migration backup restored the original six-column schema,
  zero-row Country table, and `integrity_check=ok`.

The fresh report was generated read-only from these source hashes:

```text
legacy index  012be84d6ab24ae963201abd3f7f9147e3548d0f72e383f9373d4cb3f1171e5a
Owner.sqlite  216812cc5f17c9367dd4588eb38a1a49f54b1e89ab64bc1101a0813b334fce2d
catalog DB    26f21ffb47688db876ed69dcfd1961f74acb41d202f4d5e994bd271e37960bf1
```

This refresh wrote only the report JSON in the isolated lane; no canonical
Owner or catalog file was modified.

Automated verification:

- 14 focused identity-report/migration/compatibility tests pass, including
  direct/receipt/reviewed mappings, forbidden filename inference, missing
  targets, duplicate target conflicts, source-drift refusal, explicit unmapped
  acknowledgement, backup, legacy-schema import/export, post-migration
  unmapped writes, v2 force-import refusal, null-media filtering, compatibility
  export, rollback shape, receipt revalidation, and second-run no-op;
- 194/194 Node tests and 236/236 tests in the repository's listed Python suite
  pass;
- 264/264 discovered Python tests pass;
- the generated Owner API contract is current; and
- publish validation emits 376 existing Owner-application diagnostics, with the
  exact same diagnostic count and SHA-256 on pristine base `a8c23391`.

## Commands

Read-only report:

```bash
python3 scripts/country_assignment_identity_migration.py \
  --legacy-index assets/owner-actions/country-assignments.json \
  --owner-db /path/to/Owner.sqlite \
  --catalog-db assets/catalog/photosbyelie.sqlite \
  --report docs/audits/pbe-154-country-identity-report.json
```

Reviewed copy-only rehearsal:

```bash
python3 scripts/country_assignment_identity_migration.py \
  --legacy-index assets/owner-actions/country-assignments.json \
  --owner-db /path/to/disposable/Owner.sqlite \
  --catalog-db assets/catalog/photosbyelie.sqlite \
  --report /path/to/rehearsal-result.json \
  --apply-reviewed-report docs/audits/pbe-154-country-identity-report.json \
  --backup /path/to/disposable/Owner.before.sqlite \
  --compatibility-output /path/to/disposable/country-assignments.json \
  --allow-unmapped
```

Rollback is restoration of the verified pre-migration SQLite backup while the
connector and Backstage are stopped, followed by `PRAGMA integrity_check` and
count verification before reopening either writer.

## Remaining gate

Do not apply this report to canonical `Owner.sqlite`: it would faithfully
preserve all 1,553 rows but would unlock zero native assets. PBE-155 therefore
remains blocked. The next useful evidence is an explicit, reviewed
legacy-`media_id` to native-`asset_id` receipt map; after that input exists,
regenerate this report, resolve any conflicts, review the new plan hash, and
repeat the copy-only rehearsal before considering canonical apply.
