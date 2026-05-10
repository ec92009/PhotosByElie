# Photos By Elie TODO

Last updated: 2026-05-10

## Current Facts

- Local visible build: `v71.16`.
- Public Expo catalog validates in external media mode with `5,792` publishable photos: France `324`, USA `158`, Spain `169`, Mexico `2`, AI/Leonardo `4,920`, Portugal `217`, Slovakia `2`.
- The Expo cap is retired. Publish all eligible cloud-backed previews unless blocked/discarded or explicitly ineligible.
- Public previews are watermarked and public under flat R2 keys: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Buyer deliverables are private and unwatermarked: full developed sources under `masters/...`, JPG 1/3/6 MP files under `renders/...`.
- Uploaded masters, private render triplets, and public previews are treated as immutable media objects after upload. Owner edits change manifests/catalogs; the normal exception is blocked/discarded cleanup deleting media while keeping tombstones.
- RAW files are not for the public site or cloud storage. Developed sources only.
- Saturn is the upstream source for new developed photos:
  - Camera: `/Volumes/Saturn/Pictures/LR/Camera`
  - Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- Reserve is only an ignored local import/preview cache. It is not a long-term review state.
- Blocked/discarded photos are tombstoned. Their R2 media should be deleted for cost control, while the tombstone stays tracked so Saturn imports do not resurrect them.
- Daily automation `photosbyelie-daily-cloud-media-sweep` runs through `zsh -lc` to source `~/.zshrc` credentials and uses `.review-logs/cloud-media-sweep.lock` to prevent concurrent sweeps.
- Local Owner mutation endpoints are unlocked by `scripts/local_server.py` on localhost without a password.
- Owner Current state now reads `10,133` analyzed, `4,341` blocked, and `5,792` Expo photos. The earlier `18` stale local blocked records were removed from the ignored Owner state.
- Current R2 coverage targets active Expo photos and excludes blocked photos from the repair target. The generated discarded-media manifest is owned by the active sweep while it is running.
- Checkout remains guest-first and USD-only. Real Stripe is wired behind Worker configuration, but live payments are blocked until Stripe account setup, Worker secrets, webhook registration, and test-mode checkout verification are complete.
- Public-facing pages now have a shared English/French/Spanish translation layer. Owner-only localhost tooling intentionally remains English.

## Numbered Backlog

1. **Verify every zippable deliverable is in private R2.**
   - Drive `assets/private-delivery-manifest.json` to full non-discarded catalog coverage.
   - Confirm private masters settle to complete active-catalog coverage.
   - Confirm private JPG 1/3/6 MP tiers settle to complete active-catalog coverage.
   - Confirm every checkout-eligible photo has private full/JPG 6/JPG 3/JPG 1 MP delivery objects.
   - Spot-check that the Worker can build ZIP contents from private R2 keys, not local files.

2. **Continue Owner curation/blocking.**
   - Review visible catalog entries after R2 coverage is complete.
   - Block photos that should not be sold or shown before payment testing starts.
   - Keep block/discard decisions in tracked manifests so cloud cleanup and future Saturn imports respect them.

3. **Add gallery search.**
   - Add search on both public/end-user galleries and Owner review surfaces.
   - Search titles and keywords first; include filename, country/collection, and description as secondary matches.
   - Preserve current filters/sort/review context while search is active.
   - Keep search responsive on the full AI-heavy catalog.

4. **Add collection-wide keyword removal.**
   - Let Owner choose a collection and remove one keyword from every photo in that collection.
   - Update catalog metadata only; do not rewrite already uploaded masters, private renders, or public previews.
   - Show before/after counts and a confirmation preview before writing.
   - Keep an explicit publish step so the Worker catalog and public manifests receive the changed keywords.

5. **Make discard lifecycle first-class in Owner.**
   - Add an explicit Owner discard action separate from temporary block/review.
   - Create durable tombstones for discarded IDs.
   - Delete matching public previews, private masters, and private render JPGs from R2.
   - Keep tombstones in import/export validation so discarded photos cannot return from Saturn.
   - Show discard/delete counts in Owner so bulk quality/duplicate cleanup feels trustworthy.

6. **Add Owner price-list maintenance.**
   - Move digital-file and print/frame prices into an Owner-maintained price list instead of treating the current under-10 items as code constants.
   - Support adding, editing, disabling, and reordering price entries as the catalog of sellable products grows.
   - Keep checkout validation tied to the published price list so the Worker and public basket agree on SKU IDs, labels, currencies, and amounts.
   - Show a clear publish/version step for price changes before they affect buyers.

7. **Add optional Owner XMP sidecar save.**
   - Add a deliberate Owner button to write Lightroom-style XMP sidecars beside masters from manifest metadata.
   - Keep this separate from normal title/keyword/country edits so media and sidecars are not quietly rewritten.
   - Show counts, destination paths, and errors before/after the sidecar save.

8. **Set up Stripe test mode.**
   - Create/sign into the Stripe account from the Mac.
   - Configure Worker secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - Add the Stripe webhook endpoint for `/stripe-webhook`.
   - Keep live keys out until test mode proves the full flow.

9. **Run Stripe test checkout end to end.**
   - Test successful payment.
   - Test 3D Secure/authentication-required payment.
   - Test declined-card payment.
   - Confirm a verified `checkout.session.completed` webhook marks the order paid.
   - Confirm the Worker builds the ZIP from private R2 and the order page exposes the download.
   - Cover paid-but-ZIP-pending, expired download link, missing private asset, and retryable Worker error states.

10. **Make order records production-durable.**
   - Choose D1 vs KV for production order state, with D1 likely for queryable order records.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, ZIP key, and download timing.
   - Keep private R2 as delivery ZIP storage.
   - Rate-limit download links.

11. **Harden owner account/identity.**
   - Keep the localhost helper boundary as the current protection for local catalog/R2 actions.
   - Decide whether production Owner should use Cloudflare Access, a Worker-backed login, or another identity layer.
   - Rename `owner-auth.js` to reflect current reality, such as `owner-helper-session.js`, because it now checks helper availability rather than passwords.
   - Audit adjacent Owner naming that still says auth/login/session where the product behavior is really localhost helper availability.
   - Add clear confirmation around future discard/R2 delete actions.
   - Add browser smoke coverage for locked helper and unauthorized mutation states.

12. **Move public media off the checkout Worker bridge.**
   - Attach an R2 custom domain or equivalent public media endpoint.
   - Update `media-config.js`.
   - Retest GitHub Pages gallery/detail/basket media loading.
   - Keep the Worker focused on checkout/order/delivery, not public thumbnail serving.

13. **Design buyer accounts.**
   - Decide whether buyer accounts are optional convenience after guest checkout.
   - Model saved order lookup, re-downloads, email verification, and basic account recovery.
   - Keep guest checkout low-friction.

14. **Split homepage data from the full catalog.**
   - Replace the homepage `photos-data.js` dependency with a small homepage manifest.
   - Include only collection names, counts, links, and enough representative preview candidates for the hero stack and collection rail.
   - Keep the initial homepage payload focused on the 14 visible previews instead of the full `5,792`-photo Expo catalog.

15. **Split gallery/catalog data by collection.**
   - Generate per-collection public catalog files such as France, USA, Spain, AI, Portugal, Slovakia, and Mexico.
   - Load only the current collection catalog when opening a gallery page.
   - Keep shared public metadata separate from private delivery/Owner manifests.

16. **Harden browser smoke coverage.**
   - Cover gallery grid/fill/fit controls, sorting, filters, detail navigation, likes, basket, checkout, order status, and ZIP download path.
   - Include language-toggle smoke checks for English, French, and Spanish on homepage, gallery, basket, liked, and order pages.
   - Cover Owner block/discard, Unknown assignment, metadata save feedback, and failed-action recovery.
   - Add large-catalog load and lazy-loading checks so `photos-data.js` growth does not quietly slow the public gallery.
   - Keep public and localhost-only behaviors separate in tests.

17. **Extend Owner dashboard.**
   - Keep dense counts for catalog, private delivery coverage, discarded tombstones, blocked queue, unknown queue, and active sweep status.
   - Surface the latest automation/sweep result.
   - Add a guided curation command or Owner flow for ingest, classify, block/discard, assign, validate, and publish.
   - Make destructive actions legible before they run.

18. **Keep publish validation as the gate.**
   - Validate blocked/discarded exclusions.
   - Validate public preview to private delivery parity.
   - Validate sidecar/private-delivery/discarded-media manifests.
   - Add catalog/manifest consistency checks across `photos-data.js`, `worker/photos-catalog.generated.mjs`, sidecars, and delivery manifests.
   - Add generated JS/JSON payload size budgets for catalog and gallery performance.
   - Keep `npm run validate` mandatory before publish.

19. **Repair and refresh architecture artifacts.**
   - Document which manifests, generated catalogs, deploy artifacts, local caches, and ignored asset folders are sources of truth.
   - Fix the known page 4 text collision in the architecture PDF.
   - Refresh diagrams after account/auth/payment decisions settle.

20. **Backburner: repo layout cleanup.**
   - Keep root HTML files while GitHub Pages serves from repo root.
   - Revisit `site/`, `public/`, `js/`, or `css/` structure after media/payment paths stabilize.
   - Do a semantic filename pass after the product language settles: `hidden-*` files now power Blocked UI, and `owner-auth.js` now powers helper availability.
   - Keep compatibility redirects or careful cache-bust updates for any renamed public HTML/JS entrypoints.

## Completed Recently

- Fixed Back to gallery from detail so it restores the originating gallery, filters/sort context, selected photo, and scroll position.
- Retired the Expo cap and promoted the full cloud-backed catalog.
- Marked the manual cloud media sweep follow-up as finished and removed it from active backlog.
- Flattened public R2 preview keys.
- Added `assets/media-sidecar.json` provenance for public/private key mapping.
- Added `assets/private-delivery-manifest.json`.
- Added `assets/discarded-media-manifest.json`.
- Added private delivery backfill tooling.
- Added discarded-media R2 cleanup tooling.
- Added daily cloud media sweep automation with lock-guarded wrapper.
- Started a manual cloud media sweep with the same wrapper used by automation.
- Added localhost-only Owner helper endpoints for catalog, metadata, Blocked, Unknown, R2 progress, and R2 action endpoints.
- Added Owner R2 coverage counts with a repair button that starts the lock-guarded cloud media sweep.
- Wired real Stripe Checkout and webhook verification behind Worker configuration.
