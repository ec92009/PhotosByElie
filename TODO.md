# Photos By Elie TODO

Last updated: 2026-05-11

## Current Facts

- Local visible build: `v72.0`.
- Public Expo catalog validates in external media mode with `5,844` publishable photos: France `296`, USA `161`, Spain `223`, Mexico `2`, AI/Leonardo `4,920`, Italy `24`, Portugal `216`, Slovakia `2`.
- The Expo cap is retired. Publish all eligible cloud-backed previews unless blocked/discarded or explicitly ineligible.
- Public previews are watermarked and public under flat R2 keys: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Buyer deliverables are private and unwatermarked: full developed sources under `masters/...`, JPG 1/3/6 MP files under `renders/...`.
- Uploaded masters, private render triplets, and public previews are treated as immutable media objects after upload. Owner edits change manifests/catalogs; the normal exception is blocked/discarded cleanup deleting media while keeping tombstones.
- RAW files are not for the public site or cloud storage. Developed sources only.
- Saturn is the upstream source for new developed photos:
  - Camera: `/Volumes/Saturn/Pictures/LR/Camera`
  - Apple Photos album exports: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
  - Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- Apple Photos album stills should stay full pixel size when exported/imported. If we need explicit JPEG control, normalize to JPEG quality 90 without resizing after export; Photos AppleScript does not expose a reliable quality knob.
- Video import and presentation are not part of the current photo pipeline. Apple Photos mixed-album tests can export MOV files, but videos are backlog until we design 4K source handling, thumbnails, playback, storage, and checkout rules.
- `tmp/import-cache` is the ignored disposable import/render workspace. `assets/reserve` is retained only for localhost Reserve compatibility data; it is not a long-term review state.
- Blocked and discarded are separate tombstone concepts. Blocked hides a photo from galleries while leaving media in place until preview cleanup; discarded removes it from active catalog state and feeds R2 media cleanup while keeping a permanent do-not-resurrect record.
- Daily automation `photosbyelie-daily-cloud-media-sweep` runs through `zsh -lc` to source `~/.zshrc` credentials and uses `.review-logs/cloud-media-sweep.lock` to prevent concurrent sweeps.
- Local Owner mutation endpoints are unlocked by `scripts/local_server.py` on localhost without a password.
- Owner Current state now reads roughly `10,228` analyzed, `4,384` blocked, and `5,844` Expo photos after the recent Italy import; counts should be refreshed from generated state before launch decisions.
- Current R2 coverage targets active Expo photos and excludes blocked photos from the repair target. The generated discarded-media manifest should be updated by the sweep/cleanup tooling rather than hand-edited.
- Checkout remains guest-first and USD-only. Real Stripe is wired behind Worker configuration, but live payments are blocked until Stripe account setup, Worker secrets, webhook registration, and test-mode checkout verification are complete.
- Delivery ZIPs are flat: delivered image files sit at the archive root beside `ORDER.txt`, not inside per-photo folders.
- Public-facing pages now have a shared English/French/Spanish translation layer. Owner-only localhost tooling intentionally forces English when opened.
- Physical print/frame products are off by default for buyers; Owner has a deliberate localhost toggle for local review while product pricing/publishing is still backlog work.
- Homepage first render uses the tiny `home-data.js` manifest; the full `photos-data.js` catalog now downloads in the background for basket/liked context.
- Public previews are served directly from the `photosbyelie-public` `r2.dev` media endpoint; the checkout Worker is no longer on the browse-time preview path.
- Business priority is now revenue: make checkout trustworthy, package the offer clearly, drive qualified visitors, and keep Owner tooling focused on sales-enabling operations.

## Numbered Backlog

1. **Prove Stripe checkout in test mode.**
   - Create/sign into the Stripe account from the Mac.
   - Configure Worker secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - Add the Stripe webhook endpoint for `/stripe-webhook`.
   - Keep live keys out until test mode proves the full flow.
   - Test successful payment.
   - Test 3D Secure/authentication-required payment.
   - Test declined-card payment.
   - Confirm a verified `checkout.session.completed` webhook marks the order paid.
   - Confirm the Worker builds the ZIP from private R2 and the order page exposes the download.
   - Cover paid-but-ZIP-pending, expired download link, missing private asset, and retryable Worker error states.

2. **Make checkout and delivery production-durable.**
   - Choose D1 vs KV for production order state, with D1 likely for queryable order records.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, ZIP key, and download timing.
   - Keep private R2 as delivery ZIP storage.
   - Rate-limit download links.
   - Add receipts/order lookup language that tells buyers exactly where the ZIP will appear and how long it remains available.

3. **Package the buyer offer clearly.**
   - Decide the first public offer: digital-only single assets, bundles, or collection packs.
   - Make product labels buyer-facing: usage rights, resolution, what “Full resolution” means, and when AI-origin images are included or separated.
   - Rephrase basket/order language around “draft,” availability, manual review, and delivery so it builds trust rather than sounding provisional.
   - Add simple FAQ/help copy for licensing, personal/commercial use, delivery time, refunds, and contact.

4. **Publish a real price and offer strategy.**
   - Current state: Published defaults now distinguish original-photo digital prices from lower AI-origin digital prices, and Owner shows editable local table inputs for active digital tiers, print sizes, frame add-ons, and mock S&H prices.
   - Move the published defaults out of generated-code constants into a dedicated price-list data file shared by public basket and Worker validation.
   - Support adding, editing, disabling, and reordering price entries as the catalog of sellable products grows.
   - Keep checkout validation tied to the published price list so the Worker and public basket agree on SKU IDs, labels, currencies, and amounts.
   - Add business levers: launch pricing, bundle discounts, collection packs, “buy all liked,” and optional promo codes later.
   - Show a clear publish/version step for price changes before they affect buyers.

5. **Curate the first sellable storefront.**
   - Review visible catalog entries before paid traffic or launch outreach.
   - Block photos that should not be sold or shown.
   - Pick featured collections and hero images that make the site feel intentional, not merely complete.
   - Create buyer-friendly collection ordering: strongest commercial/travel/editorial sets first.
   - Keep block/discard decisions in tracked manifests so cloud cleanup and future Saturn imports respect them.

6. **Add conversion analytics.**
   - Track privacy-conscious funnel events: homepage view, collection view, search/filter use, like, add to basket, basket view, checkout started, payment completed, ZIP downloaded.
   - Track collection and product type so we learn what actually sells.
   - Add lightweight dashboards or reports for revenue, conversion rate, abandoned baskets, and top viewed/liked photos.
   - Keep local Owner activity out of buyer analytics.

7. **Improve public discovery and SEO.**
   - Add per-page titles, descriptions, Open Graph/Twitter images, canonical URLs, and image/collection metadata.
   - Generate a sitemap for homepage, collection pages, detail pages, and future high-value landing pages.
   - Add structured data where useful for image galleries/products.
   - Ensure titles and keywords support search-engine snippets without exposing Owner-only metadata.

8. **Create marketing landing pages.**
   - Build a few focused pages for likely buyers: travel/editorial licensing, wall art, AI imagery, country-specific photo sets, and “Photos By Elie” brand story.
   - Each page should lead directly to a relevant collection, liked flow, or basket action.
   - Use real images and concise copy rather than generic portfolio filler.
   - Add shareable URLs for launch emails, social posts, and direct buyer outreach.

9. **Prepare launch and sales outreach.**
   - Draft a short launch email and a buyer outreach note for travel/editorial/design contacts.
   - Create a social posting checklist for Instagram, Pinterest, LinkedIn, and direct shares.
   - Pick 10-20 standout images/collections for launch posts.
   - Add simple contact path for custom licensing, prints, or questions.

10. **Replace temporary `r2.dev` media URL with a custom media domain.**
   - Attach an R2 custom domain such as `media.photosbyelie.com`.
   - Update `media-config.js` from the temporary `r2.dev` URL to the custom domain.
   - Retest GitHub Pages gallery/detail/basket media loading and public hidden-blacklist fetches.
   - Keep the checkout Worker focused on checkout/order/delivery, not public thumbnail serving.

11. **Split gallery/catalog data by collection.**
   - Generate per-collection public catalog files such as France, USA, Spain, AI, Portugal, Slovakia, and Mexico.
   - Load only the current collection catalog when opening a gallery page.
   - Keep shared public metadata separate from private delivery/Owner manifests.
   - Treat this as a sales performance item: faster first gallery load means fewer buyers bounce.

12. **Improve gallery merchandising layout.**
   - Use a Pinterest-style masonry column layout for mixed panorama, landscape, square, and portrait photos.
   - Preserve the current density controls and fit/fill behavior while avoiding large visual holes between rows.
   - Prefer a deterministic client-side layout based on known preview dimensions so it does not reshuffle after images load.
   - Keep keyboard selection, Owner block/discard shortcuts, likes, and detail navigation stable when layout positions change.
   - Keep a future justified-row gallery as a separate buyer-polish idea, not the current target.

13. **Add buyer account or order recovery only if needed.**
   - Decide whether buyer accounts are optional convenience after guest checkout.
   - Prefer email-based order lookup before full accounts if that is enough for re-downloads.
   - Model saved order lookup, re-downloads, email verification, and basic account recovery.
   - Keep guest checkout low-friction.

14. **Decide when physical goods return.**
   - Keep physical print/frame products off by default while digital checkout is being proven.
   - Re-enable only when pricing, fulfillment, shipping, refunds, and customer support are clear.
   - Treat print/frame work as a higher-touch sales channel, not a blocker for digital launch.

15. **Replace keyword removal with Owner keyword cleanup modal.**
   - Replace the current narrow collection-keyword removal control with one Owner-page button for keyword cleanup across all countries plus AI.
   - Open a modal listing every current keyword with its photo count and a checkbox.
   - Include Done to close without changes.
   - Include Delete checked with a confirmation step before removing keywords from catalog metadata.
   - Apply deletes across all countries plus AI; do not rewrite already uploaded masters, private renders, public previews, or XMP sidecars.
   - Show before/after counts and refresh Owner counts/status after completion.

16. **Make country collections open-ended.**
   - Stop treating countries as a finite fixed code list in Owner workflows.
   - Let imports send photos with unknown/new geography into Unknown when they cannot confidently map to an existing collection.
   - In Owner Unknown assignment, show the current known countries plus `Other...` in the country selector.
   - When Owner chooses `Other...`, prompt for a new country name such as Greece, Morocco, Israel, or any older archive country we have not imported yet.
   - Create the new collection metadata, slug, Owner assignment target, public gallery route/data, homepage collection entry, translations, and styling from that Owner-provided country name.
   - Keep existing fixed-country behavior as the compatibility path until dynamic collection generation is designed safely.

17. **Add gallery multi-select Owner metadata edits.**
   - Allow Owner to select multiple gallery cards with Shift-click ranges and Command-click toggles.
   - Keep keyboard selection and single-card detail navigation understandable when multi-select is active.
   - Pressing `T` with multiple photos selected should open a batch title modal with clear behavior, likely either a shared replacement title or a structured title pattern before implementation.
   - Pressing `K` with multiple photos selected should add comma-separated keywords to every selected photo without replacing existing keywords.
   - Show selected count, before/after keyword effects, and confirmation for potentially broad edits.
   - Persist through the existing manifest-only Owner metadata path; do not rewrite uploaded masters, private renders, public previews, or XMP sidecars.

18. **Extend Owner operations dashboard.**
   - Keep dense counts for catalog, private delivery coverage, discarded tombstones, blocked queue, unknown queue, and active sweep status.
   - Add counters and refresh buttons to the Blocked sync / Delete blocked previews panel so Owner can see how many blocked IDs are published and how many blocked preview objects still need cleanup.
   - Surface the latest automation/sweep result.
   - Add a guided curation command or Owner flow for ingest, classify, block/discard, assign, validate, and publish.
   - Make destructive actions legible before they run.

19. **Harden owner identity and publish validation.**
   - Keep the localhost helper boundary as the current protection for local catalog/R2 actions.
   - Decide whether production Owner should use Cloudflare Access, a Worker-backed login, or another identity layer.
   - Rename `owner-auth.js` to reflect current reality, such as `owner-helper-session.js`, because it now checks helper availability rather than passwords.
   - Audit adjacent Owner naming that still says auth/login/session where the product behavior is really localhost helper availability.
   - Add clear confirmation around future discard/R2 delete actions.
   - Validate blocked/discarded exclusions, public-preview/private-delivery parity, sidecar/private-delivery/discarded-media manifests, catalog consistency, and payload size budgets.
   - Keep `npm run validate` mandatory before publish.

20. **Keep long-horizon media and repo cleanup on the backburner.**
   - Add a deliberate Owner button to write Lightroom-style XMP sidecars beside masters from manifest metadata when sidecar publishing becomes useful.
   - Decide whether videos are public gallery items, Owner-only review items, buyer deliverables, or a separate collection type.
   - Preserve 4K where available; determine whether that requires original video export rather than Photos' normal rendered export.
   - Generate video thumbnails/posters, duration metadata, orientation, codec/resolution fields, and gallery cards that do not confuse still-photo purchase flows.
   - Add R2 storage rules for public previews/posters and private video masters or deliverables.
   - Keep MOV/MP4 files out of the existing still-photo importer until this is deliberately implemented.
   - Keep root HTML files while GitHub Pages serves from repo root.
   - Revisit `site/`, `public/`, `js/`, or `css/` structure after media/payment paths stabilize.
   - Do a semantic filename pass after the product language settles: `hidden-*` files now power Blocked UI, and `owner-auth.js` now powers helper availability.
   - Keep compatibility redirects or careful cache-bust updates for any renamed public HTML/JS entrypoints.
   - Repair and refresh architecture artifacts after account/auth/payment decisions settle.

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
- Wired real Stripe Checkout and webhook verification behind Worker configuration.
- Moved public preview delivery off the checkout Worker bridge by enabling the public R2 `r2.dev` endpoint and pointing `media-config.js` at it.
