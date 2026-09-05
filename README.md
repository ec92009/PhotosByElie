# PhotosByElie

Photos By Elie contains two separate applications: PBE is the customer-facing
website; PhotosByElie Backstage (PBB) is the private macOS Owner workspace.

The website is served from `main` at `https://photos-by-elie.com/`.
GitHub Pages publishing follows a push to `main`; a documentation change does
not require an application version bump or a separate runtime release.

## Start here

- For Owner work, open the installed **PhotosByElie Backstage** and follow
  [Getting started with Backstage](docs/BACKSTAGE_GETTING_STARTED.md).
  Gallery, Review, Metadata, Uploads, Delivery, Storage and Activity are native
  workflows. PBE browser pages do not grant Owner capabilities, including on localhost.
- For the product boundary and priorities, read the
  [North Star](docs/architecture/north-star.md).
- `owner.html` is an unlinked, restricted credential-enrollment/recovery
  fallback. Use it only when the native setup flow requires it; it is not an
  Owner review, import, connector-health or mutation workspace. The normal
  **Set up this Mac** flow may open a browser account-picker handoff and then
  returns to Backstage. That authorization step does not restore browser Owner tools.
- Private workflow state is authoritative in `assets/owner-actions/Owner.sqlite`.
  JSON exports are compatibility or audit views. The public projection is plain
  `assets/catalog/photosbyelie.sqlite`; never substitute private Owner state or
  the legacy compressed catalog for it. See the
  [SQLite authority contract](docs/architecture/sqlite-catalog-owner-state.md).
- Backstage's enrolled credentials are local to the Mac in Keychain. PBE web
  publishing, Worker deployment, signed Backstage releases, local installation,
  and customer delivery are separate operations. See
  [Backstage architecture](docs/architecture/backstage-native.md) and the
  [update contract](docs/architecture/backstage-update-contract.md).

## Version

- Current visible version: `v247.1`
- Owner guide:
  [`Getting started with PhotosByElie Backstage`](docs/BACKSTAGE_GETTING_STARTED.md)
- Versioning follows the canonical SOP at `/Users/ecohen/Dev/.SOPs/VERSIONING_SOP.md`.

### Historical version receipts

These entries describe their named release, not current operating instructions.
Older references to browser Owner, Sidecar or Photos Bridge are superseded by
**Start here** and the active Backstage guide.

- `v245.2` reconciles the Owner-authoritative public catalog with current
  lifecycle blocks, removes the redundant camera-origin badge from ordinary
  still-photo cards, and lets Gallery selection span every filtered result
  while preserving bounded internal batches.
- `v219.0` releases the verified 121-photo La Concha receipt set into Corine's
  private gallery without re-exporting source media. The Worker authorizes the
  canonical private masters through a fixture-derived allowlist, while the
  gallery reuses the already-verified public preview objects.
- `v217.0` consolidates the gallery search and filter bar with the Aug 4 date
  range controls and streamlined filter set, preserving URL-aware filtering.
- `v155.0` restores truthful Owner Quick Look previews in cloud sessions by
  falling back to safe public detail/gallery derivatives when a localhost-only
  original source is unavailable, without exposing local paths or private
  masters.
- `v147.6` completes the native-only operator cutover. Backstage is the sole
  visible operator app, Photos Bridge remains a signed headless helper, and
  the obsolete Sidecar listener plus visible Owner/Sidecar launchers are
  retired with a reversible local archive. The standard connector rejects
  Sidecar launch attempts unless the explicit rehearsal rollback flag is set.
- `v147.5` makes the signed Backstage app the active Owner writer on Max after
  native enrollment, a cold Keychain session restore, explicit Photos
  approval, and a Worker-audited read-only metadata check. Browser Owner keeps
  authentication, enrollment, access, connector-health, and audit surfaces;
  one reviewed `data-owner-writer` change remains the rollback.
- `v147.4` published the Owner-only Backstage enrollment panel and reversible
  writer gate while retaining the browser Owner as the active writer.
- `v147.3` corrects a 12-photo La Jolla Cove cohort that had inherited the
  title `Nerja, beach` and Spain keywords. The valid USA images now identify
  La Jolla, San Diego, California.
- `v147.2` tightens fuzzy place search so Seville/Sevilla and small typos
  still match, while Paris “Hôtel de Ville” photos no longer leak into
  Seville results.
- `v147.1` keeps Search and every gallery filter control in place while
  matching results update, rather than scrolling the first result into view
  after each keystroke or filter change.
- `v147.0` turns the homepage image-use guide into three illustrated cards for
  wall art, licensing contexts, and location provenance. The approved imagery
  now carries the section while the useful provenance note moves into the
  heading and the generic explanatory card copy is removed.
- `v146.3` replaces the gallery density slider with a compact minus/plus split
  pill and gives Fit/Fill the same segmented treatment.
- `v145.20` restores every finished-product shelf control after eliminating a
  recursive Account/language synchronization loop that could exhaust the page
  call stack when a product was opened. Shelf actions now bind when their rows
  render and show immediate download feedback.
- `v145.19` makes Account sign-out clear both the Google account and any active
  Real Estate gallery session in one action. A dual-session sign-out returns
  to the public account screen instead of silently reopening the private
  workspace from the remaining gallery session.
- `v145.18` creates fresh, expiring private links for any ready Real Estate
  PDF, video, and Originals product. The Output page and finished-products
  shelf copy a client-ready link set that works without gallery login while
  the source files remain private in R2.
- `v145.17` opens the native Save dialog before ready PDF, video, and Originals
  downloads on supported Mac browsers, streams each file to the chosen location,
  and preserves the existing phone and unsupported-browser download paths.
- `v145.16` makes Originals a persistent third Real Estate output beside PDF
  and Video, with the same Queue, pending, and Download lifecycle on both the
  Output page and finished-products shelf.
- `v145.15` scopes JPEG ZIP preparation feedback to the saved product whose
  button was pressed, instead of making every shelf row appear to start work.
- `v145.14` makes opening a saved Real Estate product and returning to its
  shelf lightweight: neither transition rebuilds the full source-photo grid,
  and previously loaded product manifests are reused during the session.
- `v145.13` forces cloud slideshow videos through an explicit H.264/AAC
  transformation for iPhone playback and turns a finished JPEG ZIP action into
  a direct Download JPEGs action while its prepared archive remains available.
- `v145.12` replaces the signed-in account face icon with the first letter of
  the user's name or email address across the production landing and shared
  account controls.
- `v145.11` adds a product-specific JPEG ZIP action to each finished-product
  shelf row, removes the redundant Cloud saved badge, and makes phone
  language/theme switches avoid rebuilding the full Real Estate photo grid.
- `v145.10` removes the public Likes and Basket header actions from the private
  Real Estate workspace while retaining Account and Settings.
- `v145.9` makes ready PDFs download directly on touch devices instead of
  opening Safari's multi-tap PDF preview, matching the ready-video experience.
- `v145.8` makes the selected previews in Real Estate Titles and Order eager on
  mobile Safari and adds a phone-only Next action after the active list.
- `v145.7` hides Real Estate source/shoot/product inventory statistics on phone
  layouts so clients reach their saved products or selection flow sooner.
- `v145.6` removes the Real Estate Card size controls and forces the consistent
  Balanced card layout, leaving the narrow wizard with one clear action.
- `v145.5` keeps phone-sized Real Estate wizard actions in separate full-width
  rows so the Next button cannot cover the card-size choices, and moves the
  selected-originals ZIP control onto the reachable Output step.
- `v145.4` keeps the Worker action ledger as the Waste Basket authorization and
  audit gate, then wakes Max's localhost connector with only the opaque action
  ID for sub-second restoration when the local bridge is reachable. Restore
  titles now come atomically from private Owner SQLite state; the existing
  five-second connector poll remains the silent fallback.
- `v145.0` repairs Waste Basket restore behavior on both public and local Owner
  pages and reconstructs watermarked previews for blocked IDs missing from the
  deployed hidden-photo catalog.
- `v143.15` simplifies Latest social to three quiet text links and prevents the
  shelf from colliding with the footer.
- `v143.14` restores the three newest social campaign collections in the open
  homepage grid slot beside Portugal.
- `v143.13` replaces the malformed account and settings glyphs with consistent line icons.
- `v143.12` restores strong day-mode contrast in the homepage image-use guide.
- `v143.11` opens the public homepage on the Louvre, moves Ronda to the second
  hero position, and adds concise wall-art, licensing, and provenance guidance.
- `v143.10` opens Waste Basket as an authenticated same-origin Owner review,
  avoiding the in-app browser's blocked HTTPS-to-localhost navigation. The
  review loads its recoverable catalog only for Owner and routes restores and
  confirmed permanent discards through the Max connector.
- `v143.9` keeps Manage Waste Basket actionable when a browser cannot verify
  localhost. The control now uses the installed Max connector as a direct
  top-level fallback and opens the private local basket instead of presenting
  a false disabled state.
- `v143.8` extends Owner multi-selection from the original photo with
  Shift + Arrow in country galleries and the Waste Basket. The Owner page now
  promotes the recoverable Waste Basket, keeps secondary workspaces collapsed
  until needed, distinguishes keyboard focus from actual batch selection, and
  shows both selected and total basket counts with accurate shortcut guidance.
- `v143.7` makes Build a Fixture a contained full-width Owner workspace and
  adds a local Waste Basket manager for multi-select restore, permanent
  discard, and confirmed empty-basket operations. The catalog-prefix R2
  cleanup removed `69,960` unreferenced objects (`362.5 GB`) and a fresh live
  dry-run reports zero remaining candidates without touching Real Estate,
  deliveries, music, shared, or root objects. The supported lifecycle
  publisher also removed 20 newly hidden rows, leaving `3,531` visible items.
- `v143.6` reconciles the deployable static catalog with the durable Owner
  lifecycle ledger. Three newly hidden rows are removed from public SQLite,
  the Worker catalog, homepage counts, and the media sidecar; publication
  validation now passes with `3,551` public camera-made items.
- `v143.4` gives the Portugal landing frame its own place-specific identity:
  “Cascais meets the Atlantic.” Each production country card now fans into
  three or four catalog-backed destinations plus the full “Others…” collection.
- `v143.3` promotes the approved panorama concept to the production homepage.
  It keeps the six substantial country collections, real Google and legacy
  account entry, ACS-driven client routing, account-backed language/theme
  preferences, SEO/social discovery metadata, analytics, and policy links.
- `v143.1` applies the animated country-background treatment to the six
  well-stocked country galleries, replaces Portugal's convent scene with a
  clean Cascais Bay panorama, and deliberately leaves Slovakia and utility
  collections on the neutral header.
- `v143.0` gives each country gallery a cinematic, slowly panning hero drawn
  from its own collection while preserving the neutral utility header for
  Search and Panoramas. The isolated landing concept now uses outdoor scenes
  exclusively across both its six-image rotation and country grid.
- `v142.6` turns the landing concept's Explore control into an animated,
  keyboard- and touch-accessible seven-country pill fan, expands the page into
  a complete country grid, and replaces the Paris and Nerja hero scenes with
  the clean Louvre-at-night and sunny-cove panoramas. Spain now leads with the
  catalogued Plaza de España panorama from Seville.
- `v142.5` simplifies the landing-page panorama motion into one slow,
  32-second linear traverse from the left edge to the right edge, followed by
  a gentle crossfade into the next scene. It also replaces the defective
  Rueil-Malmaison frame with a clean panorama of Napoleon's bedchamber.
- `v142.4` keeps the isolated landing-page slideshow but replaces every hero
  background with an approved, clean panorama. Each scene begins centered,
  glides to the left edge, traverses the full frame, and returns toward center
  before the crossfade; pause and reduced-motion controls stop that movement.
  The unnecessary Real Estate link is also removed from the concept header.
- `v142.3` adds a production-isolated landing-page concept at
  `/landing-concept/`: six full-screen, unwatermarked display derivatives,
  an automatic crossfade sequence with manual and reduced-motion controls,
  a minimal editorial continuation below the fold, and persisted
  language/theme/surface preferences. The route is `noindex` and does not
  replace the current home page or expose full-resolution masters.
- `v142.2` makes panorama motion feel physical: idle full-height views begin
  centered, glide first toward the left edge, and then travel continuously
  edge-to-edge. A visitor drag takes over immediately and keeps coasting after
  release with gentle friction; a new pointer, wheel, or keyboard gesture stops
  the coast. Reduced-motion preferences disable both automatic and inertial
  movement.
- `v142.1` makes panorama full-height viewing self-explanatory and hands-off:
  the exit control stays visible, spacebar previews have an explicit close
  button, and a slow left-to-right pan begins after a short idle but stops as
  soon as the visitor drags, scrolls, taps, or uses the arrow keys. Reduced
  motion preferences disable the automatic movement.
- `v142.0` restores cloud Owner title/keyword editing and keyword-blacklist
  management, adds useful camera/file/location metadata to the spacebar preview
  without exposing storage paths or internal ids, and reconciles the public
  catalog with Sidecar approval, hidden/discarded lifecycle, and tombstone
  state. The validated camera-made storefront now contains `3,554` items.
- `v141.10` makes ACS fixture-native: it shows inherited access across the
  universal Expo / RE / Travel tree, keeps RE owner/admin-only at the root,
  grants Corine exclusive La Concha access through every descendant, and
  retires the former fixture rehearsal accounts and grants in production D1.
- `v141.3` introduces the universal Build a Fixture pipeline with recursive fixtures, read-only
  asset search, immutable culling snapshots in the shared Sidecar, reversible
  multi-fixture placement, versioned R2 receipts, and verified Apple Photos
  metadata give-back. See `docs/architecture/universal-fixture-pipeline.md`.
- `v141.0` makes Real Estate output settings explicit radio choices for paper size, photo timing, PDF orientation, and video orientation; ready Queue actions become direct downloads, output status contrast is stronger, hero counters identify their live sources, and account language/theme preferences follow the active user.
- `v140.25` removes the manual cloud-shelf sync banner from the Real Estate finished-products shelf; saved products continue loading automatically.
- `v140.24` reduces the account panel to one Sign out control and makes sign-out remove account-synced basket, likes, order references, and profile data from the browser before returning to visitor mode; Basket and Liked redraw immediately.
- `v140.23` makes a successful legacy Real Estate login a first-class signed-in state in the shared site header: Corine sees the face icon instead of visitor Sign Up / Sign In pills, while ACS remains the authority for what that scoped session may access.
- `v140.22` makes cloud Real Estate generation observable and client-ready: the Worker persists real render phases and percentages, the page displays a determinate progress bar with elapsed time and ETA, and the output/shelf flow is localized in English, French, and Spanish. The all-cloud PDF/video pipeline introduced in `v140.21` remains unchanged.
- `v140.21` moves Real Estate PDF and video production fully into Cloudflare: a durable Workflow launches cloud Chrome, writes finished files to private R2, transcodes cloud-recorded WebM to MP4 with Media Transformations, and updates the finished-products shelf while the client only queues and polls. Production music uses verified 60-second R2 clips that repeat for longer slideshows; source tracks remain unchanged.
- `v140.20` keeps browser-rendered Real Estate videos responsive by excluding music tracks longer than three minutes from the random country pool.
- `v140.19` adds a 25 mm-equivalent scannable Photos By Elie QR code to the Real Estate video closing card.
- `v140.18` gives Real Estate videos a restrained presentation finish: branded property intro and Photos By Elie outro cards, eased Ken Burns movement, and short fades through black between images while preserving the existing music and credit policy.

## Structure

This inventory includes compatibility files retained for history. Presence in
the repository does not make a retired browser workflow an active entry point.


- `index.html`: one-page photo hub with France, USA, Spain, Mexico, Italy, Portugal, Slovakia, Panoramas, and a latest-social campaign shelf
- `campaign.html`: first-party social/Pinterest mini-collection landing page that keeps visitors on Photos By Elie instead of a single-photo dead end
- `gallery.html`: shared gallery shell that reads the active collection from `?gallery=<slug>`
- `owner-review.html`: retired browser review compatibility page; use native Backstage Gallery, Review and Waste Basket
- `photo.html`: reusable photo detail page; product checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with fixed commerce header controls and a pinned total band
- `liked.html`: localStorage-backed liked photos page with fixed commerce header controls; basketed photos are automatically liked
- `support.html`: buyer-facing payment, delivery recovery, license, refund-expectation, and support notes for digital checkout
- `real-estate.html`: private real-estate product workspace that loads a public-safe client context on GitHub Pages or an ignored local import bundle on localhost, starts with the saved PDF/video/selection shelf, supports create-new-selection and edit-existing-selection flows, click and Shift-click media selection from the full shared pool, selected-title cleanup, one-line drag ordering, preview/download PDF and video outputs, cloud-saved selection manifests, masked password entry, and selected-original ZIP delivery through the Worker
- `slideshow-music.html`: public mini-app with normalized, country-tagged Pixabay audition candidates for Spain, Portugal, France, and USA, original subdued Spanish/classical guitar cues below, per-track play/pause, seeking, local star ratings, and local delete/hide controls for real estate slideshow use
- `owner.html`: unlinked restricted credential-enrollment/recovery fallback; normal Owner work is native Backstage
- `new-owner.html`: compatibility redirect to the restricted `owner.html` fallback
- `owner-auth.js`: retained browser authorization compatibility code; not an active catalog-maintenance workspace
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
- `home-discovery.js`: homepage-wide shared search/filter/sort controls, origin and collection filtering, result cards, likes, keyboard selection, detail navigation, and localhost Owner shortcuts
- `gallery-card.js`: shared gallery/review card renderer used by public galleries and Waste Basket review
- `campaign.js`: social mini-collection renderer, embedded-browser escape warning, and campaign-local archive search
- `photo-gallery.js`: shared gallery renderer with shared search/filter/sort controls, grid density, fit/fill, selection, and detail navigation
- `photo-detail.js`: shared detail page, real-image/video preview support, duration metadata, and automatic basket sync
- `basket.js`: basket rendering, item removal, resolution reselection, delivery availability pruning, and sticky total updates
- `liked.js`: liked page rendering, unlike actions, and resolution selection into the basket
- `real-estate.js`: private client-gallery controller for the Real Estate saved-product shelf, conditional property step plus four focused detail pages, shared-pool media selection with range selection, property-scoped title/order state, editable date/type product names, cloud-saved selection manifests, cloud-queued PDF/video assembly jobs with ready/download URLs, browser-built originals ZIP delivery, and legacy batch JSON loading
- `media-config.js`: public-media base URL configuration for GitHub Pages/R2 preview delivery
- `worker/`: mockable Cloudflare Worker-track checkout and fulfillment prototype
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme, translation dictionary, language toggles, media helpers, video duration formatting, and reusable public-page filter/sort logic
- `site-version.js`: appends the current visible version to same-site page navigation to avoid stale cached HTML
- `robots.txt` / `sitemap.xml`: public crawl guidance and first-pass sitemap for homepage, core galleries, campaign pages, and support
- `socials/`: platform-specific, drag-ready social upload packages with watermarked public images, captions, READMEs, and manifests; current daily trees cover Facebook, Instagram, Pinterest, and Threads
- `scripts/catalog_tsv.cjs`: legacy-named shared Node catalog loader that now reads the public SQLite catalog for tools and tests
- `scripts/write_catalog_tsv.cjs`: legacy wrapper that rewrites the browser bootstrap and rebuilds the public SQLite catalog artifacts; `--commerce-only` preserves media while refreshing products and storefront retirement rules, while `--bootstrap-only` refreshes browser/home bootstrap files from the authoritative SQLite catalog without rebuilding it from stale JavaScript data
- `scripts/build_public_catalog_db.py`: rebuilds the compact public SQLite catalog at `assets/catalog/photosbyelie.sqlite`
- `scripts/validate_publish.js`: pre-push SQLite catalog, asset-pair, resolution metadata, and publish-summary check
- `scripts/build_photo_state_db.py`: builds ignored SQLite state database at `tmp/photo-state.sqlite` from the catalog, import cache, blocked/discarded tombstones, owner actions, sidecars, and R2 logs
- `scripts/watch_photo_state_db.zsh`: optional local background refresher for the SQLite state database
- `scripts/new_owner_connector.py`: bounded Mac connector used by signed Backstage to execute one authenticated cloud Owner action or one finite queue drain, then exit. It cannot run as an always-on daemon. The Worker maintains a pending-action KV index so bounded drains do not scan historical actions.
- `scripts/owner_connector_runtime.py`: materializes and verifies the symlink-free, read-only runtime snapshot used by Backstage's bounded connector launches. LaunchAgent installation and downloadable connector packages are retired.
- `AGENTS.md`: repo-level working preferences, versioning SOP, and timelog SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `SUMMARY.md`, `HANDOFF.md`, and `TODO.md`: durable cross-thread context, handoff state, and historical backlog reference; YouTrack is the authoritative current ticket queue
- `TIMELOG.md`: active collaboration clock
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations, including versioning, active collaboration timelog tracking, Lightroom image ingestion, and repo/media cleanup guardrails
- `docs/commerce/PRICE_OFFER_STRATEGY.md`: launch price, bundle, refund/support, and implementation strategy draft for owner approval
- `docs/architecture/access-tiers.md`: Google-backed Cloudflare Access tier model for Admin, Owner, Real Estate client, and public user sessions
- `assets/branding/`: PhotosByElie brand assets used by Stripe and the public site favicon/topbar logo
- `assets/music/slideshow-guitar/`: public MP3 cues used by the slideshow music mini-app, including `pixabay/` audition candidates with credit metadata and a `public-domain/` source manifest for CC0 Commons clips
- `assets/`: publish metadata, tiny placeholders, and ignored localhost compatibility/Waste Basket working data
- `assets/owner-actions/Owner.sqlite`: ignored durable local Owner workflow database for review queues, decisions, blacklist, country assignment state, and trusted R2 object lifecycle state; the DB and WAL/SHM sidecars remain out of deployable GitHub Pages assets
- `assets/owner-actions/real-estate-clients.local.json`: ignored local Real Estate client credential and import settings file used by the Owner dashboard
- Owner-action JSON files are compatibility views, handoff files, audit files, or local config. `Owner.sqlite` is the local Owner source of truth; `assets/catalog/photosbyelie.sqlite` is the active public catalog source of truth. Title/keyword review batch JSON is compatibility/audit output and must not be treated as public catalog truth.

## Preview

Use a local server for customer-site review before publishing. Follow
[SHOW_ME_SOP.md](SHOW_ME_SOP.md) for active preview URLs and visible version
reporting. A push to `main` publishes GitHub Pages; a local preview does not.
Neither path enables browser Owner tools.

## Current behavior

- Customers browse the public catalog, save likes and basket choices, pay through
  the checkout Worker, and receive authorized downloads. Private customer access
  remains scoped to the relevant gallery or delivery.
- Owner decisions and mutations run in enrolled Backstage. Read current queue,
  proposal and storage counts from its authoritative stores and live receipts,
  not from historical README snapshots.
- Plain `assets/catalog/photosbyelie.sqlite` is the deployable public catalog.
  `Owner.sqlite`, its WAL/SHM files, credentials and private workflow exports
  must remain outside public assets.
- Publication registration, uploading, website deployment and delivery are
  separate steps; a completed earlier step does not prove a later one.

## Historical implementation notes

Archived on 2026-09-05 from the former mixed “Current Behavior” section. These
notes preserve release and migration evidence, including the dated May review
snapshot. They are **not current instructions or current counts**. References
to localhost Owner, browser Imports/Title/Keywords, Sidecar, Photos Bridge,
legacy source folders and browser mutation shortcuts are superseded by the
native entry points above. Verify any current behavior against the active
Backstage guide and the relevant source/release receipt.


- Public collections are ordered France, USA, Spain, Mexico, Italy, Portugal, and Slovakia.
- AI-generated images are retired from the commercial storefront. Public catalog generation excludes the `ai` collection and AI-origin rows, while the underlying source archive and Owner-side records remain intact.
- Storefront downloads use real launch pricing: camera JPG/full-resolution tiers are `$8 / $16 / $28 / $65`, and video duration tiers are `$12 / $20 / $28 / $35 / $50`.
- Catalog photos retain first-class `sourceOrigin` values for Owner classification and defensive storefront filtering. Checkout also excludes retired origins instead of trusting browser visibility alone.
- Unknown photos are no longer presented as a public country-style collection; localhost Owner gets a dedicated classification queue.
- Unknown classification assigns every loaded unknown photo from the same capture day when one photo is assigned to a country, then removes assigned photos from the visible queue.
- Owner Unknown counts show only photos that still need a country assignment; photos already assigned or basketed no longer reduce unrelated counts.
- The homepage loads `home-data.js` first so the hero/collections render from a tiny manifest, then `home-catalog-loader.js` fetches the full catalog bootstrap in the background for basket/liked context.
- The homepage includes a Latest social shelf. It filters the generated campaign index to Facebook, Instagram, Pinterest, and Threads targets, shows the newest social springboards first, and keeps static fallback cards for the 2026-06-15 themes plus the 2026-05-27 acceptance-criteria package themes.
- `robots.txt` points crawlers at `sitemap.xml` and keeps owner, basket, order, real-estate, experiments, and raw social working pages out of search results.
- Campaign pages reuse the same shared gallery masonry controller as regular collections, so Grid density plus Fit/Fill behavior stay consistent.
- The full public catalog loads plain `assets/catalog/photosbyelie.sqlite` directly. Normal catalog rebuilds no longer generate or prefer Brotli-compressed SQLite; the retained `.sqlite.br` artifact is legacy-only. The SQLite catalog uses compact integer lookup ids for controlled vocabulary fields. Catalog totals and R2 coverage are volatile operational facts: read them from the latest verified Owner projection/deployment receipt and Backstage health surfaces rather than this README, which must not become a competing source of truth.
- The homepage hides the decorative hero photo stack on narrow or short viewports so the collection carousel stays visible instead of competing for vertical space.
- The homepage now has shared global discovery controls before Collections, including search, collection, media type, date from/to, orientation, adaptive size/duration, color mood, subject, and sort. Filtered results render 24 at a time with a full-match count and gallery-style hearts, keyboard selection, detail navigation, and localhost Owner shortcuts.
- Every page exposes a top-right Settings control that opens a modal for language, Day/Night mode, glass transparency, and glass translucency. The visual sliders persist in `localStorage` and update shared glass CSS variables across pages.
- Public pages also expose an Account control near Settings. Visitors can keep browsing anonymously, verify their email with direct Google OAuth through the auth Worker, see the signed-in email in the Account sheet, and sign out by clearing the Worker Google session. If the direct OAuth secrets are not configured yet, the Worker route falls back to the legacy Cloudflare Access login path.
- Gallery grid density supports compact phone browsing beyond 3 columns, has a larger touch target, and writes the selected density back to the `columns=` URL parameter for reload/back consistency.
- Gallery/home load controls show exact remaining counts, using labels such as `See 24 more`, `See 48 more`, and `See all N more` instead of generic "See More" text.
- Gallery pages load the publishable Expo subset from the public SQLite catalog through the `photos-data.js` bootstrap; public GitHub Pages builds resolve preview media through `media-config.js` and each catalog row's `media.publicPreview` R2/CDN key instead of relying on committed media assets.
- Localhost Owner gallery search automatically augments normal public-catalog matching with Owner title/keyword review metadata from `Owner.sqlite`, including original, proposed, decided, blocked, and applied review text. Public search remains catalog-only.
- Public previews resolve through the custom Worker media route `https://download.photos-by-elie.com/media`, backed by the `photosbyelie-public` R2 bucket.
- Local preview asset folders are retired. Public previews should resolve from R2/CDN keys; use `node scripts/validate_publish.js --external-media` for that publishing mode.
- R2 media uploads should run through the lock-guarded sweep wrapper, `scripts/run_cloud_media_sweep.zsh`, or otherwise one lane at a time. The wrapper uses `.review-logs/cloud-media-sweep.lock` so the daily automation and manual runs do not race each other.
- Public R2 sync and Saturn imports skip IDs and known source paths from the durable Owner SQLite hidden/discarded lifecycle snapshot, with Waste Basket/discard JSON kept as compatibility state. Rejected or owner-discarded photos are not reintroduced by later bulk uploads under a fresh selected-folder ID. AI/Leonardo source records remain lifecycle/tombstone-driven but are excluded from commercial catalog publication. Publish validation now fails if a hidden/discarded id leaks into the public catalog or `assets/expo-manifest.json`.
- `python3 scripts/cleanup_unreferenced_catalog_r2.py` audits only the public
  `expo/` and private `masters/`/`renders/` catalog prefixes. It is dry-run by
  default and fails closed around current catalog keys plus active or hidden
  Owner/Sidecar identities. Commit mode records candidates through the Owner
  state writer, deletes in bounded R2 batches, verifies absence, and records
  confirmed deletion state.
- `tmp/import-cache` holds disposable import manifests and watermarked derivative files on their way to R2. Reserve is a manifest-only owner state, not a local preview folder. Waste Basket is a blacklist/review state, not a file location.
- Expo imports scan the gallery source anchors: Camera, Apple Photos album exports under `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`, direct Owner Apple Photos imports under ignored `tmp/apple-photos-import`, and Leonardo. They scan developed JPG/TIFF photo exports and MOV/MP4/M4V video exports, keep Camera photos at Lightroom green label/rating 4+, treat Apple Photos and AI folders as selected by folder membership plus tombstones, infer country/AI/Unknown buckets, and write watermarked photo `*_900.jpg`/`*_1800.jpg` pairs plus video `*_900.jpg`/`*_short_5s_720p.mp4` previews into `tmp/import-cache` before upload. Direct Apple Photos imports use PhotoKit/Photos automation through the localhost Owner helper, never read `.photoslibrary` internals, and carry stable `apple-photos://<asset-localIdentifier>` source anchors for dedupe. Their sidecar also records album title, creation date, and PhotoKit latitude/longitude so rendered JPGs can still import with useful date/place context and Title/Keyword Review can use album/place hints. They export to a temporary Expo source folder, then immediately start the normal Expo/R2 import from that folder. RAW/DNG/NEF masters are not public-site or cloud-storage inputs; when a direct Photos asset is RAW-only, the bridge prefers Photos' current rendered JPG and can fall back to converting a local RAW/DNG source into a temp JPG if Photos' rendered callback stalls. A default-on burst filter applies the same conservative burst grouping before conversion so rejected near-duplicates are not rendered, and the default-on iCloud download switch lets Photos fetch missing originals or renders before writing the temporary import folder. Real Estate media uses the separate Real Estate tab import flow.
- On localhost, `H` remains fixture-local while `X` sends a live-gallery photo to the recoverable Waste Basket through the Owner SQLite gateway; `U` restores the exact prior state, and `P` on the Waste Basket page puts a basketed photo back through the same lifecycle. The Backstage-launched, fixture-frozen loopback Owner session can use the grouped gateway path for up to 500 displayed fixture photos at once. A public browser Owner login is provisioning/list/revoke only and cannot invoke lifecycle actions. Only a separately confirmed Empty Waste Basket action activates global tombstones; it retains source media, R2 objects, and history. Legacy R2 cleanup excludes gateway tombstones and remains a separately named repair path.
- Owner now opens the recoverable Waste Basket through the local Mac connector.
  The manager supports plain, Shift, and Command/Ctrl selection, restore
  selected, and a separately confirmed Empty Waste Basket action. Empty is
  the only normal transition to a global tombstone; it retains source and R2
  media instead of queuing deletion.
- Sidecar treats legacy and cloud Apple Photos identifiers with the same PhotoKit `localIdentifier` as one physical item. Upload planning keeps the current owner identity but reuses an established public/catalog R2 key family; catalog registration likewise emits at most one media row. `python3 scripts/dedupe_apple_photos_r2_assets.py` audits duplicate R2 families without changing anything. The explicit `--commit` path first verifies every retained object live, deletes only unreferenced duplicate masters/previews, verifies absence, and reconciles the Owner receipts and lifecycle ledger.
- On localhost gallery/detail pages, Owner can edit Title and Keywords; saves update the catalog metadata and generated Worker catalog used by checkout deliverables. Source-file embedded metadata is left alone because catalog manifests are the authoritative title/keyword source.
- On localhost Owner detail pages, buyer resolution controls and Basket entry points are hidden so detail review stays focused on moderation shortcuts and metadata edits.
- When a localhost Owner title/keyword review row opens detail, double-clicking the detail preview requests the private JPG 6 MP render for full-screen inspection when available, and the back link restores the exact review scroll position.
- `v118.3` makes Account sign-out visible beside the signed-in email, clarifies that Save liked/basket only stores this browser's liked and basket state, and adds full signed-in order/download history with per-order resend instructions controls.
- `v118.2` adds quiet Web By Elie site creation and maintenance crediting in the shared footer and Support page credits section.
- `v118.1` promotes direct Apple Photos imports into first-class title/keyword review candidates as soon as the selected-source Expo/R2 pass finishes: R2-ready import-cache rows are queued from the Apple Photos sidecar before public catalog publication, seeded with album/capture/place hints, and the 14th Street recovery batch is visible in Owner TKR.
- `v110.7` adds a clearer Real Estate saved-product shelf sync strip and per-product save/output badges so clients can distinguish cloud-saved selections from ready or pending PDF/video files.
- `v113.0` adds a direct Worker-owned Google OAuth path at `/auth/google/login` and `/auth/google/callback`, with signed `pbe_google_session` cookies feeding the existing Admin/Owner/RE/User tier model. Public Account and Real Estate Google buttons now target that route; without Google OAuth secrets, it falls back to the legacy Cloudflare Access path.
- `v112.10` changes Account sign-out to target the Cloudflare Access team-domain logout when configured and passes a public return URL, so sign-out has a chance to clear the global Access SSO cookie before the next Google login. Real Estate Google login also carries the same `prompt=select_account` hint.
- `v112.9` backs out the direct Google AccountChooser detour after iPhone testing showed Google rejects that malformed continuation. Public Account sign-in/up now goes straight to Cloudflare Access with `prompt=select_account`; durable account switching still requires the Cloudflare Google identity provider prompt behavior to be set to `select_account`.
- `v112.5` adds signed-in Account sheet sign-out and routes Real Estate Google login through the auth Worker base URL, so client login reaches Cloudflare Access instead of the checkout Worker path that returns `owner_auth_missing`.
- `v110.6` fixes the Real Estate saved-product shelf so ready grouped PDF/video products expose working View/Download controls instead of reopening the selection editor, and enables the local Worker to rehearse Real Estate auth, shelf sync, and ready PDF/video outputs from ignored local client config.
- `v110.5` makes `npm run social:packages` finalize the daily social package before posting: it normalizes custom media-route URLs, creates or refreshes first-party campaign springboards, stages platform upload folders with images/captions/READMEs/manifests, derives Threads when useful, records published URLs or manual blockers, and rebuilds the latest-social campaign index. `v105.2` first published the Latest social homepage shelf and its validation command.
- `v104.3` makes hidden, discarded, undo, Waste Basket, R2 cleanup, and public catalog rebuild paths share the durable Owner SQLite media lifecycle state, with publish validation blocking any hidden/discarded leak into public artifacts.
- `v83.0` publishes the latest Owner-approved title/keyword catalog metadata into the buyer-facing SQLite catalog and Worker catalog while keeping public catalog scale unchanged at `6,019` rows.
- `v83.1` saves rejected title/keyword review comments with the rejected proposal title and keywords attached for the next AI rework rung.
- `v83.2` lowers the JPG 1 MP and 3 MP digital checkout tiers to $0.10 and $0.30, formats cents throughout buyer pricing UI, and adds a Stripe $0.50 minimum-charge top-up when needed.
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo and adds buyer trust notes plus `support.html` for payment, delivery recovery, license, and support expectations.
- `v83.4` promotes the first Photos By Elie Facebook Page post alongside Pinterest features on the homepage.
- `v83.6` adds a localhost-only POD supplier and quality-tier preview, keeps public print checkout gated off, and stores the POD supplier mapping in the public SQLite catalog for Owner inspection.
- `v83.7` lets the Owner import flow choose a local source folder instead of depending only on fixed source anchors.
- `v83.8` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, and durable discarded-photo tombstones, reducing active public rows to `6,016`.
- `v83.9` keeps selected-folder imports focused on import phases, avoids banned-photo cleanup noise in that path, caches import thumbnails, and gives the per-photo import matrix visible working states.
- `v83.10` makes the active/next import matrix state obvious with an inferred active worker row, animated next-queued row, and live dots inside unchecked cells.
- `v83.11` adds the Owner import source pulldown, remembered source storage/discovery, explicit maintenance buttons, and truthful task-scoped progress stacks.
- `v83.12` makes GUI/Dock-launched imports see Homebrew tools such as `exiftool`, `ffmpeg`, and `ffprobe` so selected-folder imports do not fail on a stripped Safari helper PATH.
- `v83.13` opens the native folder chooser as soon as Owner selects `New...` in the import source pulldown and simplifies per-photo import progress to one thumbnail/name row per photo.
- `v83.14` reconciles Owner import waiting counts against the visible processed/active/photo rows so failed rows do not inflate the queue.
- `v83.15` surfaces the already-current import count so Owner can see photos skipped before the current run, removes the noisy per-photo queue summary strip above import thumbnails, and runs import render/upload work with a half-CPU parallel worker pool by default.
- `v83.16` replaces import progress prose with a four-tile stats panel: photos found, processed before, processed this run, and time left.
- `v83.17` made the stats panel restart-honest by separating current-run work from already-current photos; `v83.21` and `v83.22` then stabilized the current-run headline around completed attempts and made the success/failure note add up during parallel work.
- `v83.18` adds horizontal inset to the Owner tab strip so the first tab no longer crowds the left frame.
- `v83.19` renames the Owner Imports tab to Expo, moves it before Real Estate, keeps broad Expo imports to gallery sources only, and adds a Real Estate tab source pulldown plus `RE import` button with the same `New...` folder chooser treatment.
- `v83.20` defaults the Real Estate import source pulldown to the selected client's current source instead of parking on `New...`.
- `v83.21` makes the Owner import stats panel count completed photo attempts under Processed this run, including failures, so the headline count stays stable while failures remain visible in the tile note.
- `v83.22` makes that tile note add up by showing successful completions, routes sweep Python calls through the Pillow-capable interpreter, and preflights Pillow before photo work starts.
- `v83.23` makes discarded/Waste Basket source paths participate in import and export filtering, records source paths in new tombstones, and adds a read-only audit for source-path tombstone dodgers in current manifests/R2 state.
- `v83.24` stops the Expo source pulldown from mining import-log subfolders, restores the Green + 4-star eligibility gate only for Camera imports/exports, leaves AI imports tombstone-driven, and adds an R2 audit/delete pass for ineligible Camera rows.
- `v85.0` adds a public slideshow music mini-app with eleven original subdued Spanish-style guitar cues for real estate previews.
- `v86.0` expands the slideshow music mini-app to twenty-one cues with ten more classical-guitar-leaning studies, tremolo pieces, waltz, and nocturne variants.
- `v86.1` restores Italy rows to the public catalog by teaching import/export country inference about Florence/Firenze, Pisa, San Gimignano, and Tuscany path/GPS hints; the generated SQLite, homepage, Expo manifest, and Worker catalog now agree on `6,664` active rows with Italy at `25`.
- `v86.2` adds ten faster two-guitar slideshow cues with nylon rhythm, lead slides/vibrato, and Latin/world-fusion energy; the music app now offers thirty-one MP3 pieces.
- `v86.3` adds ten gentler single-guitar cues at 80-90 bpm with consonant arpeggios and reduced harmonic tension; the music app now offers forty-one MP3 pieces.
- `v86.4` saves those ten single-guitar cues as the Real Estate slideshow music pool, picks one at random per slideshow manifest, keeps generated music at 0 dB, lowers source video audio by 20 dB, and adds local proof-video generation with randomized Ken Burns motion.
- `v86.5` makes the Real Estate client landing page a produced-product shelf first, with Create new product, View, Download, and Edit affordances for PDF/video deliverables, and keeps output generation offering both view-now and download-file choices.
- `v86.6` improves Real Estate contrast/opacity, adds immediate output progress with ETA hints, and stores browser-generated PDF/video products on the client shelf for repeat view/download/edit flows.
- `v86.7` makes Real Estate PDF preview phone-safe by opening rendered pages in an HTML proof instead of a raw PDF blob, and saves the shelf product as soon as output generation starts.
- `v86.8` makes Real Estate slideshow sound recovery explicit on mobile, softens Ken Burns crop, and replays shelf PDFs directly from the saved product manifest.
- `v86.10` restores the ten older Pisa phone-export Italy rows under their original `2024 Pisa/Pisa, 12 May 2025` IDs, uploading their public previews and private deliverables; Italy now has `33` active rows after two recent Owner blocks.
- `v88.2` makes the Real Estate client page a saved-product shelf first, saves selections through the same cloud deliverables/R2 path as PDFs and videos, uses editable YYMMDD-type sequence names such as `260526-PDF-1`, removes visible selection-file buttons, splits hero stats into Stills/Videos/Albums/Selections, and moves editing into a separate detail flow with Back to shelf plus the five review steps.
- `v89.11` removes the metadata grid and selection table from the Real Estate browser video preview and fades the music across the final slide before playback stops.
- `v89.12` anchors Real Estate browser video titles to the bottom of the actual photo, inside the watermarked image layer, instead of placing them on the blurred backdrop.
- `v89.13` centers those Real Estate browser video titles inside the watermarked photo, removes the Previous/Next preview controls so the surface behaves like playback, and hardens the final-slide music fade before stopping.
- `v89.14` keeps HTML for Real Estate video preview only; download flows now produce true PDF files plus a browser-recorded video file, using MP4 where supported and WebM otherwise, with the same behavior on phone and desktop.
- `v89.15` splits Real Estate PDF and video downloads into separate controls again, starts preparing the browser-recorded video in the background when a selection/settings change is ready, and makes vertical video export use a phone-safe 9:16 MP4 path with fallback recording attempts.
- `v89.16` adds all 29 CC0 Wikimedia Commons Spanish-guitar clips to the public slideshow music gallery with MP3/source/license links, keeps local source metadata in a manifest, and prepares Real Estate video manifests/recording for a final music-credit card whenever a selected track requires attribution.
- `v89.17` trims the public slideshow music gallery to the 20 CC0 clips that are at least 30 seconds long, normalizes those clips to sit near the original cue library loudness, removes the visible mood/file/volume/time clutter, plays all previews at 100%, and adds local star ratings plus local delete/hide controls.
- `v89.18` adds sixteen normalized Pixabay guitar candidates to the top of the public slideshow music gallery for iPhone auditioning, keeps source/author/license metadata, and marks them credit-required so video exports can append music credits.
- `v89.19` expands the public slideshow music gallery to forty normalized Pixabay country candidates: sixteen for Spain plus eight each for Portugal, France, and USA, with phone-friendly country filters and source/author/license metadata for future video music-credit cards.
- `v89.20` makes Real Estate video output use the country-tagged Pixabay music pool instead of the old original cue pool, routes public music playback through the Worker media route, and adds an Output-page music-country selector with Auto from project inference.
- `v89.21` moves the public slideshow music audition gallery onto the same Worker/R2 media route for Pixabay candidates while keeping localhost development on local MP3 files.
- `v89.22` makes the Worker media route honor single-byte `Range` requests, restoring iPhone/Safari playback for R2-hosted slideshow music while keeping the shared gallery and Real Estate audio path on the Worker.
- `v90.0` removes the unnecessary Web Audio gain graph from the public slideshow music audition page and sets CORS on Worker-hosted `<audio>` elements, fixing cross-origin silence on mobile browsers.
- `v90.1` treats an opened native share sheet as a completed Real Estate video handoff so the download button and progress panel no longer stay stuck on "Preparing video..." while the OS share panel is visible.
- `v90.2` hardens Real Estate video recording image loads by retrying public R2 stills through a fetched blob URL and falling back from 1800px to 900px previews when Safari/WebApp refuses a direct image decode.
- `v90.3` makes the Real Estate help modal a first-visit section prompt instead of reappearing per client/gallery context.
- `v90.4` saves the current Real Estate selection before PDF/video preview or download starts and adds an obvious Close preview control inside the browser video preview.
- `v90.5` makes the browser video preview close control return to the Output step when a tab cannot simply close, and hides the sticky Real Estate bottom bar/footer on the mobile Output screen.
- `v90.6` prevents iPhone/Safari video exports from staying stuck on the final slide by requesting pending recorder data, showing a finalizing state, and timing out a missing MediaRecorder stop event.
- `v90.7` makes Real Estate help-modal dismissal survive iPhone/WebApp storage quirks by recording it in localStorage, sessionStorage, and a cookie fallback, and marks the automatic first-view prompt as seen as soon as it opens.
- `v90.8` hides the fixed Real Estate action bar and site footer on all phone-sized Real Estate steps so they no longer cover the wizard or media cards.
- `v90.9` routes Real Estate video recording still images through Worker media URLs first, with 1800px/900px fallbacks, so the MP4 recorder uses the same CORS-safe path as PDF image loading.
- `v90.10` keeps native video share sheets for phone/tablet browsers while making desktop Real Estate video downloads use a normal file download.
- `v90.11` adds per-client Login buttons to the Owner Real Estate client table, opening the matching local review login instead of relying on whichever Real Estate tab is already open.
- `v90.12` makes those Owner row Login buttons seed the localhost client session and open directly inside the matching Real Estate review.
- `v90.13` removes the property-name prefix from default Real Estate photo titles, strips the old prefix at runtime so video/PDF titles do not repeat the property name, raises the Real Estate fixed-header opacity to match the page panels, and makes the desktop bottom action bar show only step-relevant actions.
- `v108.4` improves public discovery with fuzzy gallery/campaign search, canonical URLs, richer public metadata, social preview images, and structured data for the homepage, galleries, campaigns, and photo detail pages while keeping Owner workflow details out of public page metadata.
- `v108.3` moves Real Estate PDF/video production actions onto Worker-backed cloud assembly jobs: saved selection manifests become job input, shelf rows persist pending/ready/needs-attention status and failure reasons, completed records expose view/download URLs, and video jobs carry the source-audio ducking policy under the generated guitar bed.
- `v94.2` adds the Etsy OAuth callback page plus local Etsy OAuth/API smoke-check helpers after Etsy approved the `photosbyelie-listing-publisher` integration. Etsy app credentials and OAuth tokens stay outside git under local environment/config only. Etsy approved the shop rename to `PhotosByElieShop` on 2026-06-02; the public shop URL is `https://www.etsy.com/shop/PhotosByElieShop`.
- `v94.5` restores the original public digital-download ladder after proof-flow testing: camera JPG 1 MP `$8`, JPG 3 MP `$16`, JPG 6 MP `$28`, full resolution `$65`; AI JPG 1 MP `$4`, JPG 3 MP `$8`, JPG 6 MP `$14`, full resolution `$25`.
- Daily automation `pbe-daily-social-posts` prepares Facebook, Instagram, Pinterest, and useful Threads post packages from watermarked public assets, finalizes first-party campaign springboards before posting, and publishes only when existing authentication allows it. Otherwise it leaves ready-to-publish captions, image lists, URLs, manifests, and explicit manual blockers. Pinterest is capped at exactly five images; Facebook and Instagram can use 5-10; Threads uses 3-4.
- On the localhost Title/Keywords review page, Owner can review the current proposal batch, single-click to select a row, double-click for detail, approve with `A`, reject with mutually exclusive horizontal reason checkboxes or `R`, block with the visible Block choice or `H`/`X`, and propagate the current approve/reject/block decision plus reject note with `P`. Individual approvals autosave and advance the selected row to the next photo. Reject reasons fill the note while keeping it editable, and previous reject notes load unchanged for further edits. Video rows show the usual play-triangle overlay on the preview. Rows autosave through the helper server; approved rows apply title/keyword values to generated catalog metadata/state files and add `Title_Keywords_Reviewed`, rejected rows record rework state/comment in `Owner.sqlite`, and blocked rows move to the Waste Basket while showing `Blocked` in the current session. The queue generator uses that stored rejection context to escalate rework attempts through an arbitrary-length saved OpenAI ladder of explicit model/effort strings. Every rung always receives a bounded JPEG and records `vision: true`; the default is `gpt-5.4-mini/low → gpt-5.6-luna/max → gpt-5.6-sol/high`. It records blocker/exhaustion details when a stronger proposal cannot be produced, keeps deterministic metadata as a fallback rather than a selectable model rung, uses a larger Owner-state subprocess buffer, and emits proposal quality counts before writing/importing. Batch `2026-05-24-000237-818Z` is the latest generated review snapshot; `Owner.sqlite` currently has 214 proposed rows, 84 rejected rows, and 62 parked rows. Batch JSON under `assets/owner-actions/title-keyword-review-queue/` is compatibility/audit view data; public deploys should load approved metadata only from the catalog SQLite artifacts. Saved rows remain visible during the current session and disappear after leaving/reloading. Source-file embedded metadata, public previews, private masters, and private render files are left untouched.
- The authoritative useless-keyword list is `Owner.sqlite:keyword_blacklist`; `assets/owner-actions/keyword-blacklist.json` is only a UI compatibility export. Import and export scripts omit those strings from generated keyword metadata and keyword indexes only; the list must not block media, discard media, or rewrite source-file metadata.
- Basketed photos do not re-upload public preview objects while they are blacklisted.
- Basket checkout treats discarded/Waste Basket tombstones as unsellable and currently prunes stale localStorage selections for missing private masters or JPG triplets before payment-sensitive flows. The target delivery model keeps four photo flavors for sale: 1 MP JPG, 3 MP JPG, 6 MP JPG, and full original/developed asset. Videos are full-original delivery only.
- On the localhost Unknown page, cards show title/keyword metadata, same-day unknown counts, day-before/day-after known-country context, and previous/next shooting-day context with relative day distance; arrow keys move the selected card, `H` or `X` baskets it, `U` undoes the last basket action, and double clicking a thumbnail opens a full-screen preview that dismisses on click.
- Assigning an Unknown photo to a country updates every loaded same-day unknown into that country in the local catalog/preview cache, adds the country keyword to catalog metadata, refreshes the Unknown hints, and removes assigned cards from the queue. Owner metadata actions do not rewrite uploaded masters, private render triplets, or public previews; those media objects are treated as immutable after upload except when Waste Basket or discarded media are explicitly deleted.
- Unknown country assignments are written to the local SQLite owner-state tables first, then exported back to the tracked JSONL trail and compact JSON index used by static/browser compatibility paths.
- We are walking away from the old Curation Pass model: localhost Owner actions are live state changes, and any exported `.pbe-review` file is only an audit/batch snapshot.
- The localhost preview can be served by `python3 scripts/local_server.py 8000`, which keeps the public site static while adding localhost-only endpoints for review snapshot saving, Waste Basket updates, Unknown assignment, metadata edits, and R2 maintenance.
- Local owner mutation endpoints are unlocked on localhost by the helper server without a password. For private-LAN owner review, start the server with `--bind 0.0.0.0 --allow-lan-owner`; without that opt-in, owner helper endpoints remain loopback-only.
- The Owner Imports tab has an Apple Photos card backed by localhost-only helper endpoints at `/__photosbyelie/apple-photos/*`. It lists Photos albums, runs a dry-run preflight before any PBE write/upload, records each dry-run/import in `Owner.sqlite:import_operations`, reports missing Photos permission and iCloud-original-not-local assets, exports eligible local bytes to ignored `tmp/apple-photos-import/`, writes `.pbe-apple-photos-assets.json` with asset anchors plus album/date/GPS facts, and starts the selected-folder Expo import from that temporary folder. Preflight and progress now surface PhotoKit resource format labels such as RAW, HEIC, JPEG, and MOV before export; when Photos' rendered JPG callback stalls, import can fall back to an alternate local JPEG/HEIC/RAW image resource while reporting the fallback. For RAW-only Photos assets, import prefers the current rendered JPG and can convert a local RAW/DNG source to a temp JPG if Photos stalls, replacing the retired Saturn/Lightroom developed-JPG export role without importing RAW masters. The Apple Photos card has a default-on burst filter switch that skips conservative burst rejects before any RAW render or resource export, plus a default-on iCloud download switch that allows PhotoKit/Photos to download missing originals or rendered JPGs for the current import run.
- Cloud auth backs the Apple Photos/iCloud-as-source and R2-as-destination direction. Google-backed Cloudflare Access proves the browser email, the Worker access registry maps email addresses to `user`, `re_client`, or `owner`, and `ec92009@gmail.com` is the only Admin bootstrap identity. Real Estate clients can use either the Google-backed path or an ACS-managed gallery-scoped password login. Passwords are PBKDF2-hashed in D1; ACS can create, replace, or revoke them but never returns plaintext passwords or stored hashes.
- The retired localhost Owner dashboard still has compatibility endpoints for older Real Estate client/import settings, but new credential administration belongs in ACS and new Apple Photos routing belongs in the canonical cloud Owner. The Real Estate importer recursively discovers the `RE / Fixture / Sub-fixture` intake, keeps Apple Photos JPEGs as private masters, permits explicitly approved truthful display overrides for 900/1800 previews, publishes a sanitized public context under `assets/real-estate/<client>/app-context.js`, runs R2 upload dry-runs, and can upload public previews plus private masters.
- Real Estate public contexts expose client/gallery metadata only. Client credentials or hashes belong in ignored local Owner settings and Worker secrets; the public login gate uses the Worker-backed signed session flow.
- The Owner dashboard summarizes tracked R2 coverage for private masters, private JPG 1/3/6 MP deliverables, and public preview assets. Fill in gaps repairs listed catalog coverage gaps only; the import source pulldown can run `All` fixed anchors or open a native chooser from `New...`, and Start Expo import scans the selected source. Before any photo work is queued, the sweep preflights Pillow, `exiftool`, `ffmpeg`/`ffprobe`, R2 upload configuration, and source folder readability so Owner sees one actionable dependency/source status. Edited source files are re-rendered and re-uploaded when the importer detects source changes, but the next import hardening pass should make the source identity rule explicit: full source pathname plus modified date, with same-path re-exports overwriting the previous generated forms instead of creating duplicate media rows. Coverage excludes Waste Basket tombstones from active repair targets and can surface active media missing private masters or photo triplets, preferring Saturn/source-file repair when possible. The Cloud Sync progress rail shows source-lane progress, cached localhost-only source thumbnails when available, one thumbnail/name row per visible photo, a four-tile import stats panel for found/before/current-run/time-left counts with failed attempts called out separately, the active render/upload worker pool, and catalog-blocked sweeps as a clear needs-attention export phase instead of leaving downstream rows looking idle. The new R2 target is `expo/<media-id>_900.jpg` for `still_900`, `expo/<media-id>_1800.jpg` for photo `still_1800`, `expo/<media-id>_short_5s_720p.mp4` for video detail previews, `renders/<media-id>_{1,3,6}mp.jpg` for sellable photo JPGs, and `masters/<media-id>.<format extension>` for full delivery.
- Unified import work has begun in `Owner.sqlite:import_operations`. Direct Apple Photos dry-runs/imports record `sourceKind=apple_photos`, while old folder-based Expo sweeps record `sourceKind=legacy_folder` with `canonicalSource=apple_photos` so future cleanup can identify recovery imports that may duplicate canonical Apple Photos assets.
- Every page has the shared footer band; the Owner link appears only on localhost.
- On gallery pages, `g` makes the grid less dense/larger and `G` makes it denser/smaller; on localhost, single click moves the selection rectangle, Enter or double click opens detail, and the Grid slider adjusts thumbnail density within the current viewport limits.
- On localhost Owner gallery pages, `Z` cycles Fill, Fit, and Cull. Cull keeps strict left-to-right fixed cells while containing the whole preview, so `H`/`X` culling does not jump through masonry.
- Home and gallery filters share the same search/filter/sort helpers. Gallery filters cover media type, date from/to, orientation, adaptive size/duration, color mood, subject, and sort; video mode treats the size filter as duration and disables color mood unless video mood analysis is available.
- When a photo detail page is opened from a gallery, Previous/Next follows that gallery's current filtered and sorted grid order, and returning to the gallery preserves `Show all` rather than collapsing back to the first 24 items.
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
- Etsy API setup uses `scripts/etsy_oauth.mjs`, `scripts/etsy_api_check.mjs`, and `docs/sops/ETSY_API_SOP.md`. OAuth and API smoke checks are proven locally, the approved shop is `PhotosByElieShop`, and the current next step is draft/dry-run listing payloads from public catalog data, first-party campaign/gallery URLs, and watermarked public previews only.
- Detail pages support previous/next buttons and left/right arrow keys that continue across collection boundaries on both public and localhost builds.
- Detail pages support `L` to like/unlike and double click on the preview to open a full-screen overlay that dismisses on click or double click.
- Detail pages preserve the original preview aspect ratio; landscape previews use a wide, space-maximizing layout while portrait and square-ish previews align to the top of the detail panel.
- Detail pages surface available embedded metadata such as metadata title, description, capture time, software, lens, exposure, focal length, and video duration when available.
- Visible `PhotosByElie` watermark overlays protect homepage, gallery, basket, and detail preview images.
- Checking or unchecking a product on detail immediately updates localStorage.
- Tapping the heart on a detail preview immediately updates the browser-local liked list.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Full resolution choices show the verified developed source format, such as `JPG preview/export` or `TIFF preview/export`.
- Detail and basket pages now state the baseline personal print/web license and call out that commercial, resale, and AI-training use need written approval.
- The basket page generates a static order-intent summary and mail draft from the local basket contents, checks the configured checkout Worker for selected items already covered by the recent-purchase download allowance, and can call the Worker for guest checkout. When the Worker is configured with Stripe secrets, buyers are redirected to hosted Stripe Checkout; local mock mode can still simulate payment with `?workerBase=http://localhost:8787`. After payment, buyers land on `order.html` with order status and a per-file private download list.
- The private Real Estate review page defaults to the Elie client bundle on bare `real-estate.html?logout=1`, can load another tracked client with `?client=<client>`, and still accepts a same-origin bundle with `?context=<path>`. On GitHub Pages it reads `assets/real-estate/<client>/app-context.js`; on localhost it reads the matching ignored `tmp/real-estate-import/<client>/app-context.js` bundle. The tracked public-safe client bundles now include Agnes, Corine, and Elie contexts; Agnes is deliberately scoped to the 14-photo La Concha Common album and uses its own gallery key and browser-storage namespace. It has a static client access gate with a password visibility toggle, lands clients on a saved-product shelf, lets each saved row reopen its manifest for editing, and keeps the product name inline editable. Saving a selection writes a `selection` product through the cloud deliverables path, so clients can resume without local selection files. PDF and video production buttons now submit that saved manifest to Worker-backed cloud assembly jobs; the shelf persists pending, ready, and needs-attention states, completed records return authenticated view/download URLs, selected videos still use 10% stills for PDFs, and video manifests preserve source video duration while specifying source audio ducking under the country-matched Pixabay guitar bed. The detail flow persists selected media IDs and edited PDF titles with the store keys emitted by the importer, lets selected media be assigned to one or more projects and reordered in the output draft basket, still accepts legacy JSON batch manifests, and can ask the Worker for selected private original download tokens through a masked in-page password dialog so the browser can build one shareable ZIP. Localhost Owner maintains ignored client credentials/config at `assets/owner-actions/real-estate-clients.local.json`, supports client-name or email login identifiers, imports property media, publishes public-safe context bundles, runs R2 upload dry-runs or uploads, and prepares the Worker real-estate gallery secret payload.
- The order page shows explicit payment, file preparation, and download phases; cloud delivery failures are shown as blocked delivery instead of indefinite preparation. Buyers can recover an order from `order.html` by entering the order ID and checkout email.
- Public cloud delivery avoids building one large archive in the Worker. The deployed Worker creates one signed-style download token per purchased file, streams each private R2 object separately from the order page, exposes each token's availability window, and records successful download events on the order. When Resend is configured with a Worker secret, paid ready orders also trigger a buyer delivery email with the order recovery page and direct per-file download URLs.
- The checkout Worker expects JPG 6 MP, 3 MP, and 1 MP buyer deliverables to exist in private R2 under `renders/...`; those unwatermarked files are generated by the media pipeline on the machine that owns the developed masters and reused for future per-file delivery.
- Stripe sandbox checkout is proven end to end, and live checkout proof has also succeeded. The live Stripe account has saved receipt branding, successful-payment receipts enabled, and a live `checkout.session.completed` webhook pointing at the deployed Worker. Live Cloudflare secrets are installed outside git; never store those values in this repo.
- `assets/private-delivery-manifest.json` tracks private master/render coverage for catalog photos.
- `assets/discarded/discarded-photo-ids.json` and `assets/discarded-media-manifest.json` are historical compatibility/repair artifacts. `Owner.sqlite` is authoritative for current Waste Basket entries, provenance, receipts, and tombstones; legacy cleanup skips gateway tombstones and never turns X into a delete operation.
- Product choices are digital-only by default. Owner can deliberately enable physical print/frame options on localhost with the Physical items toggle for local review; the catalog's POD storefront flag remains off.
- Published camera-photo digital prices are JPG 1 MP `$8`, JPG 3 MP `$16`, JPG 6 MP `$28`, and full resolution `$65`. Checkout still protects against Stripe's `$0.50` minimum charge, though every public price is above that floor.
- Owner shows an editable local price-list table for the current camera digital resolution tier, print sizes, frame add-ons, POD supplier mappings, and shipping/handling offsets.
- Physical print defaults are localhost-only starter sizes: $48 for 12x16, $68 for 16x20, and $82 for 18x24 before optional framing.
- POD supplier preview rows model Prodigi as the value/primary route, Printful as the standard fallback route, theprintspace as the premium candidate, and Gelato as the API-proof/global-routing candidate. Supplier ordering is not live checkout behavior until samples, policy, API keys, and Worker fulfillment are approved.
- Print offers infer the preferred measurement system from browser locale, showing inches first for US-style locales and centimeters first for metric locales while keeping both units visible.
- Selected prints carry a count stepper and a per-print frame choice: no frame, white frame, or black frame. Using the count stepper or choosing a frame selects that print automatically, and frame mock prices scale by print size.
- Downloads have free shipping and handling. Physical prints show a mock S&H amount by size, added and removed as a limited-time discount so the payable mock total stays unchanged.
- The generated order email includes a per-photo review with selected products, source confidence, review links, S&H add/discount lines, and subtotals.
- In the basket, unchecking every resolution keeps the photo row available for later reselection; only Remove deletes it.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.

## Worker Checkout Track

`worker/checkout-worker.mjs` is the trusted checkout/fulfillment track. The Worker owns order numbers, USD totals, basket validation, buyer email, payment status, delivery metadata, Real Estate originals sessions, signed-link-style download tokens, recent-purchase allowance checks, optional buyer delivery email status, and privacy-conscious first-party conversion analytics. Stripe remains the payment authority; the Worker creates an order draft and Checkout Session, sends the buyer email into Stripe receipt metadata, sets the card statement descriptor suffix to `DOWNLOAD` by default, then waits for a verified paid webhook before marking delivery ready and, when Resend is configured, sending the delivery email. For local end-to-end testing, `worker/local-server.mjs` runs the Worker on `http://localhost:8787`, uses `worker/local-zip-delivery.mjs` to write mock ZIPs under `deliveries/`, serves token downloads during the live mock session, and serves order-ID fallback downloads from `/download-order/:orderId` when the ZIP exists on disk. For public checkout, `worker/deployed-worker.mjs` uses Cloudflare KV for order state, real Stripe when `STRIPE_SECRET_KEY` is configured, private R2 per-file download tokens for full-resolution masters, Real Estate originals, and generated JPG renders, plus Resend for post-payment delivery emails when `RESEND_API_KEY` is installed as a Worker secret. Download tokens default to 30 days and 100 successful downloads, with KV retention controlled by Worker environment values; the basket's duplicate-purchase check uses the same Worker order records as the purchase/download history source. `media-config.js` can point the public site at that deployed Worker with `checkoutWorkerBaseUrl`.

Live Stripe dashboard state as of 2026-05-22:

- Account: `acct_1TWCksPuO9o6fOp6`
- Successful-payment customer receipts: enabled
- Live webhook: `we_1TZmoVPuO9o6fOp6JkBENiyV`, endpoint `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook`, event `checkout.session.completed`, API version `2026-04-22.dahlia`
- Branding assets: `assets/branding/photosbyelie-camera-tripod-logo-512.png` and `assets/branding/photosbyelie-camera-tripod-wordmark.png`
- Brand colors: `#5B341E` and `#D86A3E`
- Live proof: order `PBE-20260522-BA062E956C`, `$8.00` paid, `$7.47` incoming after Stripe fees, Worker order `ready`, one private JPEG download verified

Run the Worker tests from the repo root:

```bash
node --test worker/checkout-worker.test.mjs
```

See `worker/README.md` for route examples and Stripe/mock configuration.
