# PBE-214 verification receipt — 25 September 2026

- Source on main: `90e1146b` (API contract v1.4.0, 43 operations).
- Worker version: `22ca2c66-a88f-4ad9-83fe-d849a89b4046`.
- Previous Worker rollback reference: `7beecbde-3369-4611-b632-fa65c3d39f5d`.
- Existing auth/download domains and bindings retained; deploy used `--keep-vars`.
- No campaign/site content, real photo registration, original/private binding,
  catalog publication, or Owner state changed for API acceptance.

## Checks

- Clean dependency install; npm audit: zero vulnerabilities.
- Focused store/route/Owner API tests: 133 passed.
- Pretest safety group: 61 passed.
- Full JavaScript group: 305/306 passed. The unchanged
  `publication validation accepts and fingerprints reviewed Owner authority`
  test fails on the inherited catalog/media-sidecar parity mismatch. Catalog,
  sidecar, validator and that test are unchanged from the main baseline. This
  is not waived as a successful website publication check.
- Python regression suite executed separately after the JS failure: 489 passed.
- Generated contract check and `git diff --check`: passed.
- Worker dry run and deployed release gate: 120 tests passed; startup 101 ms.
- An optional Miniflare 5 alpha D1 proxy rehearsal stalled after runtime startup.
  It was stopped and its test processes cleaned up; no runtime transaction-pass
  claim is made. Transaction rollback is covered by the real SQLite test harness.

## Live read-only verification

At `2026-09-25T17:47:49.651Z`, the existing `max` connector called
`https://auth.photos-by-elie.com/api/v1/lifecycle/reconcile` with `prepareOnly: true`
and one synthetic probe identity, never an apply envelope.

- Preparation: HTTP 200, `readOnly: true`, `state: prepared`.
- Exact repeated preparation returned the identical envelope.
- `Cache-Control: no-store`; `CDN-Cache-Control: no-store`.
- Probe identity remained `identity-missing` before **and** after preparation.
- No authenticated credential: HTTP 401.
- Private binding input: HTTP 400.
- No unrelated or private keys appeared in the response.
- Envelope SHA-256: `cea93ab59682993287498042bb56edf5c06d6e2dc93687ea86950df990a44c2f`.
- Applied: false; real-photo writes: zero.

PBE-214 delivers the supporting API only. PBB-191 native orchestration,
PBE-213 historical reconciliation and PBM-56 subject readiness remain separate
unfinished work. Bilbao/Seville campaign publication and FIFO consumption remain
paused under the current owner direction.
