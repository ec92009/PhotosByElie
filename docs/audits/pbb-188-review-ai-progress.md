# PBB-188 — Review AI batch progress

Review now reports title/keyword processing and rendered After readiness separately, each with its own total, remaining work, and attention-required count. The same message feeds the queue, inspector and action feedback. Counts start synchronously with the captured selection and retries use only their remaining component totals. Visual receipts refresh as a batch while metadata runs, and while waiting for After generation; only matching proposal, fixture and source-version identities are accepted. A failed progress refresh retains its last known counts with an explicit notice. Terminal metadata counts reflect verified ready proposals, never a claim that a timed-out or failed request processed every photo.

Validation: the complete Swift package suite passes (426 tests, 32 suites), including a running metadata pass, queued-to-ready After progress, partial failure, metadata-only work, selection interlocks and retry isolation. No production AI request, approval, upload or cancellation was initiated by this change.

Release candidate: v265.7 / build 352. Installation and running-app verification are deliberately deferred while the user-requested 63-photo build 351 AI batch runs. The user explicitly instructed “let that run.” The candidate must not replace or restart that running app. Tests establish source behavior; this is not yet installed verification.

Signed artifact produced from `f16926b4466d686d9bac85dfa7f68644ff8d7ca4`; strict codesign and isolated embedded-runtime preview checks passed. The standard release publisher verified the immutable archive and manifest by R2 readback and published v265.7/build352. Independent public URL verification through Python urllib returned HTTP 403, so public download usability is not verified. Installed build351 was left untouched. Ticket remains In Progress pending safe installed verification.

Follow-up: build352 was safely installed and observed on 2026-09-22 at 22:47 CEST once all jobs were terminal and build351 returned Ready. Same selected photo/proposals retained and Approve enabled. PBB-188 verified; superseded by build353 for PBB-189.
