# PBB-181 — Review proposal count verification

Verified on 2026-09-20 in the signed personal Backstage v263.2 build342.
Installed source: `a64ad477ac0970bd60a00a8b93ff5e1b8c77c7f1`.

The previous badge and idle status used the global ready-proposal count while
Review filtered its items by fixture, states, search and RAW backing. The live
Owner database had two globally ready metadata proposals, but the selected
RE Marketing Review view had only one.

The native SQLite reader and Python fallback now return `availableProposals`
for the complete filtered queue before pagination. They count actual ready or
loaded proposals, independently of the editorial stage. The summary, badge
and idle status all use that count. Local approval, hide, metadata, undo,
unpick and Waste Basket changes reconcile the cached proposal count. Global
availability remains an internal refresh signal so new arrivals are discovered.
During Review refresh the feedback says “Refreshing Review availability…”
instead of retaining a count from the previous filters.

An empty result now says “No photos match these filters.” When Proposal
Available is selected, it explains that pending AI items are excluded and offers
“Include photos awaiting AI,” which turns off only that filter.

Validation:
- 24 Swift tests passed, including cross-fixture, hidden, pending, search,
  pagination, and scoped-versus-global status cases.
- The Python complete-queue proposal/media regression passed, including counts
  retained across pagination.
- Signed release compilation and isolated900/1800-pixel runtime preview smoke passed.
- Installed UI showed one matching item, one proposal ready, and one proposal
  available; a no-match search showed zero and the correct empty-state text.
- Proposal Available showed the pending-item explanation and its inclusion
  button; activating it cleared that filter while retaining the search.
- Final342 startup verified refreshed availability feedback rather than stale counts.
- All four checked records retained their raw metadata, editorial state,
  fixture decisions and source-version hashes. No photo workflow state was changed.

The previous installed bundle is retained at
`/Applications/.PhotosByElie Backstage.pre-342-20260920T103911.app`.
This direct personal install includes PBB-184 real visual generation. No public
site or cloud updater release is implied.
