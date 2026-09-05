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
