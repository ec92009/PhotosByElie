# PBB-189 — Approve ready AI photos during a batch

Approve is now enabled per selected photo while Perform AI continues. Every selected batch photo must have metadata from the current fixture/run and, when requested, its exact rendered After. A mixed ready/unfinished selection is blocked. The approval reserves its own busy state before asynchronous work, so background refresh cannot unlock a duplicate approval. Hide, Reject AI, source changes, new AI and upload remain protected during the batch. Normal shutdown still waits for the active AI work.

The batch report stays visible above Review with ready-to-review, still-processing, attention-required and approved counts. Separate metadata and After progress remains visible. Accepting an item does not reset the batch or let later polls restore its consumed proposal. The completion query now includes the captured fixture; previously a fixture-local metadata result could be falsely reported as needing retry.

Validation: 428 Swift tests in 32 suites pass, including a ready metadata approval while another photo is processing, duplicate activation, mixed selection, fixture-scoped proposal queries, exact rendered After/source readiness, real isolated rendition promotion during an active batch, report count partitioning, retry isolation and shutdown protection. Test approvals use isolated fixtures; no real photo is approved, regenerated or uploaded for verification.

Release identity: v265.8 / build353. Installation, signature and visible UI receipt follow below.
