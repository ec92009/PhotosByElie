# PBB-182 — AI status polling contention

## Change

The installed status path previously called `reconcile_orphaned_ai_runs` through a schema-initializing writable connection on every poll. Fresh processes could run schema/backfill writes even when no orphan required recovery.

Status reconciliation now reads active worker identities through a closed read-only connection and returns without requesting a writer for healthy, indeterminate, or absent workers. A genuinely dead worker still enters a short write transaction, rereads current state and rechecks liveness before terminalizing it. No busy timeout was increased.

The release also includes PBB-180's previously committed diagnostic fix, preserving actual Codex ERROR lines despite verbose prompt output and later startup/shutdown warnings.

## Verification

- 62 fixture pipeline tests passed, including holding a real WAL writer transaction while healthy, indeterminate and idle status reads succeed.
- Dead-worker cancellation/recovery and liveness recheck tests passed.
- Patched live read samples: 22.5, 3.4 and 4.6 ms.
- Signed release v258.0/build 332 from `d3f797095761e7940fd4dc127b0eb5f54206670d`; isolated signed-runtime previews passed at 900 and 1800 px.
- Published archive and latest manifest through the existing release script with exact downloaded SHA-256 verification.
- The installed updater verified the archive, installed and launched `/Applications/PhotosByElie Backstage.app`; native accessibility showed v258.0/build 332.
- Five focused status/recovery tests passed against the modules loaded from that installed signed runtime. Its live status read took 3.8 ms. Strict code-signature verification passed.
- The user's 12-item AI pass completed with 12 proposals and zero failures before installation. No new AI request, approval, media upload, or website deployment was made for verification.

This removes the demonstrated polling writer contention; it does not claim that unrelated database writers can never contend.
