# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v78.20`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, AI, Italy, Portugal, Slovakia, and Featured on Pinterest entries
- `campaign.html`: first-party social/Pinterest mini-collection landing page that keeps visitors on Photos By Elie instead of a single-photo dead end
- `gallery.html`: shared gallery shell that reads the active collection from `?gallery=<slug>`
- `owner-review.html`: shared localhost-only Owner review shell for Unknown classification, Waste Basket review, and Title/Keywords review
- `photo.html`: reusable photo detail page; product checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with fixed commerce header controls and a pinned total band
- `liked.html`: localStorage-backed liked photos page with fixed commerce header controls; basketed photos are automatically liked
- `real-estate.html`: private real-estate review workspace that loads a public-safe client context on GitHub Pages or an ignored local import bundle on localhost, supports album filtering, selection, title edits, and browser/share-sheet-friendly selection table export
- `owner.html`: localhost-only owner controls for live review actions, Unknown classification, Waste Basket review, metadata sync, and R2 maintenance
- `owner-auth.js`: localhost helper availability client for catalog and cloud maintenance actions
- `basket-store.js`: shared basket source-of-truth helpers for detail and basket pages
- `liked-store.js`: shared liked-photo source-of-truth helpers for detail and liked pages
- `hidden-actions.js`: localhost-only live review action store for Waste Basket blacklist changes, undo, and owner assignment state
- `hidden-store.js`: localhost-only loader for the ignored basketed-photo catalog used by Waste Basket review and basketed-photo detail pages
- `hidden-page.js`: localhost-only Waste Basket review grid
- `basket-rail.js`: compact wide-screen basket rail for browsing and photo detail pages
- `home-data.js`: tiny homepage manifest with collection counts and representative preview candidates
- `photos-data.js`: small generated browser bootstrap that exposes shared collection, photo, product option, and price data
- `assets/catalog/photosbyelie.sqlite`: compact SQLite catalog for the public catalog source of truth
- `home-catalog-loader.js`: homepage-only background loader for the full catalog and basket rail
- `home-discovery.js`: homepage-wide search, origin, collection, filter results, likes, keyboard selection, detail navigation, and localhost Owner shortcuts
- `gallery-card.js`: shared gallery/review card renderer used by public galleries and Waste Basket review
- `campaign.js`: social mini-collection renderer, embedded-browser escape warning, and campaign-local archive search
- `photo-gallery.js`: shared gallery renderer
- `photo-detail.js`: shared detail page, real-image preview support, and automatic basket sync
- `basket.js`: basket rendering, item removal, resolution reselection, delivery availability pruning, and sticky total updates
- `liked.js`: liked page rendering, unlike actions, and resolution selection into the basket
- `real-estate.js`: private client-gallery controller for Real Estate album filters, selected-photo draft state, editable PDF titles, selection table loading/export, and legacy batch JSON loading
- `media-config.js`: public-media base URL configuration for GitHub Pages/R2 preview delivery
- `worker/`: mockable Cloudflare Worker-track checkout and fulfillment prototype
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme, translation dictionary, and language toggle behavior for public pages
- `site-version.js`: appends the current visible version to same-site page navigation to avoid stale cached HTML
- `scripts/catalog_tsv.cjs`: legacy-named shared Node catalog loader that now reads the public SQLite catalog for tools and tests
- `scripts/write_catalog_tsv.cjs`: legacy wrapper that rewrites the browser bootstrap and rebuilds the public SQLite catalog artifacts
- `scripts/build_public_catalog_db.py`: rebuilds the compact public SQLite catalog at `assets/catalog/photosbyelie.sqlite`
- `scripts/validate_publish.js`: pre-push SQLite catalog, asset-pair, resolution metadata, and publish-summary check
- `scripts/build_photo_state_db.py`: builds ignored SQLite state database at `tmp/photo-state.sqlite` from the catalog, import cache, blocked/discarded tombstones, owner actions, sidecars, and R2 logs
- `scripts/watch_photo_state_db.zsh`: optional local background refresher for the SQLite state database
- `AGENTS.md`: repo-level working preferences and versioning SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations, including versioning and Lightroom image ingestion
- `assets/`: shared By Elie logo asset, publish metadata, tiny placeholders, and ignored localhost compatibility/Waste Basket working data
- `assets/owner-actions/Owner.sqlite`: ignored local Owner workflow database for review queues, decisions, blacklist, and country assignment state

## Preview

Use the GitHub Pages URL above after pushing to `main`.

## Current Behavior

- Public collections are ordered France, USA, Spain, Mexico, AI Images, Italy, Portugal, and Slovakia.
- Catalog photos now carry a first-class `sourceOrigin` value (`camera` or `ai`). Gallery filters, detail metadata, Owner counts, price tiers, and Worker checkout validation all use that origin instead of relying only on the `ai` collection slug.
- Unknown photos are no longer presented as a public country-style collection; localhost Owner gets a dedicated classification queue.
- Unknown classification assigns every loaded unknown photo from the same capture day when one photo is assigned to a country, then removes assigned photos from the visible queue.
- Owner Unknown counts show only photos that still need a country assignment; photos already assigned or basketed no longer reduce unrelated counts.
- The homepage loads `home-data.js` first so the hero/collections render from a tiny manifest, then `home-catalog-loader.js` fetches the full catalog bootstrap in the background for basket/liked context.
- The homepage includes a Featured on Pinterest section. These campaigns are durable first-party landing pages for Pinterest/social traffic, starting with `campaign.html?c=pinterest-invalides-2026-05-14`.
- Campaign pages reuse the same shared gallery masonry controller as regular collections, so Grid density plus Fit/Fill behavior stay consistent.
- The full public catalog attempts `assets/catalog/photosbyelie.sqlite.br` first when it is served as decoded SQLite by the host/CDN or browser raw Brotli decoding is available, with plain `assets/catalog/photosbyelie.sqlite` as the guaranteed fallback. The SQLite catalog uses compact integer lookup ids for controlled vocabulary fields. Current active public catalog count is `5,827` media rows.
- The homepage hides the decorative hero photo stack on narrow or short viewports so the collection carousel stays visible instead of competing for vertical space.
- The homepage now has the global discovery controls before Collections, including search, collection, camera/AI origin, orientation, color mood, subject, and sort. Filtered results render 24 at a time with a full-match count and gallery-style hearts, keyboard selection, detail navigation, and localhost Owner shortcuts. Collection galleries keep local refinement but no longer show the redundant camera/AI origin selector.
- Gallery pages load the publishable Expo subset from the public SQLite catalog through the `photos-data.js` bootstrap; public GitHub Pages builds resolve preview media through `media-config.js` and each catalog row's `media.publicPreview` R2/CDN key instead of relying on committed media assets.
- Public previews currently resolve directly through the public R2 `r2.dev` media endpoint backed by `photosbyelie-public`; move `publicBaseUrl` to a custom media domain when that is attached.
- Local preview asset folders are retired. Public previews should resolve from R2/CDN keys; use `node scripts/validate_publish.js --external-media` for that publishing mode.
- R2 media uploads should run through the lock-guarded sweep wrapper, `scripts/run_cloud_media_sweep.zsh`, or otherwise one lane at a time. The wrapper uses `.review-logs/cloud-media-sweep.lock` so the daily automation and manual runs do not race each other.
- Public R2 sync and Saturn imports skip IDs from Waste Basket and discarded tombstones, so rejected or owner-discarded photos are not reintroduced by later bulk uploads. Publish validation now fails if a discarded/tombstoned id leaks into the public catalog or `assets/expo-manifest.json`.
- `tmp/import-cache` holds disposable import manifests and watermarked derivative files on their way to R2. Reserve is a manifest-only owner state, not a local preview folder. Waste Basket is a blacklist/review state, not a file location.
- Imports scan developed JPG/TIFF photo exports and MOV/MP4/M4V video exports, keep Camera photos at Lightroom green label/rating 4+, treat Apple Photos album exports under `/Volumes/Saturn/Pictures/LR/Apple Photo Albums` as selected by folder membership, infer country/AI/Unknown buckets, and write watermarked photo `*_900.jpg`/`*_1800.jpg` pairs plus video `*_900.jpg`/`*_short_5s_720p.mp4` previews into `tmp/import-cache` before upload. RAW/DNG/NEF files are not public-site or cloud-storage inputs.
- On localhost, `H` or `X` sends a live-gallery photo to the Waste Basket by adding it to the master blacklist, `U` undoes the most recent basket action, and `P` on the Waste Basket page puts a basketed photo back by removing it from the blacklist. Purging Waste Basket R2 copies deletes the media objects only and writes permanent tombstones; a banned photo stays banned. `D` is the stronger discard action: it removes the photo from active catalog state, writes `assets/discarded/discarded-photo-ids.json`, and queues R2 deletion for matching public previews, private masters, and private render JPGs.
- On localhost gallery/detail pages, Owner can edit Title and Keywords; saves update the catalog metadata and generated Worker catalog used by checkout deliverables. Source-file embedded metadata is left alone because catalog manifests are the authoritative title/keyword source.
- On the localhost Title/Keywords review page, Owner can review the current proposal batch, single-click to select a row, double-click for detail, approve with `A`, reject with `R`, propagate with `P`, and basket with `H`/`X`. Rows autosave through the helper server; approved rows apply title/keyword values to generated catalog metadata/state files and add `Title_Keywords_Reviewed`, while rejected rows record rework state/comment in `proposed-state.json`. Saved A/R rows remain visible during the current session and disappear after leaving/reloading; basketed rows disappear immediately. Source-file embedded metadata, public previews, private masters, and private render files are left untouched.
- `assets/owner-actions/keyword-blacklist.json` is the owner-maintained list of useless keyword strings. Import and export scripts omit those strings from generated keyword metadata and keyword indexes only; the list must not block media, discard media, or rewrite source-file metadata.
- Basketed photos do not re-upload public preview objects while they are blacklisted.
- Basket checkout treats discarded/Waste Basket tombstones as unsellable and currently prunes stale localStorage selections for missing private masters or JPG triplets before payment-sensitive flows. The target delivery model keeps four photo flavors for sale: 1 MP JPG, 3 MP JPG, 6 MP JPG, and full original/developed asset. Videos are full-original delivery only.
- On the localhost Unknown page, cards show title/keyword metadata, same-day unknown counts, day-before/day-after known-country context, and previous/next shooting-day context with relative day distance; arrow keys move the selected card, `H` or `X` baskets it, `U` undoes the last basket action, and double clicking a thumbnail opens a full-screen preview that dismisses on click.
- Assigning an Unknown photo to a country updates every loaded same-day unknown into that country in the local catalog/preview cache, adds the country keyword to catalog metadata, refreshes the Unknown hints, and removes assigned cards from the queue. Owner metadata actions do not rewrite uploaded masters, private render triplets, or public previews; those media objects are treated as immutable after upload except when Waste Basket or discarded media are explicitly deleted.
- Unknown country assignments are written to the local SQLite owner-state tables first, then exported back to the tracked JSONL trail and compact JSON index used by static/browser compatibility paths.
- We are walking away from the old Curation Pass model: localhost Owner actions are live state changes, and any exported `.pbe-review` file is only an audit/batch snapshot.
- The localhost preview can be served by `python3 scripts/local_server.py 8000`, which keeps the public site static while adding localhost-only endpoints for review snapshot saving, Waste Basket updates, Unknown assignment, metadata edits, and R2 maintenance.
- Local owner mutation endpoints are unlocked on localhost by the helper server without a password. For private-LAN owner review, start the server with `--bind 0.0.0.0 --allow-lan-owner`; without that opt-in, owner helper endpoints remain loopback-only.
- The Owner dashboard summarizes tracked R2 coverage for private masters, private JPG 1/3/6 MP deliverables, and public preview assets; its Fix it button starts the same lock-guarded cloud media sweep used by manual and scheduled backfills. Coverage excludes Waste Basket tombstones from active repair targets and can surface active media missing private masters or photo triplets, preferring Saturn/source-file repair when possible. The new R2 target is `expo/<media-id>_900.jpg` for `still_900`, `expo/<media-id>_1800.jpg` for photo `still_1800`, `expo/<media-id>_short_5s_720p.mp4` for video detail previews, `renders/<media-id>_{1,3,6}mp.jpg` for sellable photo JPGs, and `masters/<media-id>.<format extension>` for full delivery.
- Every page has the shared footer band; the Owner link appears only on localhost.
- On gallery pages, `g` makes the grid less dense/larger and `G` makes it denser/smaller; on localhost, single click moves the selection rectangle, Enter or double click opens detail, and the Grid slider adjusts thumbnail density within the current viewport limits.
- Gallery filters cover orientation, camera/AI origin, color mood, and subject, with Sort defaulting to Newest first on first display.
- When a photo detail page is opened from a gallery, Previous/Next follows that gallery's current filtered and sorted grid order.
- Subtle keyboard reminders appear above localhost review grids and detail previews, with public detail pages showing the `L` like shortcut.
- Gallery FIT mode uses a deterministic masonry-style grid span layout from known preview dimensions, preserving density controls, keyboard selection, Owner actions, likes, and detail navigation while reducing row holes. Fill mode remains the square cropped view.
- Waste Basket review now uses the same shared gallery card treatment as public galleries: card wrapper, image/caption structure, RAW/origin badges, selection styling, density preference, and fit/fill masonry behavior.
- Public collection cards open the shared `gallery.html?gallery=<slug>` route; the old country-specific gallery HTML files have been removed.
- Gallery and Owner review cards can show a small `RAW` overlay when legacy/local metadata identifies a DNG/NEF/other raw original, but RAW-origin previews are not eligible for Expo or public media upload.
- Homepage representative samples refresh after all public country cards have been active once in the carousel.
- Any visible collection carousel card can be clicked to open its gallery, even when it is not the foreground card.
- The Expo cap is retired. The exporter now publishes all eligible cloud-backed previews unless they are blocked/discarded or otherwise ineligible.
- `scripts/export_photos_data.py --external-media` regenerates `home-data.js`, the public SQLite catalog artifacts, and the small `photos-data.js` bootstrap from the local import manifest and tracked owner state without committing preview media files.
- The basket is the source of truth for selected product options.
- Likes are stored separately from basket selections, so a photo can be liked before any resolution is chosen; adding a photo to the basket also keeps it liked.
- Wide screens show a compact right-side basket rail while browsing photos and collections.
- Basket rail actions include both Open basket and Liked.
- The basket page has a reduced hero, fixed header action controls, and a pinned product total band that remains visible while scrolling.
- The liked page mirrors the basket layout, with fixed header action controls; rows come from hearted photos and totals count only selected products.
- The liked page includes bulk selectors for Full, JPG 6 MP, JPG 3 MP, and JPG 1 MP resolution choices.
- Public-facing pages share a client-side English/French/Spanish translation layer. The header language button cycles languages, persists the selected state, and translates public navigation, homepage copy, gallery controls/statuses, detail actions, basket/liked flows, and order-status copy. Owner-only tools remain English; the Owner language button beeps instead of switching.
- Detail pages start with no product checked unless that photo is already in the basket.
- Social/Pinterest campaign, basket, and order pages detect common embedded social browsers and show an immediate Open in browser / Copy link escape path before checkout or download-sensitive actions.
- Detail pages support previous/next buttons and left/right arrow keys that continue across collection boundaries on both public and localhost builds.
- Detail pages support `L` to like/unlike and double click on the preview to open a full-screen overlay that dismisses on click or double click.
- Detail pages preserve the original preview aspect ratio; landscape previews use a wide, space-maximizing layout while portrait and square-ish previews align to the top of the detail panel.
- Detail pages surface available embedded metadata such as metadata title, description, capture time, software, lens, exposure, and focal length.
- Visible `PhotosByElie` watermark overlays protect homepage, gallery, basket, and detail preview images.
- Checking or unchecking a product on detail immediately updates localStorage.
- Tapping the heart on a detail preview immediately updates the browser-local liked list.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Full resolution choices show the verified developed source format, such as `JPG preview/export` or `TIFF preview/export`.
- Detail and basket pages now state the baseline personal print/web license and call out that commercial, resale, and AI-training use need written approval.
- The basket page generates a static order-intent summary and mail draft from the local basket contents, and can call the configured checkout Worker for guest checkout. When the Worker is configured with Stripe secrets, buyers are redirected to hosted Stripe Checkout; local mock mode can still simulate payment with `?workerBase=http://localhost:8787`. After payment, buyers land on `order.html` with order status and a per-file private download list.
- The private Real Estate review page loads the public-safe Corine bundle at `assets/real-estate/corine/app-context.js` on GitHub Pages and the ignored local bundle at `tmp/real-estate-import/corine/app-context.js` on localhost by default. A same-origin bundle can still be passed with `?context=<path>`. It has a static client access gate, persists selected photo IDs and edited PDF titles with the store keys emitted by the importer, can reload an older selection, exports a browser-friendly HTML selection table with embedded machine-readable batch data, can share that table through the browser/OS share sheet where available, still accepts legacy JSON batch manifests, and can generate a selected-photo PDF directly in the browser.
- The order page shows explicit payment, file preparation, and download phases; cloud delivery failures are shown as blocked delivery instead of indefinite preparation.
- Public cloud delivery avoids building one large archive in the Worker. The deployed Worker creates one signed-style download token per purchased file and streams each private R2 object separately from the order page.
- The checkout Worker expects JPG 6 MP, 3 MP, and 1 MP buyer deliverables to exist in private R2 under `renders/...`; those unwatermarked files are generated by the media pipeline on the machine that owns the developed masters and reused for future per-file delivery.
- `assets/private-delivery-manifest.json` tracks private master/render coverage for catalog photos.
- `assets/discarded/discarded-photo-ids.json` is the durable owner discard tombstone list. `assets/discarded-media-manifest.json` is the generated R2 cleanup record built from those tombstones plus older cleanup history.
- Product choices are digital-only by default. Owner can deliberately enable physical print/frame options on localhost with the Physical items toggle for local review.
- Published digital prices now use separate defaults for camera photos and AI-origin images. Camera photo downloads start at $8 for 1 MP and $65 for full resolution; AI-origin downloads start at $4 for 1 MP and $25 for full resolution.
- Owner shows an editable local price-list table for the current camera/AI digital resolution tiers, print sizes, frame add-ons, and mock S&H amounts.
- Physical print defaults are open-edition launch prices: $12 for 4x6, $18 for 5x7, $32 for 8x10, and $48 for 11x14 before optional framing.
- Print offers infer the preferred measurement system from browser locale, showing inches first for US-style locales and centimeters first for metric locales while keeping both units visible.
- Selected prints carry a count stepper and a per-print frame choice: no frame, white frame, or black frame. Using the count stepper or choosing a frame selects that print automatically, and frame mock prices scale by print size.
- Downloads have free shipping and handling. Physical prints show a mock S&H amount by size, added and removed as a limited-time discount so the payable mock total stays unchanged.
- The generated order email includes a per-photo review with selected products, source confidence, review links, S&H add/discount lines, and subtotals.
- In the basket, unchecking every resolution keeps the photo row available for later reselection; only Remove deletes it.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.

## Worker Checkout Track

`worker/checkout-worker.mjs` is the trusted checkout/fulfillment track. The Worker owns order numbers, USD totals, basket validation, buyer email, payment status, delivery metadata, and signed-link-style download tokens. Stripe remains the payment authority; the Worker creates an order draft and Checkout Session, then waits for a verified paid webhook before marking delivery ready. For local end-to-end testing, `worker/local-server.mjs` runs the Worker on `http://localhost:8787`, uses `worker/local-zip-delivery.mjs` to write mock ZIPs under `deliveries/`, serves token downloads during the live mock session, and serves order-ID fallback downloads from `/download-order/:orderId` when the ZIP exists on disk. For public checkout, `worker/deployed-worker.mjs` uses Cloudflare KV for order state, real Stripe when `STRIPE_SECRET_KEY` is configured, and private R2 per-file download tokens for full-resolution masters and generated JPG renders; `media-config.js` can point the public site at that deployed Worker with `checkoutWorkerBaseUrl`.

Run the Worker tests from the repo root:

```bash
node --test worker/checkout-worker.test.mjs
```

See `worker/README.md` for route examples and Stripe/mock configuration.
