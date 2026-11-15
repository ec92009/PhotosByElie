# PBE-217 catalog startup integration candidate

Source/test receipt, 2026-11-15. No deployment or authority-data change.
Parent owns ticket state, shared timelog/telemetry, integration and release.

## Prior work reconciliation

YouTrack REST reads returned HTTP 200 for PBE-217 (Active) and PBE-175 (Done).
PBE-175's completion comment explicitly limits completion to pushed source at
`c17105a7315b07177085f77a1c21ab0c21786fb0`, not main or deployment. Origin no
longer advertises `codex/pbe-175-gallery-startup`; GitHub's commit API resolved
that exact commit and fetching its full SHA succeeded. Its async binary fetch,
checksum, bounded concurrency, instrumentation, benchmark and tests were reused
rather than rebuilt. Only the relevant source/test patch was integrated onto
`618f9da211810a09fbc0aed88f6283ec0ba536aa`; old generated data/version values,
package-script ownership, HTML preload and historical audit were not imported.

Fresh anonymous reads of GitHub main and production `photos-data.js` both
returned the old synchronous implementation, SHA-256
`e089eded37ccb8257bb8297ea38499b0aa8dcdb34201fd4bd50d511372dbff27`.
This is a source-content receipt, not a deployed release acceptance.

## Integrated behavior and regressions fixed

- Fetch plain SQLite asynchronously as binary; verify exact bytes and SHA-256
  before decode. Also bind the public pricing/policy JSON, failing closed on
  missing, truncated or stale pricing instead of silently mixing generations.
- Capture the bootstrap's script URL/version before any await, preserving nested
  GitHub Pages asset resolution. A late legacy pricing fetch cannot overwrite
  the generation-bound product catalog (`photos.js` has one new guard line).
- Hold public media empty during loading. Contexts can select only visible IDs
  in the verified SQLite generation; their stale title, pricing or preview keys
  cannot replace canonical rows. Canonical collections win over old contexts.
  This preserves the original synchronous loader's exclusion of context-only
  IDs that are absent from SQLite; async scheduling must not authorize them.
- Reuse 100-ID batches with at most six in flight. Validate each response against
  its own batch, reject malformed/unknown identities, abort outstanding work and
  stop queued batches on failure. Install no partial catalog.
- Retain the newer `/photo.html?id=...` single-ID optimization. Recognize
  `document.body.dataset.photoId` only on generated `photo--<safe-id>.html`
  routes, using PBE-218's identifier grammar (alphanumeric first character,
  alphanumeric/underscore/hyphen thereafter, maximum 200 characters). Query `id`
  retains precedence. Unknown detail IDs request no authority and expose no row.
- Keep basket and authenticated shared-gallery mapping on canonical, visible
  products. No Worker API, catalog schema, provider or authorization rule changes.
  Batches remain point-in-time visibility reads, not a transactional snapshot;
  Worker media delivery still enforces revokes, including its post-R2-read fence.

`photosByElieCatalogTimings` reports download/checksum, SQLite initialization,
table query, projection, full decode, pricing transfer/checksum, lifecycle,
and first-gallery query/render/readiness. `firstGalleryReadyMs` ends after card
handlers and layout are installed, measured from bootstrap start. It does not
measure image paint. Timings are in-memory aggregate diagnostics, with no network
analytics or row-level telemetry. Decode/projection still run on the main thread;
actual phone measurements are required before deciding on further extraction.

## Small stable generator/data contract

The retained plain public SQLite schema is unchanged. SEO may continue reading
public `collections`, `media_items`, `media_assets`, `asset_types`,
`source_origins` and `media_types`, applying the existing public storefront
policy. `loadCatalogBundleFromSqlite(repoRoot)` in `scripts/catalog_tsv.cjs`
retains its `{ data, owner, productCatalog }` return shape; public consumers use
`data`, never Owner state. No browser bootstrap execution is needed to read it.

The optional new `catalogGenerationFor(repoRoot)` returns:

```js
{ schemaVersion: 1, path, bytes, sha256,
  pricing: { path, bytes, sha256 } }
```

Paths point only to `assets/catalog/photosbyelie.sqlite` and
`assets/catalog/product-pricing.json`. It only reads these public files and is
also embedded as `window.photosByElieCatalogGeneration`. PBE-218's SQL reader
needs no migration. Its commit `0753f4433e7fdd130ad0fd3fd376fb52b69928e2`
and `docs/seo/generated-public-entities.md` were inspected; no SEO source was
cherry-picked here. Generated-route loader coverage uses the agreed body-ID
contract; complete generated HTML hydration remains an integrated-release check.

## Checks and measurements

- Focused command below: **74 passed**, zero failed, including 16 startup tests.
  Covers generator idempotence without DB writes; stale/same-size/truncated/
  missing data; missing crypto/decoder; matching rollback and both mixed
  directions; async pending contexts; deny/revoke; malformed/cross-batch IDs;
  cancellation/no late publication; detail/generated routes; shared products;
  localhost bypass; and background pricing races.
- Final `npm test`: **32 pretests and 286 main JavaScript tests passed**.
  Python: **489 run, 487 passed, 2 failed**. The failures are unchanged native
  `NativeCullingParityTest.test_culling_preview_is_bounded_and_collapsible` and
  `test_window_and_preview_layout_persist_between_launches`. Both assert the
  missing legacy `cullingPreviewPanelVisibilityPreferenceKey` marker in unchanged
  `BackstageViewModel.swift`; neither the native source nor that test was edited.
  PBE-218 independently reports the same baseline failures.
- `npm run validate`: Swift contract current (41 operations, 14 schemas), then
  publish validation stops: `Owner authority missing/stale: pass an absolute
  reviewed Owner.sqlite snapshot with --owner-db or PHOTOSBYELIE_OWNER_DB.`
  No substitute authority was created and this check is not reported as passed.
- Changed JavaScript syntax checks and `git diff --check` passed. Two generator
  passes are byte-identical. SQLite and pricing checksums remain unchanged.
- Real headless Chrome at 390 x 844: localhost first-24-card readiness was
  291.7 ms cold and 283.9 ms warm, from bootstrap start. Warm catalog transfer
  size was zero. **Localhost skips lifecycle**, so these are not production times.
- Non-local HTTPS browser fixture with the real catalog and a mocked 30 ms
  authority: 54 lifecycle requests, peak six concurrent. Detail used one request
  for one ID; basket retained one selection at $65; revoked detail redirected to
  selection with the denied ID absent; a 503 left zero media and preserved raw
  basket storage. This is a scheduling/behavior rehearsal, not a live authority
  or phone benchmark. Routing disables browser cache, so repeats are not warm
  cache samples. Mocked images do not establish photo-paint performance.
- `node scripts/benchmark_public_gallery_startup.mjs` exited with a 20-second
  request `TimeoutError`; no aggregate live timing receipt was produced. Old
  PBE-175 speedup figures are not reused as fresh evidence. The reused benchmark
  now compares visible-ID digests as well as counts across runs.
- The forced failure browser rehearsal also reports an unhandled catalog-ready
  rejection from the existing shared-gallery readiness chain. Catalog remains
  empty and basket storage is unchanged. Customer recovery/promise handling
  should be verified in PBE-219; this candidate does not claim that UI work.

Aggregate samples are preserved in
`pbe-217-catalog-startup-timings.json`. These are desktop Chrome measurements at
a mobile viewport, not measurements on representative phone hardware.

```sh
node --test scripts/public_gallery_startup.test.mjs worker/non-revocable-public-assets.test.mjs worker/lifecycle-deny-store.test.mjs scripts/public_worker_origin_policy.test.mjs scripts/shared_gallery_integration.test.mjs scripts/pbe_customer_only_cutover.test.mjs scripts/photo_filter_search.test.mjs scripts/gallery_layout.test.mjs scripts/order_account_isolation.test.mjs
node scripts/write_catalog_tsv.cjs --bootstrap-only
```

The second command regenerates the bootstrap and home projection from existing
public inputs; it does not rebuild SQLite. Normal generator invocations without
`--bootstrap-only` retain their existing guarded projection behavior.

## Integration and release boundary

1. Integrate source into the parent's candidate, preserving its dirty changes.
   `photos.js` changes only the product-catalog application guard, far from
   PBE-218's SEO helper changes. No HTML, SEO markup, package script, allowlist,
   CI, shared timelog or telemetry file changed here.
2. PBE-216 should add `scripts/public_gallery_startup.test.mjs` to required
   checks, since the repository's `npm test` list is explicit. Keep both public
   catalog/pricing files in the artifact; exclude Owner.sqlite and private docs.
3. Assign the integrated release identity, validate the exact reviewed public
   SQLite against Owner authority, then regenerate bootstrap with
   `--bootstrap-only` and the SEO overlay. If reviewed SQLite or pricing bytes
   differ, regenerate their bindings; never copy an old checksum into a new
   artifact or silently rebuild the canonical DB to make a check pass.
4. Ship bootstrap, SQLite, pricing/policy, customer scripts and generated SEO
   routes as one tested artifact. Roll back that whole matching artifact.
   Mixed cache/deploy generations deliberately fail closed. No preload HTML
   change is required by this candidate.
5. Resolve the native baseline failures and missing reviewed Owner validation
   input in their owning scopes; rehearse generated HTML hydration, customer
   recovery and representative-phone cold/warm interaction/image readiness.
   After separately authorized publication, repeat live lifecycle and production
   browser measurements and record exact deployed identity/rollback receipts.

This candidate changes source and tests only. No deploy, main push/merge, provider
configuration, Owner/catalog mutation, purchase, customer message, ticket status
change or shared logging action was performed. PBE-217's production/device
acceptance gates remain open.
