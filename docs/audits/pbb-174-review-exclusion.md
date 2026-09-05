# PBB-174 Review exclusion persistence

The recoverable Waste Basket gateway writes global `sidecar_decisions.pick_state = 'hidden'` and preserves fixture placement for restoration. The native Review reader filtered tombstones and fixture placement but omitted global visibility. Refresh could therefore bring an excluded item back. The Python connector's Review reader already applied the missing predicate.

The native query now excludes global hidden decisions before counts and pagination, matching that authority contract. Fixture-local Hide remains separate and appears under its existing Hidden filter. This change writes no source file, workflow state or schema.

Two new copied-SQLite tests reproduce the defect before the fix, then verify single/multiple exclusion, fresh-store/relaunch reads, counts, explicit restoration, and the difference from fixture Hide. They model the exact visibility column written by the gateway; the actual gateway's regression suite independently verifies recoverable persistence and source protection. The existing delayed native lifecycle test now covers both single and multi-selection, successful removal and Undo. Existing failure/rollback and consecutive-action tests remain in place. No production exclusion is executed for validation.

The maintainability baseline permits exactly one new SQL predicate line in the existing query/file, with an explicit review note; other ceilings are unchanged. Target installed release: v249.7/build321.

Validation: 394 Swift tests in 31 suites pass; 95 Python Waste Basket gateway/native parity checks pass; maintainability check and whitespace validation pass. Initial reproduction failed on the missing visibility behavior, then passed after the one-line predicate fix. Source-only test setup was corrected before the final run (the copied fixture has two assets and lazily creates the second decision row).
