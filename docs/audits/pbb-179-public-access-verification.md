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

## Integrated checkpoint, 23 September 20:45 CEST

- Public contract `caefcf5f` is on main; native implementation `89a9c190`
  and complete reviewed-main merge `c72a9d24` are on release/backstage.
- Full Python discovery: 656 passed. Full Swift: 432 tests in 32 suites passed.
  Added migration rollback protection (schema setup never implicitly commits),
  fail-closed old-schema upload status, and packaged/standalone Python imports.
  Two inherited source-parity assertions now match the current UI text/signature.
- Post-merge npm ci and audit: zero vulnerabilities. JS pretest 56 passed;
  Python pretest 13 passed; main JS remains 303/304 with the same inherited
  catalog/bootstrap synchronization failure. This is a public-site artifact
  gate, not a native/Worker test failure; no validation bypass or catalog edit.
- Read-only publication validation still rejects missing reviewed Owner
  authority. Native contract generation check passes (API 1.3.0, 42 operations).
- Worker deployed from public main with unchanged bindings and preserved vars:
  `7beecbde-3369-4611-b632-fa65c3d39f5d`. Live 18:44 UTC checks returned
  200/allowed for an exact registered public pair, 200/identity-mismatch for a
  wrong canonical asset, and 401 unauthenticated; all no-store.
- Graphify refreshed in the canonical root, native-only/code-only scope,
  preserving its prior semantic backup. SQL-parser and partial Swift parser
  warnings are retained as graph limitations; Swift compilation is authoritative.

Next installable identity: v266.5/build 362. Build, installation and archive
publication remain separate pending steps at this source checkpoint.
