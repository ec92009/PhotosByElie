# Photos By Elie TODO

Last updated: 2026-05-08

## Current Facts

- Local visible build: `v67.22`.
- Public catalog validates in external media mode with 506 photos: AI 100, France 101, Portugal 100, Spain 102, USA 100, Slovakia 2, Mexico 1.
- Git should carry code, docs, generated metadata, and tiny shared assets. Public preview JPGs should not be committed.
- Public previews should live on R2/CDN as baked, strong-watermark files only.
- RAW/DNG/NEF files stay off public and private cloud storage. If a buyer wants RAW, they contact Elie directly.
- Hidden is a blacklist/review state, not a media folder contract. Re-promote means removing the ID from the blacklist.
- Future public R2 sync inventories skip IDs in `assets/hidden/hidden-blacklist.json`; private developed masters remain eligible unless Elie explicitly wipes them.
- `assets/reserve` remains an ignored local preview cache for importer/review compatibility, not a long-term public state.
- R2 upload journals are resumable. Cloudflare throttled parallel public/private uploads with `429 Too Many Requests`, so large R2 syncs should run one lane at a time.
- Public R2 active inventory was live-verified with zero missing active objects after the S3 backend repair pass. The 29 extra public objects were dumped intentionally; they can be re-uploaded later if ever needed.
- Every public preview, including TIFF-derived previews, should map to a full-size developed private source usable for delivery ZIPs. If the full-size source is intentionally skipped, its public preview should be removed or marked unavailable for buyer delivery; this includes the skipped low-value TIFF `20220504 141310 00203.tif`.
- Checkout architecture now has a Worker-track prototype in `worker/`, using mock Stripe, in-memory storage, and a local ZIP delivery adapter for end-to-end mock checkout.
- Local mock checkout now reaches `basket -> Pay as guest -> Simulate Stripe payment -> order page -> Download ZIP / Copy ZIP path`.
- Public mock checkout now has a deployable Cloudflare Worker entrypoint using KV for durable mock order/download state and private R2 for full-resolution ZIP creation.
- Public mock checkout Worker is live at `https://photosbyelie-checkout-mock.ec92009.workers.dev`, backed by Cloudflare KV plus private R2.
- The public site config points checkout to the deployed Worker as of `v67.11`; current UI/copy/media-key fixes are published through `v67.22`.
- Public previews are temporarily served through `https://photosbyelie-checkout-mock.ec92009.workers.dev/media/...`, backed by `photosbyelie-public`.
- Public preview keys are moving to a country-free R2 shape: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`. Original gallery/country provenance is preserved in `assets/media-sidecar.json`.
- First cloud mock checkout was verified by API with order `PBE-20260508-D054362044`; the Worker generated `deliveries/photosbyelie-order-PBE-20260508-D054362044.zip` in private R2 and returned a valid ZIP download.
- Order status now shows explicit mock checkout phases: payment, ZIP build, and download. Cloud ZIP generation failures persist as `delivery_failed`.
- The Worker expects JPG 6/3/1 MP buyer files to exist in private R2 under `renders/...`; David generated and uploaded the completed private render cache from local Saturn developed masters.
- Private buyer JPG render verification passed for the full current catalog: 506 photos, 1,518 expected render objects, 1,518 present, 0 missing.
- Mixed full/JPG 6/3/1 MP API checkout was verified for test order `PBE-20260508-1D7B1CF611` after pre-rendering one test photo's private JPG deliverables.
- Safari downloads local mock ZIP files correctly; the built-in browser may not visibly surface attachment downloads, so the Local ZIP / Copy ZIP path fallback is intentional.
- Checkout v1 is USD-only and guest-first; accounts are optional convenience, not required payment friction.
- Checkout result links and default site links now have explicit accessible contrast tokens; unpaid order-page copy now reads as an exception/direct-access state rather than the normal buyer path.
- Current idle Cloudflare estimate remains about `$1.37/month` for a full quiet month, assuming roughly 100 GB private/public R2 storage and no meaningful traffic. Report cost changes after massive uploads and before/when starting recurring Worker tasks.
- The architecture PDF now includes an MSC-style checkout/fulfillment page and a non-destructive metadata overrides page, but page 4 still has a known text-overlap defect.

## Fresh Numbered Backlog

1. **Enforce public preview to private delivery-source parity.**
   - [Codex] Verify every active public preview/catalog photo has a corresponding private developed master under `masters/...`.
   - [Codex] Verify every delivery-eligible photo has private JPG 6/3/1 MP render objects under `renders/...`.
   - [Codex] Remove or mark unavailable any public-preview photo whose full-size developed source is intentionally skipped, including TIFF-derived previews such as the low-value timed-out TIFF.
   - [Codex] Add publish validation so future public previews cannot ship without a matching private delivery source.

2. **Flatten R2 object key layout.**
   - [Done] Stop using country folders in public preview R2 object keys; manifests already carry country/gallery metadata.
   - [Done] Use stable flat public preview keys: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
   - [Done] Preserve original source, collection/country provenance, legacy public keys, private master keys, and private render keys in `assets/media-sidecar.json`.
   - [Done] Update upload/import/export and validation scripts to treat country as metadata, not storage structure.
   - [Codex] After the flat-key catalog is live and verified, decide whether to delete old country-prefixed public R2 preview objects or keep them as a temporary compatibility cushion.

3. **Adopt non-destructive owner metadata overrides.**
   - [Codex] Treat public previews and private masters as immutable media bytes by default, like RAW-editor negatives.
   - [Codex] Store owner title/keyword edits as structured overrides in `assets/owner-actions/metadata-overrides.json` plus an optional append-only journal.
   - [Codex] Merge original import metadata, country assignments, hidden state, and owner overrides during `photos-data.js` / manifest export.
   - [Codex] Stop automatically rewriting image IPTC/XMP or re-uploading R2 media for title/keyword-only edits.
   - [Codex] If cloud-side metadata is needed, upload small sidecar JSON/manifest shards instead of image binaries.
   - [Codex] Embed current title/keywords into temporary delivery copies only during ZIP creation, then discard the temp files.
   - [Codex] Keep any "bake metadata into files" or "refresh R2 media metadata" action explicit, rare, resumable, and S3-backed.

4. **Strengthen architecture boundaries and docs.**
   - [Codex] Document the responsibilities of public static viewer code, localhost-only owner tools, media pipeline scripts, and the commerce Worker.
   - [Codex] Move public preview delivery from the checkout Worker `/media/...` bridge to a dedicated R2 custom domain or public bucket domain.
   - [Codex] Keep public/local/Worker boundaries explicit in `README.md`, `worker/README.md`, `scripts/README.md`, `SUMMARY.md`, and this file.
   - [Codex] Write a short data dictionary for `photos-data.js`, media manifests, hidden blacklist, R2 journals, and review snapshots.

5. **Make publish validation the gate.**
   - [Codex] Expand `scripts/validate_publish.js` to enforce media key presence, hidden blacklist exclusions, Expo cap behavior, duplicate IDs, generated data consistency, and public/private eligibility.
   - [Codex] Add schema-style checks for manifests, journals, and generated publish data.
   - [Codex] Run validation before any publish or media sync handoff.

6. **Add browser smoke coverage.**
   - [Codex] Add Playwright smoke tests for gallery filtering, detail navigation, liked sync, basket sync, and public page loading.
   - [Codex] Make it possible to like/unlike photos directly from collection grid/card views, then cover that interaction in smoke tests.
   - [Codex] Update collection/gallery zoom so wide screens allow zoom levels 1 through 10 with no extra restriction, while narrow screens stay constrained to 1 through 4.
   - [Codex] Add localhost owner smoke tests for hide/unhide, hidden re-promote, unknown assignment, and metadata save feedback.
   - [Codex] Include missing-media, stale basket, empty-state, and failed-action recovery checks where practical.

7. **Improve owner dashboard and safer review UX.**
   - [Codex] Add dense owner summaries for counts, selected item, last action, undo availability, pending sync, hidden/unknown state, and publish eligibility.
   - [Codex] Add clearer batch previews and "what will publish" summaries before irreversible-feeling actions.
   - [Codex] Remove obsolete Reserve wording from visible owner UI as it appears.

8. **Harden the mock checkout flow.**
   - [Codex] Add account checkout UI only after guest checkout feels right.
   - [Codex] Expand basket copy/states so unsupported print items are clearly separate from digital ZIP delivery.
   - [Codex] Finish the order page entry model: buyers should normally land there only after mock/real payment, while unpaid direct-access states remain exception states.
   - [Codex] Browser-test mixed full/JPG 6/3/1 MP checkout against the completed private render cache on GitHub Pages/public Worker.
   - [Codex] Keep the local Worker default at `http://localhost:8787`, with `?workerBase=` override for testing.
   - [Codex] Add browser smoke coverage for the basket -> mock payment -> order page -> ZIP download path.
   - [Codex] Decide whether local mock orders need persisted JSON state so order lookup survives Worker restarts without relying on browser cache.
   - [Codex] Keep checkout errors clear when a selected JPG 6/3/1 MP private render is missing.

9. **Make Worker storage durable.**
   - [Codex] Use KV for public mock checkout state; choose D1 vs KV before production order records, with D1 still likely for queryable order state.
   - [Codex] Keep private R2 as the delivery ZIP location.
   - [Codex] Store order ID, buyer email, checkout session ID, payment intent ID, status, basket snapshot, expected/paid amount, ZIP key, and download timing.
   - [Codex] Keep download links rate-limited, starting with roughly one ZIP download per order per hour.

10. **Replace mock Stripe with real Stripe when account setup is ready.**
   - [Elie] Finish Stripe business, identity, tax, and bank onboarding.
   - [Codex] Add real Checkout Session creation behind the existing Stripe client interface.
   - [Codex] Add real webhook signature verification.
   - [Codex] Pass `client_reference_id`, `metadata.order_id`, buyer email, USD amount, and static receipt text with the order-portal URL.
   - [Codex] Keep Stripe receipts separate from PhotosByElie delivery emails/download links.

11. **Scale delivery ZIP creation beyond v1.**
   - [Codex] Decide whether ZIP creation stays synchronous in the Worker or moves to a queued/background flow for large orders.
   - [Codex] Keep `scripts/create_digital_delivery.py` as a manual fallback until automated R2 delivery is proven in public browser tests.
   - [Codex] Keep the Worker contract strict: deliver developed masters and private JPG renders, never RAW/DNG/NEF originals.

12. **Add order lookup and delivery UX.**
   - [Codex] Add `/orders` buyer-facing page or static shell.
   - [Codex] Let guest buyers retrieve orders with order number plus email verification.
   - [Codex] Let account buyers see saved orders later, after guest checkout works.
   - [Codex] Show states: pending payment, preparing, ready, downloaded/rate-limited, failed/refunded.

13. **Keep checkout pricing conservative.**
   - [Codex] Keep all buyer-facing prices and Stripe amounts in USD for v1.
   - [Codex] Reject/ignore client-provided currency in the Worker.
   - [Codex] Recalculate prices server-side from the catalog before creating checkout.
   - [Codex] On webhook, require Stripe amount/currency to match the stored order before delivery.

14. **Repair and finalize architecture artifacts.**
   - [Codex] Fix the page 4 text collision in `photosbyelie-architecture-infographics.pdf`.
   - [Codex] Keep the MSC page as page 8 and the non-destructive metadata page as page 9 when regenerating the PDF.
   - [Codex] Consider adding a second MSC later for real delivery ZIP creation if Worker/queue/R2 details change.

15. **Retest local owner and media workflows.**
    - [Codex] Check gallery selection, Enter detail navigation, double-click detail navigation, H/U, and hidden re-promote on localhost.
    - [Codex] Check Unknown classification behavior and confirm same-day assignment still refreshes hints.
    - [Codex] Retest owner metadata persistence/background R2 resync now that the public S3 repair is complete.

16. **Keep documentation current.**
    - [Codex] Update `README.md`, `worker/README.md`, `scripts/README.md`, `SUMMARY.md`, and this file whenever the checkout or media contract changes.
    - [Codex] Convert architecture notes into a short migration SOP once R2 auth, Worker deployment, and public media URLs are settled.

17. **Backburner: clean up repo layout.**
    - [Codex] Do this only after the R2 and checkout paths settle.
    - [Codex] Keep root HTML files for now while GitHub Pages serves directly from repo root.
    - [Codex] Later consider moving static assets into clearer `site/`, `public/`, `js/`, or `css/` folders.
    - [Codex] Keep top-level domains like `worker/`, `scripts/`, `docs/`, and `Archive/` clear and avoid adding more root-level files unless they are repo-level docs/config.

## Completed In This Session

- Added an MSC-style checkout/fulfillment infographic page.
- Rebuilt the architecture PDF as an 8-page deck.
- Added a mockable Worker checkout prototype with guest/account routes, mock Stripe, webhook handling, order lookup, delivery metadata, and download token rate limiting.
- Added Worker tests and documentation.
- Completed the public R2 S3 repair pass and live-verified zero missing active public objects.
- Added the non-destructive metadata overrides infographic page and rebuilt the architecture PDF as 9 pages.
- Wired the basket to local mock guest checkout and added local ZIP generation for mock paid orders.
- Added `order.html` with a proper mock order status and local ZIP download button.
- Added the order-ID ZIP fallback route and visible Local ZIP / Copy ZIP path fallback after the in-app browser hid attachment download feedback.
- Added a deployable public mock checkout Worker path with KV state and private R2 full-resolution ZIP delivery scaffolding.
- Updated private render tooling to prefer local Saturn developed masters and uploaded the full current catalog's private JPG 6/3/1 MP buyer render cache: 1,509/1,509 private render objects verified.
- Improved checkout contrast: the mock Checkout Session link and unscoped default links now use explicit accessible link colors in dark and light themes.
- Clarified unpaid order-page copy so direct access before payment reads as an exception instead of the normal post-payment flow.
- Retired the low-value timed-out private TIFF from the active R2 backlog.
- Removed the public-R2 extra-object cleanup from the active backlog after the 29 extras were dumped intentionally.
- Imported 3 more public photos and verified their private masters, private JPG 6/3/1 MP render objects, and public watermarked preview objects in R2.
- Marked v1 R2 ZIP creation as implemented; remaining delivery work is scale/queueing and public browser proof.
