# PBB-191 — resumable publication evidence

Owner resumed the previously authorized preventive implementation on 25
September 2026. The daily FIFO and Bilbao/Seville campaign publication remain
separately paused. No real photo registration, upload, historical repair or
campaign publication was used for these source tests.

## Source and behavior

- Supporting PBE-214 API: reviewed main `90e1146b`, live Worker
  `22ca2c66-a88f-4ad9-83fe-d849a89b4046`, read-only live receipt at
  `docs/api/PBE-214-verification-20260925.md`. Main was integrated into the
  canonical native line with merge `ee8add11`.
- Native implementation `590306a9`; terminal-transaction and confirmation-copy
  follow-up `31077ab2`; reviewed retry fixes and signed-build source
  `5f169db3a80b2bd6aa33ea0ba7e7190d347e7640`. This source is pushed to the canonical
  `release/backstage` branch.
- See [the continuation contract](../architecture/resumable-public-publication.md)
  for source/approval fences, same-run receipts, exact public-only registration,
  GET-first upload reuse and the unchanged PBB-179 Live authority.

## Source and packaged-runtime verification

- Full Python discovery at `590306a9`: 670 passed; at `31077ab2`: 671 passed,
  including the atomic terminal rollback case. Four subsequent regression
  cases cover recovery/claim races, partial verification, current catalog reuse
  and ambiguous PUT responses. Final discovery at `5f169db3`: **675 passed**.
- Full Swift after confirmation-copy changes: 433 tests / 32 suites passed.
- JavaScript safety pretest 61 passed; Python pretest 27 passed. Main JS
  305/306: the sole inherited publication-authority integration fixture still
  fails because the checked-in public catalog and bootstrap sidecar differ.
  No catalog edit or validation bypass was made to disguise this separate gate.
- Generated contract current: API 1.4.0, 43 operations, 14 schemas. npm audit:
  zero vulnerabilities. `npm run validate` remains a read-only refusal without
  an explicitly reviewed Owner snapshot, not a production-publication pass.
- Native Graphify refreshed, 5065 nodes. Missing SQL parser and partial Swift
  parser coverage remain map limitations; actual source and compilation/tests
  are the behavioral evidence.
- Independent review found three retry issues before any build: stale PID
  recovery overwriting a newer claim, dropped partial-verification progress,
  and blind retries inside PUT helpers. Each was corrected and gained a direct
  regression test. The latest focused Python set passes 35 tests. Independent
  re-review confirmed all three fixes and found no new actionable defect.

## Signed candidate

- Built on 25 September 2026 at 21:19 CEST: **v268.0/build 363**, arm64, macOS 14
  minimum. This identity is consumed and must not be reused for a different build.
- Bundle: `native/PhotosByElieBackstage/dist/PhotosByElie Backstage.app`.
- Strict/deep signature verification passed. Signing identity: Apple Development:
  Elie Cohen (L9958JSM92); team CB7FE399AL.
- Sealed Owner runtime: 222 files; manifest SHA-256
  `58a0dc2e0e4019f39272edb7315b52ad132e14991c674ec68099774418fa4b91`.
- Isolated system Python 3.9.6 and bundled Pillow 11.3.0 synthetic 900/1800
  watermarked-preview smoke passed during the build.
- An isolated `/usr/bin/python3 -I -S -B` harness loaded 16 production modules
  from the signed candidate and ran **18 continuation/R2 tests successfully**
  against disposable local fixtures and mocked providers. Production module
  origins were asserted before and after the tests. This is packaged-runtime
  evidence, not installed-app or real-photo acceptance.
- Release dry run passed, including extracted signature and canonical remote
  source provenance checks. No archive or latest-pointer write was made.

## Packaged client against the live read-only API

At `2026-09-25T19:28:18.127828+00:00`, the candidate's `RegistrationClient`
used the existing `max` connector at `https://auth.photos-by-elie.com`.
The harness reproduced the native launcher's verified runtime/data-root
environment and the production view's canonical preview-key order.

- Synthetic identity: `pbb191-readonly-probe-20260925`.
- Current observation before and after preparation: `identity-missing`.
- Preparation: `readOnly: true`, `state: prepared`, exact expected items.
- Envelope SHA-256:
  `9bdbdf250332502a18cea82da64ac541403983a5b95f09887fba969f96ad50e8`.
- Apply was never called; real-photo writes: zero.

The initial bare harness import omitted the launcher's runtime environment and
therefore correctly rejected the older configured standalone runtime. A second
harness assertion used noncanonical binding order. Both were harness defects;
the native launcher and shared SQL view already supply the correct settings and
order. No safety bypass or source patch was needed to obtain the passing result.

## Installation handoff — 25 September 2026, 21:29 CEST

The old app was actively being used: UI state changed through Metadata and an
Apple Photos metadata plan, and a UI action was rejected because the user had
changed the app. Do not force-quit or replace it underneath that work. A safe
restart window was requested; no new installation has occurred.

- Installed and running app remains **v266.5/build 362**.
- Public `latest.json` independently checked at `2026-09-25T19:29:38.236Z` also
  remains v266.5/build 362. No new public archive was published.
- Next: normal safe quit; preserve build 362 as a rollback copy; install exact
  candidate; verify installed runtime, running UI and release-control receipt;
  publish and independently verify the immutable archive/latest pointer; then
  record final evidence and move PBB-191 to `Verified`.
- PBB-191 remains `In Progress`; PBE-213 and PBM-56 remain `Ready`. No historical
  repair, campaign publication or FIFO consumption occurred.
