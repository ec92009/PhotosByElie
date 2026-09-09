# PBB-178 — Uploaded without Picked + Approved audit

Gallery now includes a dedicated saved view named **Uploaded without approval**. It finds fixture-scoped photos that have a current verified R2 delivery receipt but do not have both `placement_state = picked` and `editorial_state = approved`.

The query requires the delivery receipt's source-version hash to match the asset's latest source version. Global exclusions and tombstones keep their existing precedence. Hidden, Undecided, and Picked-but-unapproved photos are included; Picked and Approved photos are excluded. The regular Uploaded status checkbox keeps its existing inclusive semantics.

Cards in this audit show their fixture decision separately from `R2 Uploaded`, so a hidden separator photo remains visibly distinct from a public/live approval. The saved view supports the existing search, filters, pagination, and fixture scope. It is read-only: opening or filtering the view does not change fixture, editorial, upload, publication, or source state. Removal from R2 or the public catalog remains a separate explicit owner action.

## Validation

- Native copied-SQLite tests cover current and stale R2 receipts; Hidden, Undecided, Picked-but-unapproved, and Picked-plus-Approved states; pagination; fixture isolation; global exclusions; and byte-identical databases after reads.
- The Python fallback applies the same predicate before pagination and counts, while preserving the existing Uploaded behavior.
- A read-only acceptance query against the current Expo fixture found 119 current R2 uploads missing Picked + Approved. All 119 were Hidden and Approved at the time of the check. Owner.sqlite remained byte-identical.
- The complete native suite passes 406 tests in 32 suites. The repository suite passes 521 Python tests and its Node checks. The Backstage maintainability audit and whitespace checks pass.

Installed verification is recorded after the signed release is built, installed, and inspected. No R2 object, catalog entry, editorial decision, or fixture decision is changed by this audit.
