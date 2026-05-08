# Photos By Elie TODO

Last updated: 2026-05-08

## Current Facts

- Local visible build: `v67.11`.
- Public catalog validates in external media mode with 503 photos: AI 100, France 100, Portugal 100, Spain 100, USA 100, Slovakia 2, Mexico 1.
- Git should carry code, docs, generated metadata, and tiny shared assets. Public preview JPGs should not be committed.
- Public previews should live on R2/CDN as baked, strong-watermark files only.
- RAW/DNG/NEF files stay off public and private cloud storage. If a buyer wants RAW, they contact Elie directly.
- Hidden is a blacklist/review state, not a media folder contract. Re-promote means removing the ID from the blacklist.
- Future public R2 sync inventories skip IDs in `assets/hidden/hidden-blacklist.json`; private developed masters remain eligible unless Elie explicitly wipes them.
- `assets/reserve` remains an ignored local preview cache for importer/review compatibility, not a long-term public state.
- R2 upload journals are resumable. Cloudflare throttled parallel public/private uploads with `429 Too Many Requests`, so large R2 syncs should run one lane at a time.
- Public R2 active inventory was live-verified with zero missing active objects after the S3 backend repair pass; the bucket still has stale extra public objects to review before deletion.
- Private R2 is one object short of the local private inventory because `20220504 141310 00203.tif` timed out during upload.
- Checkout architecture now has a Worker-track prototype in `worker/`, using mock Stripe, in-memory storage, and a local ZIP delivery adapter for end-to-end mock checkout.
- Local mock checkout now reaches `basket -> Pay as guest -> Simulate Stripe payment -> order page -> Download ZIP / Copy ZIP path`.
- Public mock checkout now has a deployable Cloudflare Worker entrypoint using KV for durable mock order/download state and private R2 for full-resolution ZIP creation.
- Public mock checkout Worker is live at `https://photosbyelie-checkout-mock.ec92009.workers.dev`, backed by Cloudflare KV plus private R2.
- The public site config points checkout to the deployed Worker as of `v67.11`; GitHub Pages must finish serving the latest `main` commit before browser testing the cloud flow.
- Public previews are temporarily served through `https://photosbyelie-checkout-mock.ec92009.workers.dev/media/...`, backed by `photosbyelie-public`.
- First cloud mock checkout was verified by API with order `PBE-20260508-D054362044`; the Worker generated `deliveries/photosbyelie-order-PBE-20260508-D054362044.zip` in private R2 and returned a valid ZIP download.
- Order status now shows explicit mock checkout phases: payment, ZIP build, and download. Cloud ZIP generation failures persist as `delivery_failed`.
- The Worker now expects JPG 6/3/1 MP buyer files to exist in private R2 under `renders/...`; David should generate/upload those unwatermarked deliverables from the machine that owns the developed masters.
- Mixed full/JPG 6/3/1 MP API checkout was verified for test order `PBE-20260508-1D7B1CF611` after pre-rendering one test photo's private JPG deliverables.
- Safari downloads local mock ZIP files correctly; the built-in browser may not visibly surface attachment downloads, so the Local ZIP / Copy ZIP path fallback is intentional.
- Checkout v1 is USD-only and guest-first; accounts are optional convenience, not required payment friction.
- Current idle Cloudflare estimate remains about `$1.37/month` for a full quiet month, assuming roughly 100 GB private/public R2 storage and no meaningful traffic. Report cost changes after massive uploads and before/when starting recurring Worker tasks.
- The architecture PDF now includes an MSC-style checkout/fulfillment page and a non-destructive metadata overrides page, but page 4 still has a known text-overlap defect.

## Fresh Numbered Backlog

1. **Clean up public R2 leftovers after the successful S3 repair.**
   - [Codex] Review the 29 live public objects that are not in the active inventory.
   - [Codex] Confirm which extras are stale previews, hidden-blacklist objects, or old Unknown keys before deleting anything.
   - [Codex] Delete approved stale public objects through the S3 backend and verify `photosbyelie-public` again.
   - [Codex] Keep using `scripts/sync_r2_media.py --backend s3` for public repair work; Wrangler auth was unreliable.

2. **Finish private R2 masters.**
   - [Codex] Re-upload the one missing private object: `masters/20220504-141310-00203-231d78d849/20220504 141310 00203.tif`.
   - [Codex] Verify `photosbyelie-private` live against the private inventory after the retry.
   - [Codex] Keep private uploads single-lane and resumable through `.review-logs/r2-upload-state.jsonl`.

3. **Flatten R2 object key layout.**
   - [Codex] Stop using country folders in public or private R2 object keys; manifests already carry country/gallery metadata.
   - [Codex] Design a stable flat key scheme for public previews and private masters before the next major media migration.
   - [Codex] Update upload, cleanup, delivery, and validation scripts to treat country as metadata, not storage structure.
   - [Codex] Plan redirects or cleanup for existing country-prefixed R2 objects before changing published URLs.

4. **Adopt non-destructive owner metadata overrides.**
   - [Codex] Treat public previews and private masters as immutable media bytes by default, like RAW-editor negatives.
   - [Codex] Store owner title/keyword edits as structured overrides in `assets/owner-actions/metadata-overrides.json` plus an optional append-only journal.
   - [Codex] Merge original import metadata, country assignments, hidden state, and owner overrides during `photos-data.js` / manifest export.
   - [Codex] Stop automatically rewriting image IPTC/XMP or re-uploading R2 media for title/keyword-only edits.
   - [Codex] If cloud-side metadata is needed, upload small sidecar JSON/manifest shards instead of image binaries.
   - [Codex] Embed current title/keywords into temporary delivery copies only during ZIP creation, then discard the temp files.
   - [Codex] Keep any "bake metadata into files" or "refresh R2 media metadata" action explicit, rare, resumable, and S3-backed.

5. **Strengthen architecture boundaries and docs.**
   - [Codex] Document the responsibilities of public static viewer code, localhost-only owner tools, media pipeline scripts, and the commerce Worker.
   - [Codex] Move public preview delivery from the checkout Worker `/media/...` bridge to a dedicated R2 custom domain or public bucket domain.
   - [Codex] Keep public/local/Worker boundaries explicit in `README.md`, `worker/README.md`, `scripts/README.md`, `SUMMARY.md`, and this file.
   - [Codex] Write a short data dictionary for `photos-data.js`, media manifests, hidden blacklist, R2 journals, and review snapshots.

6. **Make publish validation the gate.**
   - [Codex] Expand `scripts/validate_publish.js` to enforce media key presence, hidden blacklist exclusions, Expo cap behavior, duplicate IDs, generated data consistency, and public/private eligibility.
   - [Codex] Add schema-style checks for manifests, journals, and generated publish data.
   - [Codex] Run validation before any publish or media sync handoff.

7. **Add browser smoke coverage.**
   - [Codex] Add Playwright smoke tests for gallery filtering, detail navigation, liked sync, basket sync, and public page loading.
   - [Codex] Make it possible to like/unlike photos directly from collection grid/card views, then cover that interaction in smoke tests.
   - [Codex] Update collection/gallery zoom so wide screens allow zoom levels 1 through 10 with no extra restriction, while narrow screens stay constrained to 1 through 4.
   - [Codex] Add localhost owner smoke tests for hide/unhide, hidden re-promote, unknown assignment, and metadata save feedback.
   - [Codex] Include missing-media, stale basket, empty-state, and failed-action recovery checks where practical.

8. **Improve owner dashboard and safer review UX.**
   - [Codex] Add dense owner summaries for counts, selected item, last action, undo availability, pending sync, hidden/unknown state, and publish eligibility.
   - [Codex] Add clearer batch previews and "what will publish" summaries before irreversible-feeling actions.
   - [Codex] Remove obsolete Reserve wording from visible owner UI as it appears.

9. **Harden the mock checkout flow.**
   - [Codex] Add account checkout UI only after guest checkout feels right.
   - [Codex] Expand basket copy/states so unsupported print items are clearly separate from digital ZIP delivery.
   - [Codex] Make the order page entry model explicit: buyers should normally land there only after mock/real payment, while unpaid direct-access states should read as exceptions.
   - [Codex] Browser-test mixed full/JPG 6/3/1 MP checkout after David generates/uploads the private render cache.
   - [Codex] Keep the local Worker default at `http://localhost:8787`, with `?workerBase=` override for testing.
   - [Codex] Add browser smoke coverage for the basket -> mock payment -> order page -> ZIP download path.
   - [Codex] Decide whether local mock orders need persisted JSON state so order lookup survives Worker restarts without relying on browser cache.
   - [Codex] Keep checkout errors clear when a selected JPG 6/3/1 MP private render is missing.

10. **Make Worker storage durable.**
   - [Codex] Use KV for public mock checkout state; choose D1 vs KV before production order records, with D1 still likely for queryable order state.
   - [Codex] Keep private R2 as the delivery ZIP location.
   - [Codex] Store order ID, buyer email, checkout session ID, payment intent ID, status, basket snapshot, expected/paid amount, ZIP key, and download timing.
   - [Codex] Keep download links rate-limited, starting with roughly one ZIP download per order per hour.

11. **Replace mock Stripe with real Stripe when account setup is ready.**
   - [Elie] Finish Stripe business, identity, tax, and bank onboarding.
   - [Codex] Add real Checkout Session creation behind the existing Stripe client interface.
   - [Codex] Add real webhook signature verification.
   - [Codex] Pass `client_reference_id`, `metadata.order_id`, buyer email, USD amount, and static receipt text with the order-portal URL.
   - [Codex] Keep Stripe receipts separate from PhotosByElie delivery emails/download links.

12. **Implement real delivery ZIP creation.**
   - [Codex] Replace mock delivery with R2/private master reads and ZIP creation.
   - [Codex] Decide whether ZIP creation runs synchronously in the Worker or through a queued/background flow for large orders.
   - [Codex] Preserve the current local `scripts/create_digital_delivery.py` as manual fallback until automated delivery is proven.
   - [Codex] Ensure the Worker never tries to deliver RAW/DNG/NEF originals.

13. **Add order lookup and delivery UX.**
   - [Codex] Add `/orders` buyer-facing page or static shell.
   - [Codex] Let guest buyers retrieve orders with order number plus email verification.
   - [Codex] Let account buyers see saved orders later, after guest checkout works.
   - [Codex] Show states: pending payment, preparing, ready, downloaded/rate-limited, failed/refunded.

14. **Keep checkout pricing conservative.**
   - [Codex] Keep all buyer-facing prices and Stripe amounts in USD for v1.
   - [Codex] Reject/ignore client-provided currency in the Worker.
   - [Codex] Recalculate prices server-side from the catalog before creating checkout.
   - [Codex] On webhook, require Stripe amount/currency to match the stored order before delivery.

15. **Repair and finalize architecture artifacts.**
   - [Codex] Fix the page 4 text collision in `photosbyelie-architecture-infographics.pdf`.
   - [Codex] Keep the MSC page as page 8 and the non-destructive metadata page as page 9 when regenerating the PDF.
   - [Codex] Consider adding a second MSC later for real delivery ZIP creation if Worker/queue/R2 details change.

16. **Retest local owner and media workflows.**
    - [Codex] Check gallery selection, Enter detail navigation, double-click detail navigation, H/U, and hidden re-promote on localhost.
    - [Codex] Check Unknown classification behavior and confirm same-day assignment still refreshes hints.
    - [Codex] Retest owner metadata persistence/background R2 resync now that the public S3 repair is complete.

17. **Keep documentation current.**
    - [Codex] Update `README.md`, `worker/README.md`, `scripts/README.md`, `SUMMARY.md`, and this file whenever the checkout or media contract changes.
    - [Codex] Convert architecture notes into a short migration SOP once R2 auth, Worker deployment, and public media URLs are settled.

18. **Backburner: clean up repo layout.**
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
