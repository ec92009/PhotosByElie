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
  follow-up `31077ab2`.
- See [the continuation contract](../architecture/resumable-public-publication.md)
  for source/approval fences, same-run receipts, exact public-only registration,
  GET-first upload reuse and the unchanged PBB-179 Live authority.

## Pre-build verification

- Full Python discovery at `590306a9`: 670 passed; at `31077ab2`: 671 passed,
  including the atomic terminal rollback case. Four subsequent regression
  cases cover recovery/claim races, partial verification, current catalog reuse
  and ambiguous PUT responses. Final discovery is pending at this checkpoint.
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
  regression test. The latest focused Python set passes 35 tests.

Build, signature, installation, running UI checks and public archive receipt
are pending. Planned identity: v268.0/build 363; no installable artifact has yet
consumed it. Existing installed/public v266.5/build 362 is unchanged here.
