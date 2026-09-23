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

## Installed and released acceptance, 23 September 2026

- Source: `b352bc35b626df45fe0ab37824da2ac1d8557422`, pushed to canonical
  `refs/heads/release/backstage`; clean-source provenance checked before and
  after the release compilation (86.20 seconds).
- Build **266.5 / 362**, arm64, minimum macOS 14, signed by
  `Apple Development: Elie Cohen (L9958JSM92)`, team `CB7FE399AL`.
  Strict/deep signature verification passed for the built and installed app.
  Sealed Owner runtime: 218 files; manifest SHA-256
  `e56f307f3665bdf05c55b753fa9d00adc92c5b8d15915b280805f32469e32da8`.
  Isolated runtime smoke produced both watermarked preview sizes successfully.
- Installed at `/Applications/PhotosByElie Backstage.app`; launched and
  visually verified v266.5/build 362. Normal quit respected the Gallery-loading
  prompt using Wait and Quit; no force termination. Previous signed build 361
  is retained at `~/Library/Application Support/PhotosByElie/Backstage/Rollback/PhotosByElie Backstage-v266.4-build361-before-PBB179.app`.
- Installed Uploads/Expo initially showed 344 catalog-deployed photos, zero
  fresh Live observations and zero Needs Upload. Clicking only **Verify public
  access (20)** latched immediately and disabled fixture/upload/deploy actions.
  At 18:50:35–18:50:38 UTC its supported local ledger recorded **11 pending
  identity-missing, 9 blocked identity-mismatch, 0 allowed, 0 failed**. The
  visible result explicitly retained uploads and instructed reconciliation,
  not re-upload. No new upload run was created. This is a bounded historical
  sample, not a claim about all photos or a registration repair.
- Installed Gallery **View as customer** on the selected uploaded Málaga
  tapestry photo refused the unverified link with the visible message
  "No verified public page for this photo in this fixture." No customer page
  opened. An initial desktop-control clipboard timeout cleared on reselecting
  the app; the final check succeeded. A separate transient Gallery cancellation
  banner appeared during navigation; no culling decisions were changed.
- Live Worker checks cover an approved exact pair, a wrong asset identity,
  nonexistent identity (pending), and unauthenticated denial. They performed
  no registration, private-object access or D1 mutation.
- Release archive and latest.json published using the canonical guarded
  publisher. At **2026-09-23T18:52:18.875Z**, both public HTTPS downloads returned
  200; archive size **13,932,264 bytes**, exact SHA-256
  `da551579b50b14353522ff8654b117cad3274671c97405c25d93ffb47536a96d`.
  [Release archive](https://download.photos-by-elie.com/backstage/releases/PhotosByElie-Backstage-v266.5-build-362.zip)
  and [update manifest](https://download.photos-by-elie.com/backstage/releases/latest.json).
- Final committed-source Python rerun: **656 passed**; Swift **432 / 32 suites**.
  The unrelated public-site catalog/bootstrap validation failure above remains
  reported, not waived or fixed by this native ticket.

PBB-179's false-Live boundary is implemented and installed/live verified.
Historical registration reconciliation is separate work. Bilbao/Seville
campaign publication and the daily FIFO remain paused; no next ticket started.
