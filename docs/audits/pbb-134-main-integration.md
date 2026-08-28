# PBB-134 main integration audit

## Outcome

The canonical Backstage release train and the approved PBE-173 Owner catalog
reconciliation are integrated on `codex/pbb-134-main-integration`, based on
the unchanged public `origin/main` checkpoint `32b40ccc`. This is a source-only
integration: it does not deploy the storefront, install Backstage, promote a
build, or mutate public catalog data.

The integration was intentionally performed one branch at a time:

1. `origin/release/backstage` at `aeab11d3` was merged as `602ab306`.
2. `origin/codex/pbe-173-owner-catalog-reconciliation` at `43a906e7` was
   merged as `ee184882`.

The release merge preserved the three public-main commits for customer-only
cutover and analytics CORS delivery. Five conflicts were resolved to the newer
release-side architecture and test contracts; the affected test files were
strict supersets of the older main-side versions. Focused verification after
that resolution passed 31 JavaScript customer/session tests and 64 native
Culling parity tests.

## Branch dispositions

The recent branch inventory was compared against both the canonical release
tip and this integration branch.

- **Merged now:** `release/backstage` and
  `codex/pbe-173-owner-catalog-reconciliation`.
- **Already contained by the canonical release:** PBB-132, PBB-131 release,
  PBB-106 quit modal, PBE-172, PBE-171, PBE-170, PBE-155, PBE-169, PBE-143,
  PBE-144, the accepted PBE-164 release/preview work, PBE-168, PBE-165, and
  PBE-166. Their individual branches must not be merged again.
- **Preserved from public main:** PBE-164 customer-only cutover and PBE-167
  analytics CORS delivery. These are part of the integration base even though
  their tips are not ancestors of `release/backstage`.
- **Left separate because work is still active:** PBE-174 Cloudflare hosting
  evaluation, PBB-133 native Mac enrollment, PBE-98 outside-demand test, and
  PBB-106 connector/LaunchAgent retirement follow-up.
- **Left separate as superseded implementation branches:** pre-release Gallery,
  host, control-path, metadata, and recovery branches whose accepted outcome is
  represented by a later release branch or whose ticket is Fixed, Verified,
  Done, or Obsolete. Non-ancestry alone is not a reason to re-merge an older
  implementation over the canonical release.
- **Excluded by operating constraint:** no David-, Curie-, or Saturn-specific
  branch or validation path was used.

## Verification

- Repository pretests: 32 passed.
- Repository JavaScript tests: 267 passed.
- Repository Python tests: 466 passed.
- Native Swift package: 283 tests in 20 suites passed with
  `swift test --no-parallel`.
- PBE-173 focused reconciliation tests: 12 passed.
- Post-conflict focused tests: 31 JavaScript and 64 Python tests passed.
- Worktree status after verification: clean.

The first concurrent native run exposed wall-clock timing assertions under
test contention. Both reported tests passed in isolation, and the complete
supported non-parallel native run passed. No product change was made to mask a
test failure.

## Release boundary and rollback

The only authorized publication boundary for PBB-134 is a fast-forward update
of `origin/main` from the still-current checkpoint `32b40ccc` to this tested
integration. Before that push, fetch and verify that `origin/main` is unchanged,
that both source branches are ancestors of the candidate, and that the
candidate worktree is clean.

Rollback, if needed before any later deployment, is the prior public-main
checkpoint `32b40ccc`. Deployment, Backstage installation, build promotion,
and public data mutation remain separate gates.
