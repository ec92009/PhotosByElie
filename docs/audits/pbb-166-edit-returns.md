# PBB-166 — Edit Returns decision queue

## Result

Backstage now stages every finished external-editor file in a durable **Edit Returns** queue before it can change an asset. The Sidebar places Edit Returns between Gallery and Review. Each unresolved row shows the prepared original source or ordered sources beside the returned file, with Quick Look access and three explicit decisions:

- **Keep original** resolves the comparison without changing the asset, editorial state, or delivery state.
- **Replace original** adds the returned file as a new source version of the same single-source asset and sends it back to Review.
- **Keep both** creates a linked derived asset in Review while preserving the original.

Replace original is disabled for a multi-source composite because there is no single original asset to replace. Keep both remains available for that case.

## Safety contract

- Receiving a file copies it into the private external-edit job directory, records its byte count and SHA-256 checksum, and creates only a pending comparison.
- Pending comparisons survive relaunch in `Owner.sqlite` and do not appear in the accepted-return table.
- Decisions are transaction-scoped, durable, and idempotent when replayed with the same decision. Conflicting replays fail closed.
- A checksum or file validation failure leaves the comparison visible with its error and retry controls.
- Replace original resets the current candidate to unreviewed. An existing live delivery receipt remains tied to its prior source version, so the newer candidate cannot be treated as current published evidence.
- Keep both creates an unreviewed, not-ready derived asset with ordered parent lineage.
- No decision approves, uploads, publishes, unpublishes, or deletes media.

## Verification

- Swift package: 411 tests across 32 suites passed.
- Repository suite: 282 Node tests and 522 Python tests passed with `PYTHONPATH=scripts` for the repository's package-style Python imports.
- Focused external-edit suite: 10 tests passed, including relaunch persistence, duplicate filenames, keep-original replay, keep-both lineage, stale sources, checksum failure, and retry.
- Backstage maintainability ceiling check passed.
- Source-contract test confirms the Sidebar order, dedicated view, three controls, side-by-side inputs, Quick Look hook, and accessibility identifiers.

## Installed-app evidence

Pending build and installed-app verification for Backstage v252.1, build 331.
