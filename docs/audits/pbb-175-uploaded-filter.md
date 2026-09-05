# PBB-175 — Uploaded status filter

Gallery and Review expose an accessible Uploaded checkbox alongside their existing status checkboxes. It uses the existing durable `asset_delivery_state.delivery_state = 'live'` receipt. It combines with checked placement/editorial states using OR, without duplicate rows. Fixture membership, media/source filters, global Exclude, and tombstones retain precedence.

Native SQLite readers and the Python fallback apply the same predicate before pagination and counts. Gallery reports the complete scoped Uploaded count and retains live cards/counts during optimistic placement changes. The local candidate projection carries the same receipt. These filters do not change upload, editorial, fixture, or media state.

## Validation

- Copied SQLite tests cover Uploaded alone, Uploaded + Picked, Uploaded + Hidden, overlapping state deduplication, page counts, child/other fixture isolation, and byte-identical native databases after reads.
- Review's global Exclude still overrides Uploaded.
- Native local candidate and view-model tests preserve live cards across placement changes.
- Python fallback regression covers the same OR and fixture boundaries.
- Maintainer review extracted Gallery summary and Review status predicates. Only four narrowly documented legacy metric ceilings change; no unrelated budgets widened.

Installed verification is recorded after the signed release is built and inspected. No upload or publication is needed to exercise the filter.

Final checks:399 native tests/31 suites,328 Node tests,516 Python tests pass; the final fixture-only Python rerun passes57 tests after adding the unpicked-live edge case. The existing consecutive Waste Basket pending-count test had one timing-sensitive failure; it passed independently and in a complete399-test rerun without a code change. Maintainability and diff whitespace checks pass. Uploaded also includes explicitly fixture-associated unpicked live photos in Review; normal Picked semantics are unchanged.

Signed build323 is ready from `fc82b936f914e36be88d5bf878bd59172cddaab3`; embedded runtime204 files SHA-256 `12b4b21f127d75014a0ce4c68aafc78725ab9c0d4980feb8244e4b5679a6a132`. Apple Development Elie Cohen/L9958JSM92 signing and release manifest provenance pass. Local archive/manifest are under `/tmp/pbb323-install`; no archive was published. Installation is deferred: installed322 is actively processing an owner-started42-photo upload. The agent did not initiate, stop, or interrupt that operation. PBB-175 remains awaiting installed verification; canonical source worktree is retained clean and graph refreshed locally (4,787 nodes/16,505 edges).

## Installed acceptance, 2026-09-05

Verified in signed v250.4/build 328 after the upload recovery drained. Gallery exposes Uploaded with native checkbox accessibility and selected state. Uploaded alone returns 3,461 matches with 200-item pagination; Picked + Hidden + Uploaded returns 4,569, within the same 24,468-item eligible scope. RE is configured with `candidate_mode=photos-library`, so Gallery intentionally has a broader candidate universe than the curated Review queue. Review Uploaded alone returns 657 (189 approved and 468 hidden); combined Picked + Hidden + Uploaded returns 1,765 (189 approved and 1,576 hidden), without double-counting overlap. Existing copied-SQLite tests establish exact membership and isolation; these installed counts are UI receipts, not independent per-row membership proofs. Original Gallery Undecided-only and Review Picked-only filters were restored. No editorial, upload, or publication action was invoked during filter verification.
