# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v72.3`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, AI, Italy, Portugal, and Slovakia collections
- `france.html`, `usa.html`, `spain.html`, `mexico.html`, `ai.html`, `italy.html`, `portugal.html`, `slovakia.html`: thin gallery shells rendered from shared photo data
- `unknown.html`: localhost-only Owner queue for classifying unknown photos into real country galleries
- `photo.html`: reusable photo detail page; product checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with a sticky total band
- `liked.html`: localStorage-backed liked photos page; basketed photos are automatically liked
- `owner.html`: localhost-only owner controls for live review actions, Unknown classification, Blocked review, metadata sync, and R2 maintenance
- `owner-auth.js`: localhost helper availability client for catalog and cloud maintenance actions
- `hidden.html`: localhost-only review surface for blocked photos
- `basket-store.js`: shared basket source-of-truth helpers for detail and basket pages
- `liked-store.js`: shared liked-photo source-of-truth helpers for detail and liked pages
- `hidden-actions.js`: localhost-only live review action store for blocked blacklist changes, undo, and owner assignment state
- `hidden-store.js`: localhost-only loader for the ignored blocked catalog used by Blocked review and blocked-photo detail pages
- `hidden-page.js`: localhost-only Blocked review grid
- `basket-rail.js`: compact wide-screen basket rail for browsing and photo detail pages
- `home-data.js`: tiny homepage manifest with collection counts and representative preview candidates
- `photos-data.js`: full shared collection, photo, product option, and mock price data
- `home-catalog-loader.js`: homepage-only background loader for the full catalog and basket rail
- `home-discovery.js`: homepage-wide search, origin, collection, filter results, likes, keyboard selection, detail navigation, and localhost Owner shortcuts
- `photo-gallery.js`: shared gallery renderer
- `photo-detail.js`: shared detail page, real-image preview support, and automatic basket sync
- `basket.js`: basket rendering, item removal, resolution reselection, and sticky total updates
- `liked.js`: liked page rendering, unlike actions, and resolution selection into the basket
- `media-config.js`: public-media base URL configuration for GitHub Pages/R2 preview delivery
- `worker/`: mockable Cloudflare Worker-track checkout and fulfillment prototype
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme, translation dictionary, and language toggle behavior for public pages
- `site-version.js`: appends the current visible version to same-site page navigation to avoid stale cached HTML
- `scripts/validate_publish.js`: pre-push generated-data, asset-pair, resolution metadata, and publish-summary check
- `scripts/build_photo_state_db.py`: builds ignored SQLite state database at `tmp/photo-state.sqlite` from the catalog, import cache, blocked/discarded tombstones, sidecars, and R2 logs
- `scripts/watch_photo_state_db.zsh`: optional local background refresher for the SQLite state database
- `AGENTS.md`: repo-level working preferences and versioning SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations, including versioning and Lightroom image ingestion
- `assets/`: shared By Elie logo asset, publish metadata, tiny placeholders, and ignored localhost compatibility/blocked working data

## Preview

Use the GitHub Pages URL above after pushing to `main`.

## Current Behavior

- Public collections are ordered France, USA, Spain, Mexico, AI Images, Italy, Portugal, and Slovakia.
- Catalog photos now carry a first-class `sourceOrigin` value (`camera` or `ai`). Gallery filters, detail metadata, Owner counts, price tiers, and Worker checkout validation all use that origin instead of relying only on the `ai` collection slug.
- Unknown photos are no longer presented as a public country-style collection; localhost Owner gets a dedicated classification queue.
- Unknown classification assigns every loaded unknown photo from the same capture day when one photo is assigned to a country, then removes assigned photos from the visible queue.
- Owner Unknown counts show only photos that still need a country assignment; photos already assigned or blocked no longer reduce unrelated counts.
- The homepage loads `home-data.js` first so the hero/collections render from a tiny manifest, then `home-catalog-loader.js` fetches the full `photos-data.js` catalog in the background for basket/liked context.
- The homepage hides the decorative hero photo stack on narrow or short viewports so the collection carousel stays visible instead of competing for vertical space.
- The homepage now has the global discovery controls before Collections, including search, collection, camera/AI origin, orientation, color mood, subject, and sort. Filtered results render 24 at a time with a full-match count and gallery-style hearts, keyboard selection, detail navigation, and localhost Owner shortcuts. Collection galleries keep local refinement but no longer show the redundant camera/AI origin selector.
- Gallery pages load the publishable Expo subset from `photos-data.js`; public GitHub Pages builds resolve preview images through `media-config.js` and each photo's `media.publicPreview` R2/CDN key instead of relying on committed JPG assets.
- Public previews currently resolve directly through the public R2 `r2.dev` media endpoint backed by `photosbyelie-public`; move `publicBaseUrl` to a custom media domain when that is attached.
- `assets/expo` can stay empty or local-only once the public R2 bucket has the baked-watermark previews; use `node scripts/validate_publish.js --external-media` for that publishing mode.
- R2 media uploads should run through the lock-guarded sweep wrapper, `scripts/run_cloud_media_sweep.zsh`, or otherwise one lane at a time. The wrapper uses `.review-logs/cloud-media-sweep.lock` so the daily automation and manual runs do not race each other.
- Public R2 sync and Saturn imports skip IDs from blocked and discarded tombstones, so rejected or owner-discarded photos are not reintroduced by later bulk uploads.
- `tmp/import-cache` holds disposable import manifests and watermarked derivative files on their way to R2. `assets/reserve` is retained only as localhost Reserve compatibility data; Reserve is no longer a user-facing review state. Blocked is a blacklist/review list, not a file location.
- Imports scan developed JPG/TIFF exports only, keep Camera photos at Lightroom green label/rating 4+, treat Apple Photos album exports under `/Volumes/Saturn/Pictures/LR/Apple Photo Albums` as selected by folder membership, infer country/AI/Unknown buckets, and write watermarked `*_900.jpg` and `*_1800.jpg` pairs into `tmp/import-cache` before upload. RAW/DNG/NEF files are not public-site or cloud-storage inputs.
- On localhost, `H` or `X` blocks a live-gallery photo by adding it to the blocked blacklist while leaving preview files in place, `U` undoes that block, and `P` on the Blocked page re-promotes a blocked photo by removing it from the blacklist. `D` is the stronger discard action: it removes the photo from active catalog state, writes `assets/discarded/discarded-photo-ids.json`, and queues R2 deletion for matching public previews, private masters, and private render JPGs.
- On localhost gallery/detail pages, Owner can edit Title and Keywords; saves update the catalog metadata and generated Worker catalog used by checkout deliverables. JPEG/source embedded metadata is left alone because catalog manifests are the authoritative title/keyword source.
- `assets/owner-actions/keyword-blacklist.json` is the owner-maintained list of useless keyword strings. Import and export scripts omit those strings from generated keyword metadata and keyword indexes only; the list must not block photos, discard photos, or rewrite JPG/source metadata.
- Blocked photos do not re-upload public preview objects while they are blacklisted.
- On the localhost Unknown page, cards show title/keyword metadata, same-day unknown counts, day-before/day-after known-country context, and previous/next shooting-day context with relative day distance; arrow keys move the selected card, `H` or `X` blocks it, `U` undoes the last block, and double clicking a thumbnail opens a full-screen preview that dismisses on click.
- Assigning an Unknown photo to a country updates every loaded same-day unknown into that country in the local catalog/preview cache, adds the country keyword to catalog metadata, refreshes the Unknown hints, and removes assigned cards from the queue. Owner metadata actions do not rewrite uploaded masters, private render triplets, or public previews; those media objects are treated as immutable after upload except when blocked previews or discarded media are explicitly deleted.
- We are walking away from the old Curation Pass model: localhost Owner actions are live state changes, and any exported `.pbe-review` file is only an audit/batch snapshot.
- The localhost preview can be served by `python3 scripts/local_server.py 8000`, which keeps the public site static while adding localhost-only endpoints for review snapshot saving, blocked blacklist updates, Unknown assignment, metadata edits, and R2 maintenance.
- Local owner mutation endpoints are unlocked on localhost by the helper server without a password. For private-LAN owner review, start the server with `--bind 0.0.0.0 --allow-lan-owner`; without that opt-in, owner helper endpoints remain loopback-only.
- The Owner dashboard summarizes tracked R2 coverage for private masters, private JPG 1/3/6 MP deliverables, and public low/high previews; its Fix it button starts the same lock-guarded cloud media sweep used by manual and scheduled backfills. Current state is intentionally compact: Analyzed / Blocked / Expo, with a separate Camera / AI provenance split.
- Every page has the shared footer band; the Owner link appears only on localhost.
- On gallery pages, `g` makes the grid less dense/larger and `G` makes it denser/smaller; on localhost, single click moves the selection rectangle, Enter or double click opens detail, and the Grid slider adjusts thumbnail density within the current viewport limits.
- Gallery filters cover orientation, camera/AI origin, color mood, and subject, with Sort defaulting to Newest first on first display.
- When a photo detail page is opened from a gallery, Previous/Next follows that gallery's current filtered and sorted grid order.
- Subtle keyboard reminders appear above localhost review grids and detail previews, with public detail pages showing the `L` like shortcut.
- Gallery thumbnails render at their real aspect ratio inside stable square cells; strong selection outlines are reserved for localhost review.
- Gallery and Owner review cards can show a small `RAW` overlay when legacy/local metadata identifies a DNG/NEF/other raw original, but RAW-origin previews are not eligible for Expo or public media upload.
- Homepage representative samples refresh after all public country cards have been active once in the carousel.
- Any visible collection carousel card can be clicked to open its gallery, even when it is not the foreground card.
- The Expo cap is retired. The exporter now publishes all eligible cloud-backed previews unless they are blocked/discarded or otherwise ineligible.
- `scripts/export_photos_data.py --external-media` regenerates `home-data.js` and `photos-data.js` from the local import manifest and tracked owner state without committing preview JPGs.
- The basket is the source of truth for selected product options.
- Likes are stored separately from basket selections, so a photo can be liked before any resolution is chosen; adding a photo to the basket also keeps it liked.
- Wide screens show a compact right-side basket rail while browsing photos and collections.
- Basket rail actions include both Open basket and Liked.
- The basket page has a reduced hero and a sticky product total band that remains visible while scrolling.
- The liked page mirrors the basket layout, but rows come from hearted photos and totals count only selected products.
- The liked page includes bulk selectors for Full, JPG 6 MP, JPG 3 MP, and JPG 1 MP resolution choices.
- Public-facing pages share a client-side English/French/Spanish translation layer. The header language button cycles languages, persists the selected state, and translates public navigation, homepage copy, gallery controls/statuses, detail actions, basket/liked flows, and order-status copy. Owner-only tools remain English; the Owner language button beeps instead of switching.
- Detail pages start with no product checked unless that photo is already in the basket.
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
- The basket page generates a static order-intent summary and mail draft from the local basket contents, and can call the configured checkout Worker for guest checkout. When the Worker is configured with Stripe secrets, buyers are redirected to hosted Stripe Checkout; local mock mode can still simulate payment with `?workerBase=http://localhost:8787`. After payment, buyers land on `order.html` with order status, a ZIP download button, a visible local/cloud delivery reference, and a copy-path fallback for app browsers that hide attachment downloads.
- The order page shows explicit payment, ZIP build, and download phases; cloud delivery failures are shown as blocked delivery instead of indefinite preparation.
- Delivery ZIPs are flat: delivered image files sit at the ZIP root beside `ORDER.txt`, with no per-photo subfolders.
- The checkout Worker expects JPG 6 MP, 3 MP, and 1 MP buyer deliverables to exist in private R2 under `renders/...`; those unwatermarked files are generated by the media pipeline on the machine that owns the developed masters and reused for future ZIPs.
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

`worker/checkout-worker.mjs` is the trusted checkout/fulfillment track. The Worker owns order numbers, USD totals, basket validation, buyer email, payment status, ZIP delivery metadata, and signed-link-style download tokens. Stripe remains the payment authority; the Worker creates an order draft and Checkout Session, then waits for a verified paid webhook before marking delivery ready. For local end-to-end testing, `worker/local-server.mjs` runs the Worker on `http://localhost:8787`, uses `worker/local-zip-delivery.mjs` to write mock ZIPs under `deliveries/`, serves token downloads during the live mock session, and serves order-ID fallback downloads from `/download-order/:orderId` when the ZIP exists on disk. For public checkout, `worker/deployed-worker.mjs` uses Cloudflare KV for order state, real Stripe when `STRIPE_SECRET_KEY` is configured, and private R2 for developed-master reads plus generated ZIP storage; `media-config.js` can point the public site at that deployed Worker with `checkoutWorkerBaseUrl`.

Run the Worker tests from the repo root:

```bash
node --test worker/checkout-worker.test.mjs
```

See `worker/README.md` for route examples and Stripe/mock configuration.
