# Photos By Elie TODO

Last updated: 2026-05-13

## Current Facts

- Local visible build: `v74.26`.
- Recovered Max review controls are in the current build: Basket, Liked, and Unknown show-more pagination; homepage Min size filtering; shared photo orientation helper; and added blacklist keywords.
- Public Expo catalog validates in external media mode with `5,844` publishable photos: France `296`, USA `161`, Spain `223`, Mexico `2`, AI/Leonardo `4,920`, Italy `24`, Portugal `216`, Slovakia `2`.
- The Expo cap is retired. Publish all eligible cloud-backed previews unless basketed/discarded or explicitly ineligible.
- Public previews are watermarked and public under flat R2 keys: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Buyer deliverables are private and unwatermarked: full developed sources under `masters/...`, JPG 1/3/6 MP files under `renders/...`.
- Uploaded masters, private render triplets, and public previews are treated as immutable media objects after upload. Owner edits change manifests/catalogs; the normal exception is Waste Basket/discarded cleanup deleting media while keeping tombstones.
- RAW files are not for the public site or cloud storage. Developed sources only.
- Saturn is the upstream source for new developed photos:
  - Camera: `/Volumes/Saturn/Pictures/LR/Camera`
  - Apple Photos album exports: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
  - Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- Apple Photos album stills should stay full pixel size when exported/imported. If we need explicit JPEG control, normalize to JPEG quality 90 without resizing after export; Photos AppleScript does not expose a reliable quality knob.
- Video import and presentation are not part of the current photo pipeline. Apple Photos mixed-album tests can export MOV files, but videos are backlog until we design 4K source handling, thumbnails, playback, storage, and checkout rules.
- `tmp/import-cache` is the ignored disposable import/render workspace. Reserve is manifest-only owner state, not a local preview folder.
- Waste Basket is the Owner-facing review surface for undesirable masters. Putting a basketed item back removes it from the blacklist. Emptying the basket purges public previews, private masters, and private render triplets, then leaves blacklist/discard tombstones so those masters do not return.
- Waste Basket cleanup progress is visible on the Owner card while R2 delete work is running; `Empty basket` is disabled during active delete jobs to avoid stacking duplicate purges.
- Daily automation `photosbyelie-daily-cloud-media-sweep` runs through `zsh -lc` to source `~/.zshrc` credentials and uses `.review-logs/cloud-media-sweep.lock` to prevent concurrent sweeps.
- Local Owner mutation endpoints are unlocked by `scripts/local_server.py` on localhost without a password.
- The Title/Keywords Owner review queue is helper-server backed. Rows autosave on approve/reject/comment/edit, Save approvals retries selected decisions, approvals apply generated catalog metadata and mark `Title_Keywords_Reviewed`, rejections update rework state, and saved rows are filtered out after leaving/reloading the page.
- Owner Current state recently read roughly `10,228` analyzed, `4,415` basketed/blacklisted, and `5,813` Expo photos; counts should be refreshed from generated state before launch decisions.
- Current R2 coverage targets active Expo photos and excludes Waste Basket photos from the repair target. The generated discarded-media manifest should be updated by the sweep/cleanup tooling rather than hand-edited.
- Checkout now validates selected private R2 masters/renders before opening Stripe, so buyers cannot pay for files that are not ready. Daily automation `Photos By Elie R2 master-chain repair` restores missing masters from Saturn/local sources first, repairs private render triplets, then prunes derivative ghosts from R2/manifests.
- Checkout remains guest-first and USD-only. Real Stripe is wired behind Worker configuration, but live payments are blocked until Stripe account setup, Worker secrets, webhook registration, and test-mode checkout verification are complete.
- Public cloud delivery uses per-file private download tokens instead of building one large ZIP in the Worker. Local mock delivery can still write flat ZIPs for test convenience.
- Public-facing pages now have a shared English/French/Spanish translation layer. Owner-only localhost tooling intentionally forces English when opened.
- Physical print/frame products are off by default for buyers; Owner has a deliberate localhost toggle for local review while product pricing/publishing is still backlog work.
- Print-on-demand sampling is required before physical products return publicly. Shortlist samples should cover US and Europe fulfillment quality, packaging, landed cost, API/integration fit, and support responsiveness.
- Homepage first render uses the tiny `home-data.js` manifest; the full `photos-data.js` catalog now downloads in the background for basket/liked context.
- Public previews are served directly from the `photosbyelie-public` `r2.dev` media endpoint; the checkout Worker is no longer on the browse-time preview path.
- Business priority is now revenue: make checkout trustworthy, package the offer clearly, drive qualified visitors, and keep Owner tooling focused on sales-enabling operations.
- Camera photos and AI-origin images are now split by first-class catalog origin. Public galleries can filter by origin, detail pages show it, Owner shows Camera / AI counts, and checkout pricing validates against origin.
- Waste Basket review now shares the same gallery-card treatment as public galleries, including wrapper/caption structure, RAW/origin badges, selection outline, 24-at-a-time paging, density preference, and fit/fill masonry behavior.
- Public collection pages now use the shared `gallery.html?gallery=<slug>` route; old country-specific gallery HTML files have been removed.

## Numbered Backlog

1. **Reconcile generated catalog and validation failures.**
   - `npm test` currently fails checkout pricing assertions.
   - `npm run validate` currently reports generated catalog/source-origin/public-preview key issues.
   - Inspect whether the failures are from uncommitted generated files, stale tests, or a real pricing/catalog regression.
   - Restore a passing baseline before committing any more generated catalog changes.

2. **Reconcile current Title/Keywords approval state.**
   - Review the dirty local owner-action state from live approval/rejection testing.
   - Decide whether to keep and commit `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`.
   - Resolve generated catalog/source-origin issues in `home-data.js`, `photos-data.js`, and `worker/photos-catalog.generated.mjs`.
   - Run `npm test` and `npm run validate`.
   - Commit only the intended owner-action/generated metadata files.

3. **Verify Waste Basket emptying on a safe test set.**
   - Use a tiny controlled basket set before running broad cleanup.
   - Confirm basket and put-back update the live blacklist immediately.
   - Confirm `Empty basket` queues deletion for public previews, private masters, and private render triplets.
   - Confirm emptied items leave durable tombstones and do not reappear after catalog regeneration/import.
   - Confirm `Put back` remains available before emptying and is not available after tombstone-only cleanup.

4. **Prove Stripe checkout in test mode.**
   - Create/sign into the Stripe account from the Mac.
   - Configure Worker secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - Add the Stripe webhook endpoint for `/stripe-webhook`.
   - Keep live keys out until test mode proves the full flow.
   - Test successful payment.
   - Test 3D Secure/authentication-required payment.
   - Test declined-card payment.
   - Confirm a verified `checkout.session.completed` webhook marks the order paid.
   - Confirm the Worker validates private R2 files before Stripe opens and the order page exposes paid per-file downloads.
   - Cover paid-but-delivery-pending, expired download link, missing private asset, and retryable Worker error states.

5. **Make checkout and delivery production-durable.**
   - Choose D1 vs KV for production order state, with D1 likely for queryable order records.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, delivery file keys, and download timing.
   - Keep private R2 as private delivery storage.
   - Add receipts/order lookup language that tells buyers exactly where downloads will appear and how long links remain available.

6. **Package the buyer offer clearly.**
   - Decide the first public offer: digital-only single assets, bundles, or collection packs.
   - Make product labels buyer-facing: usage rights, resolution, what “Full resolution” means, and when AI-origin images are included or separated.
   - Rephrase basket/order language around “draft,” availability, manual review, and delivery so it builds trust rather than sounding provisional.
   - Add simple FAQ/help copy for licensing, personal/commercial use, delivery time, refunds, and contact.

7. **Publish a real price and offer strategy.**
   - Current state: Published defaults now distinguish camera-photo digital prices from lower AI-origin digital prices, and Owner shows editable local table inputs for active digital tiers, print sizes, frame add-ons, and mock S&H prices.
   - Move the published defaults out of generated-code constants into a dedicated price-list data file shared by public basket and Worker validation.
   - Support adding, editing, disabling, and reordering price entries as the catalog of sellable products grows.
   - Keep checkout validation tied to the published price list so the Worker and public basket agree on SKU IDs, labels, currencies, and amounts.
   - Add business levers: launch pricing, bundle discounts, collection packs, “buy all liked,” and optional promo codes later.
   - Show a clear publish/version step for price changes before they affect buyers.

8. **Curate the first sellable storefront.**
   - Review visible catalog entries before paid traffic or launch outreach.
   - Apply and inspect the current 100-photo Title/Keywords approval batch, then regenerate the next queue to confirm `Title_Keywords_Reviewed` skipping works.
   - Block photos that should not be sold or shown.
   - Pick featured collections and hero images that make the site feel intentional, not merely complete.
   - Create buyer-friendly collection ordering: strongest commercial/travel/editorial sets first.
   - Keep block/discard decisions in tracked manifests so cloud cleanup and future Saturn imports respect them.

9. **Add conversion analytics.**
   - Track privacy-conscious funnel events: homepage view, collection view, search/filter use, like, add to basket, basket view, checkout started, payment completed, file downloaded.
   - Track collection and product type so we learn what actually sells.
   - Store raw paid-order facts durably enough to synthesize marketing reports on demand: order items, photo IDs, collection/country, source origin, product/format ID, unit count, line revenue, paid timestamp, and download events.
   - Prefer on-demand reporting from raw order/item/download records at first rather than maintaining denormalized per-photo or per-country sales counters that can go stale.
   - Report format performance by both headcount/units sold and revenue, including `full`, `jpg-6mp`, `jpg-3mp`, and `jpg-1mp`.
   - Report photo and collection performance by paid revenue, units sold, order count, and download count for marketing decisions.
   - Add lightweight dashboards or reports for revenue, conversion rate, abandoned baskets, and top viewed/liked photos.
   - Keep local Owner activity out of buyer analytics.

10. **Improve public discovery and SEO.**
   - Add per-page titles, descriptions, Open Graph/Twitter images, canonical URLs, and image/collection metadata.
   - Generate a sitemap for homepage, collection pages, detail pages, and future high-value landing pages.
   - Add structured data where useful for image galleries/products.
   - Ensure titles and keywords support search-engine snippets without exposing Owner-only metadata.

11. **Create marketing landing pages.**
   - Build a few focused pages for likely buyers: travel/editorial licensing, wall art, AI imagery, country-specific photo sets, and “Photos By Elie” brand story.
   - Each page should lead directly to a relevant collection, liked flow, or basket action.
   - Use real images and concise copy rather than generic portfolio filler.
   - Add shareable URLs for launch emails, social posts, and direct buyer outreach.

12. **Prepare launch and sales outreach.**
   - Draft a short launch email and a buyer outreach note for travel/editorial/design contacts.
   - Create a social posting checklist for Instagram, Pinterest, LinkedIn, and direct shares.
   - Pick 10-20 standout images/collections for launch posts.
   - Add simple contact path for custom licensing, prints, or questions.

13. **Replace temporary `r2.dev` media URL with a custom media domain.**
   - Attach an R2 custom domain such as `media.photosbyelie.com`.
   - Update `media-config.js` from the temporary `r2.dev` URL to the custom domain.
   - Retest GitHub Pages gallery/detail/basket media loading and public hidden-blacklist fetches.
   - Keep the checkout Worker focused on checkout/order/delivery, not public thumbnail serving.

14. **Split gallery/catalog data by collection.**
   - Gallery pages now use one real page, `gallery.html?gallery=<slug>`.
   - Old country-specific gallery HTML files have been removed.
   - Keep country-specific title/nav/body state in data rather than duplicated markup.
   - Generate per-collection public catalog files such as France, USA, Spain, AI, Portugal, Slovakia, and Mexico.
   - Load only the current collection catalog when opening a gallery page.
   - Keep shared public metadata separate from private delivery/Owner manifests.
   - Treat this as a sales performance item: faster first gallery load means fewer buyers bounce.

15. **Refine gallery merchandising layout.**
   - FIT mode now uses a deterministic masonry-style grid span layout for mixed panorama, landscape, square, and portrait photos.
   - Continue testing density controls and fit/fill behavior across very mixed collections.
   - Keep keyboard selection, Owner block/discard shortcuts, likes, and detail navigation stable when layout positions change.
   - Keep a future justified-row gallery as a separate buyer-polish idea, not the current target.

16. **Add buyer account or order recovery only if needed.**
   - Decide whether buyer accounts are optional convenience after guest checkout.
   - Prefer email-based order lookup before full accounts if that is enough for re-downloads.
   - Model saved order lookup, re-downloads, email verification, and basic account recovery.
   - Keep guest checkout low-friction.

17. **Decide when physical goods return.**
   - Keep physical print/frame products off by default while digital checkout is being proven.
   - Order POD samples before re-enabling buyer-facing prints or framed prints.
   - Sample the same stress-test set across shortlisted shops: one dark photo, one detailed architecture/travel photo, one saturated AI-origin image, and one black-and-white or neutral image.
   - Compare US/EU candidates from the research: Prodigi as the first automation candidate; Printful, Gelato, and theprintspace for cross-market sampling; WHCC as a premium US backup; WhiteWall or Saal Digital as premium Europe backups.
   - Score print quality, color accuracy, crop handling, frame quality, packaging, white-label presentation, shipping speed, landed cost, refunds/damage handling, and API/manual workflow fit.
   - Re-enable only when pricing, fulfillment, shipping, refunds, and customer support are clear.
   - Treat print/frame work as a higher-touch sales channel, not a blocker for digital launch.

18. **Replace keyword removal with Owner keyword cleanup modal.**
   - Replace the current narrow collection-keyword removal control with one Owner-page button for keyword cleanup across all countries plus AI.
   - Open a modal listing every current keyword with its photo count and a checkbox.
   - Include Done to close without changes.
   - Include Delete checked with a confirmation step before removing keywords from catalog metadata.
   - Apply deletes across all countries plus AI; do not rewrite already uploaded masters, private renders, public previews, or XMP sidecars.
   - Show before/after counts and refresh Owner counts/status after completion.

19. **Make country collections open-ended.**
   - Stop treating countries as a finite fixed code list in Owner workflows.
   - Let imports send photos with unknown/new geography into Unknown when they cannot confidently map to an existing collection.
   - In Owner Unknown assignment, show the current known countries plus `Other...` in the country selector.
   - When Owner chooses `Other...`, prompt for a new country name such as Greece, Morocco, Israel, or any older archive country we have not imported yet.
   - Create the new collection metadata, slug, Owner assignment target, public gallery route/data, homepage collection entry, translations, and styling from that Owner-provided country name.
   - Keep existing fixed-country behavior as the compatibility path until dynamic collection generation is designed safely.

20. **Add gallery multi-select Owner metadata edits.**
   - Allow Owner to select multiple gallery cards with Shift-click ranges and Command-click toggles.
   - Keep keyboard selection and single-card detail navigation understandable when multi-select is active.
   - Pressing `T` with multiple photos selected should open a batch title modal with clear behavior, likely either a shared replacement title or a structured title pattern before implementation.
   - Pressing `K` with multiple photos selected should add comma-separated keywords to every selected photo without replacing existing keywords.
   - Show selected count, before/after keyword effects, and confirmation for potentially broad edits.
   - Persist through the existing manifest-only Owner metadata path; do not rewrite uploaded masters, private renders, public previews, or XMP sidecars.

21. **Extend Owner operations dashboard.**
   - Keep dense counts for catalog, private delivery coverage, discarded tombstones, Waste Basket queue, unknown queue, and active sweep status.
   - Keep Waste Basket status, cleanup progress, and tombstone counts legible on the Owner page.
   - Surface the latest automation/sweep result.
   - Add a guided curation command or Owner flow for ingest, classify, block/discard, assign, validate, and publish.
   - Make destructive actions legible before they run.

22. **Harden owner identity and publish validation.**
   - Keep the localhost helper boundary as the current protection for local catalog/R2 actions.
   - Decide whether production Owner should use Cloudflare Access, a Worker-backed login, or another identity layer.
   - Rename `owner-auth.js` to reflect current reality, such as `owner-helper-session.js`, because it now checks helper availability rather than passwords.
   - Audit adjacent Owner naming that still says auth/login/session where the product behavior is really localhost helper availability.
   - Add clear confirmation around future discard/R2 delete actions.
   - Validate blocked/discarded exclusions, public-preview/private-delivery parity, sidecar/private-delivery/discarded-media manifests, catalog consistency, and payload size budgets.
   - Keep `npm run validate` mandatory before publish.

23. **Keep long-horizon media and repo cleanup on the backburner.**
   - Add a deliberate Owner button to write Lightroom-style XMP sidecars beside masters from manifest metadata when sidecar publishing becomes useful.
   - Decide whether videos are public gallery items, Owner-only review items, buyer deliverables, or a separate collection type.
   - Preserve 4K where available; determine whether that requires original video export rather than Photos' normal rendered export.
   - Generate video thumbnails/posters, duration metadata, orientation, codec/resolution fields, and gallery cards that do not confuse still-photo purchase flows.
   - Add R2 storage rules for public previews/posters and private video masters or deliverables.
   - Keep MOV/MP4 files out of the existing still-photo importer until this is deliberately implemented.
   - Keep file-download throttling intentionally minimal. Repeat downloads are currently allowed; do not add restrictions unless abuse or sales volume proves they are needed.
   - Keep root HTML files while GitHub Pages serves from repo root.
   - Revisit `site/`, `public/`, `js/`, or `css/` structure after media/payment paths stabilize.
   - Do a semantic filename pass after the product language settles: `hidden-*` files now power Blocked UI, and `owner-auth.js` now powers helper availability.
   - Keep compatibility redirects or careful cache-bust updates for any renamed public HTML/JS entrypoints.
   - Repair and refresh architecture artifacts after account/auth/payment decisions settle.

24. **Add an Owner state-table browser.**
   - Build an Owner-only view for the generated state artifacts, starting with `tmp/photo-state-tsv.tgz` / `tmp/photo-state-tsv/` and keeping SQLite as an optional local inspection backend.
   - Show available tables such as `photos`, `photo_states`, `keywords`, `r2_objects`, `photo_metadata`, camera/lens lookups, manifest files, collections, and Owner country-assignment audit tables.
   - Support table switching, column visibility, sorting, filters, quick search, row count summaries, and copy/export for selected rows.
   - Keep searches and filters in browser memory for the loaded TSV data; do not rely on SQLite indexes for the primary UI path.
   - Add photo-aware affordances where useful: open the public/Owner detail page, jump to collection, show R2 keys, and surface attention-style flags.
   - Keep this localhost/Owner-only and out of the public buyer bundle.

## Completed Recently

- Added gallery search on public/Owner gallery surfaces with title and keyword matching.
- Added an initial collection-wide keyword removal path for Owner; this should be replaced by the planned checkbox modal workflow.
- Split the homepage first render from the full catalog: `index.html` now uses `home-data.js` immediately and downloads `photos-data.js` in the background.
- Accepted the private R2 deliverable coverage / flat ZIP input check as done for now and retired it from the active backlog.
- Widened basket thumbnails to about half the row on desktop, with panoramas aligned to the top of the basket card.
- Made the local mock-checkout result action simulate payment instead of opening a fake mock Stripe URL.
- Added `g`/`G` gallery density keyboard shortcuts.
- Refreshed docs around media immutability, manifest-only Owner edits, Blocked terminology, and XMP sidecar maintenance as an explicit future Owner action.
- Fixed Back to gallery from detail so it restores the originating gallery, filters/sort context, selected photo, and scroll position.
- Retired the Expo cap and promoted the full cloud-backed catalog.
- Marked the manual cloud media sweep follow-up as finished and removed it from active backlog.
- Flattened public R2 preview keys.
- Added `assets/media-sidecar.json` provenance for public/private key mapping.
- Added `assets/private-delivery-manifest.json`.
- Added `assets/discarded-media-manifest.json`.
- Added private delivery backfill tooling.
- Added discarded-media R2 cleanup tooling.
- Made discard first-class: Owner galleries and the Blocked review page accept `D`, discarded photos get their own durable tombstone file, and cleanup/import tools no longer treat the blocked list as the discard list.
- Added daily cloud media sweep automation with lock-guarded wrapper.
- Started a manual cloud media sweep with the same wrapper used by automation.
- Added localhost-only Owner helper endpoints for catalog, metadata, Blocked, Unknown, R2 progress, and R2 action endpoints.
- Added Owner R2 coverage counts with a repair button that starts the lock-guarded cloud media sweep.
- Added first-class Camera / AI origin handling across gallery filters, detail metadata, Owner counts, and Worker checkout pricing.
- Wired real Stripe Checkout and webhook verification behind Worker configuration.
- Moved public preview delivery off the checkout Worker bridge by enabling the public R2 `r2.dev` endpoint and pointing `media-config.js` at it.
- Added pre-Stripe private delivery availability checks, repeatable per-file downloads, and daily master-chain repair/prune automation.
- Factored gallery card rendering into `gallery-card.js` and moved Blocked review onto the same card/masonry treatment as public galleries.
- Added the Title/Keywords Owner approval queue with compact rows, eager thumbnail loading, row autosave, side-by-side approve/reject, reject comments, explicit propagation, keyboard row selection, H/X block shortcuts, and saved-row filtering after page reload.
