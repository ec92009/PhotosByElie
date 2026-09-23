# PBB-179 — source and release evidence

Owner direction: 23 September 2026, finish PBB-179. Bilbao/Seville campaign
publication remains paused; this repair does not publish campaigns, upload
photos or register lifecycle identities.

## Behavior

- Upload receipts and catalog deployment remain separate from verified public
  access. Historical catalog-only entries are pending, never backfilled Live.
- Explicit **Verify public access (20)** checks at most 20 oldest observations
  in one selected fixture, with a two-minute batch-start budget. It never drains
  automatically, registers photos or re-uploads media.
- Current Owner approval/source, ancestor policies, deployed catalog, upload
  receipts and current R2-object evidence form an exact input snapshot.
  Public JPEG hashes must match. Lifecycle identity/bindings are checked before
  and after the byte reads with a stable revision/receipt fence.
- A local `public_access_observations` row is replaced idempotently per
  fixture/photo. `public_access_current` requires exact current inputs and an
  unexpired five-minute observation. Python counts and Swift customer links
  consume that same view. Missing older schema fails closed without a Swift
  migration. Failed or stale retries preserve existing uploads.
- Native counts expire even without another API call. The button latches
  synchronously, blocks conflicting cloud/update/fixture work, suppresses
  duplicate activation, and rejects stale cross-fixture results.

## Verification before build

- Public contract: 126 focused Worker/lifecycle/route tests; 118 commerce and
  Owner release checks; Wrangler dry run passes. Compatible Wrangler lock
  update to 4.137.0 removes three inherited high development-tool advisories;
  npm audit reports zero vulnerabilities.
- Public Python suite: 489 passed. Public full JS suite: pretest 56 passed;
  303/304 main tests passed. The inherited publication-authority integration
  fixture fails because the catalog-only publication at main 938296fb has
  newer IDs than its checked-in sidecar/bootstrap artifacts. This change does
  not alter that catalog or repair/redeploy public site artifacts.
- `npm run validate` was run read-only and refuses missing reviewed Owner
  authority (expected for an isolated checkout). No authority was invented.
- Native source: initial full Swift suite 430 tests/32 suites passed; two
  additional immediate-feedback/expiry tests pass. Seven new real-schema
  Python tests cover historical upgrade, private scope, exact bytes, retry,
  expiry, source/approval/policy changes and revocation during verification.

Build, installation, cloud deployment and live verification are separate
pending steps; no released/installed claim is made by this checkpoint.
