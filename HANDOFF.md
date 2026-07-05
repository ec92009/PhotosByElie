# PhotosByElie Handoff

Use this when moving work between Max, David, or the laptop.

For Owner DB state and other sensitive Max/David handoffs, follow
[`docs/sops/MAX_DAVID_SYNC_SOP.md`](./docs/sops/MAX_DAVID_SYNC_SOP.md).
GitHub carries code, safe metadata, SOPs, and handoff notes; private Owner DB
snapshots and client artifacts move through private R2; SSH/Codex Remote SSH is
for remote execution.

## Current Handoff: 2026-07-05 Sidecar Upload/Catalog Cleanup

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Branch: `main`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local preview: `http://localhost:8000/`
- Current visible build: `v125.0`
- Sidecar local build: `v126.2`
- Public catalog source of truth: `assets/catalog/photosbyelie.sqlite`
- Owner workflow source of truth: ignored local `assets/owner-actions/Owner.sqlite`
- Current public catalog: `7,770` media rows.
- Current gallery counts: AI `5,076`, France `379`, Italy `70`, Mexico `31`, Portugal `214`, Slovakia `2`, Spain `1,853`, USA `145`.
- Queue health after cleanup:
  - Upload Bridge uploadable count: `0`.
  - Upload Bridge active blocked approved rows: `0`.
  - Upload Bridge missing key count: `0`.
  - Picked AI metadata candidate count: `0`.
  - Uploaded-catalog registration dry-run: `2,676` candidates, all `already_in_catalog`.
  - Public catalog SQLite integrity: `ok`.
- Review backlog created by this cleanup:
  - `20` unknown-gallery/generic-title rows are back in unpicked rework with `gallery-signal` notes.
  - `24` persistent Photos export failures are back in unpicked rework with `source-export-failed` notes.
  - `63` unpicked/proposed rows are harmless but state-untidy; decide whether to keep proposals as context or normalize them.
- Latest closeout commits before this docs handoff:
  - `3c58fe88 photosbyelie: harden sidecar upload workflow`
  - `9154ef16 photosbyelie: refresh public catalog and owner surfaces`
  - `cc3bb953 photosbyelie: record working tree cleanup`
- First action on another machine:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
python3 scripts/sidecar_maintenance.py picked-ai-plan
python3 scripts/sidecar_state_db.py --upload-bridge-plan
python3 scripts/sidecar_maintenance.py register-uploaded-catalog --dry-run
```

- Sidecar PhotoKit automation must launch through the permission-bearing app bundle, `~/Applications/PhotosByElie Photos Bridge.app`, via LaunchServices. Do not call `swift scripts/apple_photos_bridge.swift` or the bare bundle executable for scheduled Sidecar automation.
- Approved Upload Bridge rows with generic titles and no country/gallery signal should be blocked from queueing until metadata is repaired.
- Owner quick previews now fall back to the same public media URL a regular visitor receives when original source files cannot be resolved.
- Owner title/keyword edits for SQLite-backed catalog rows should write through the localhost helper to `assets/catalog/photosbyelie.sqlite` and regenerate the Worker catalog; the old TSV writer path is not the authority.
- Public deploy verification after GitHub Pages catches up: confirm public `v125.0`, Italy `70`, repaired portrait previews, and regular-user quick preview behavior.

## Historical Handoff: 2026-06-21 Direct Google Auth / Max Testing

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Branch: `main`
- Public site: `https://photos-by-elie.com/`
- Current visible build: `v113.0`
- Auth Worker/custom domain: `https://auth.photos-by-elie.com`
- Worker version after direct OAuth route deploy: `87e9419f-f47c-472b-80c8-fa7e8dbae07c`. Direct OAuth secrets are enabled, so `/auth/google/login` now redirects to Google with `prompt=select_account` and `redirect_uri=https://auth.photos-by-elie.com/auth/google/callback`.
- Latest relevant commits:
  - current `v113.0` implementation: public Account and Real Estate Google buttons target the Worker-owned direct OAuth route at `/auth/google/login`; successful callback sets a signed `pbe_google_session` cookie that feeds the existing role registry
  - `v112.10` experiment: Account sign-out targeted the Cloudflare Access team-domain logout URL, but iPhone testing still ended in Cloudflare's no-cookie page or reused the previous Google account
  - `v112.9` rollback: remove the direct Google AccountChooser detour after Google returned a malformed-request page
  - `cf7fc214 photosbyelie: add account sign out`
  - `08d38809 photosbyelie: fix real estate google login host`
  - `c757d26a photosbyelie: activate google access login`
  - `88e07204 photosbyelie: add public google account entrypoint`
- Max first action:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
npm install
npm test
npm run validate
```

- Test the public homepage account icon near the Settings cog, Google sign-in, signed-in account sheet, and `Sign out`.
- Direct `https://auth.photos-by-elie.com/` visits should redirect to `https://photos-by-elie.com/?account=1`, not show raw Worker JSON.
- Account sign-in/up should go through direct Google OAuth on `https://auth.photos-by-elie.com/auth/google/login`, not through Google AccountChooser and not through the protected `/auth/login` Access app. The Worker includes a safe fallback: if direct OAuth secrets are not configured, `/auth/google/login` redirects to the legacy `/auth/login` path.
- Current account-switching blocker: `PBE-20260620-342B`. Cloudflare Access prompt/logout experiments did not reliably let iPhone Safari choose another Google account. The durable path is direct Google OAuth with `prompt=select_account`, controlled by the Worker.
- Direct OAuth activation state: the Google OAuth client now authorizes `https://auth.photos-by-elie.com/auth/google/callback`, and the Worker has `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_SESSION_SECRET` set as secrets. Live `/auth/google/login` has been verified to redirect to Google with the Worker callback.
- Test Real Estate Google login from `real-estate.html?client=corine` or the current client key. It should route through `/auth/google/login`, return to the RE page with `access=1`, then `/real-estate/access-login` should mint the gallery-scoped session.
- Test `owner.html` after signing in with an Owner/Admin Google account. The public dashboard should open read-only with localhost-only import, upload, cleanup, publishing, and role-management actions disabled; full mutation actions still require the localhost Owner helper.
- Expected role behavior: ungranted verified Google users remain normal users; granted RE client emails are limited to their assigned gallery keys; Owner work requires an Owner grant and still treats local David admin as the role-management authority.
- If stale Cloudflare Access state causes confusing results, verify whether direct OAuth secrets are actually enabled. Once direct OAuth is active, Account -> Sign out only needs to clear the Worker Google session cookie and return to the Account sheet.
- Google OAuth client credentials and Worker secrets stay outside git. Do not copy secrets into repo docs or handoff files.

## Handoff Direction

- Gmail self-email is retired for Max/David handoff instructions and reports. Do not search, send, or treat Gmail as authoritative for this workflow unless the user explicitly asks about a specific message.
- Primary Max/David transport is the repo/GitHub handoff files, with mesh, SSH, or Codex Remote SSH used for live coordination when available.
- Max-to-David prompts belong in `MAX2DAVID.md`; David-to-Max acknowledgements, progress, blocked states, decisions, recommended prompt/spec changes, and final reports belong in `DAVID2MAX.md`.
- If `hostname` or ComputerName starts with `David`, read `MAX2DAVID.md` as inbound from Max and write outbound reports to `DAVID2MAX.md`.
- If `hostname` or ComputerName starts with `Max`, read `DAVID2MAX.md` as inbound from David and write outbound instructions to `MAX2DAVID.md`.
- Use `MAX_DAVID_CHAT.md` only for legacy/manual quick notes or when a conversational scratchpad is explicitly useful.
- Before David starts acting on a new Max task, David should update `DAVID2MAX.md` with `David: starting <short task name>` and commit/push it, or send the same acknowledgement over mesh when that is the active live channel.
- Do not edit the opposite-direction file unless the user explicitly asks; record requested prompt or spec changes in the outbound file instead.

## Historical Handoff: 2026-05-22 Revenue Track

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local owner preview: `python3 scripts/local_server.py 8000`
- Current visible build: `v94.5`
- Social/Pinterest/Threads destinations should point to first-party campaign mini-collections or a fresh homepage latest-social shelf whenever practical, so buyers can browse related photos and escape embedded browsers before checkout/download. Broad gallery URLs remain acceptable fallbacks only when a campaign/homepage change is unnecessary or unsafe.
- Etsy approved the `photosbyelie-listing-publisher` API integration by email on 2026-06-01 at 20:54 UTC. OAuth and API smoke checks are proven locally with credentials/tokens stored outside git. Etsy approved the shop rename to `PhotosByElieShop` on 2026-06-02; the API shop record reports shop `42422777`, public URL `https://www.etsy.com/shop/PhotosByElieShop`, and `0` active listings. The next Etsy step is draft/dry-run listing payload generation from public catalog data and watermarked public previews only.
- Recent baseline commits include: `8193a5ee photosbyelie: record social browser checks`, `cc886957 photosbyelie: prepare 2026-05-27 social packages`, `2bae81d4 photosbyelie: simplify pinned collections shelf`, and the new `v88.2` Real Estate saved-selection shelf pass.
- Current business direction: focus on turning the site into a selling machine. Payments, delivery trust, buyer offer clarity, pricing, curation, analytics, SEO, landing pages, and launch outreach now lead the backlog.
- Public Expo catalog: `6,672` publishable media rows after the Pisa phone-export restore: AI/Leonardo `4,921`, France `315`, Italy `33`, Mexico `2`, Portugal `216`, Slovakia `2`, Spain `1,024`, USA `159`. Compared with the earlier `6,016`-row checkpoint at `736fe76b`, the catalog is `+656` rows overall; Italy was restored from `0` to `25` by adding Florence/Firenze, Pisa, San Gimignano, and Tuscany country hints, then the ten older `2024 Pisa/Pisa, 12 May 2025` phone-export rows were restored under their original IDs. Two recently blocked Italy rows are excluded from the active count.
- Public catalog data is SQLite-backed: `assets/catalog/photosbyelie.sqlite` is the active plain payload, and `photos-data.js` is the bootstrap for the existing `window.photosByElieData` browser contract. Brotli `.sqlite.br` is legacy-only and not part of normal operations.
- Waste Basket is the Owner-facing model for unwanted photos. Basketed photos are live-blacklisted and can be put back; emptying the basket deletes public previews, private masters, and private render triplets, then leaves durable tombstones so those masters do not return.
- Waste Basket purge was intentionally paused during catalog migration. Resume only when ready to monitor the `Cloud media left` progress.
- Tombstoned/Waste Basket photos are not buyer inventory. Basket checkout now prunes stale browser selections for tombstoned photos and validates selected private master/render availability before Stripe.
- Owner R2 coverage excludes Waste Basket tombstones from active repair targets and can list missing private masters/triplets for active photos, preferring Saturn/source-file repair when the source path resolves. The Owner dashboard is grouped into Review, Expo, Real Estate, Catalog, Cloud, and Commerce tabs, with cloud sweep progress details shown inline by phase.
- Local Owner actions are unlocked by `scripts/local_server.py` on localhost without a password. Add `--bind 0.0.0.0 --allow-lan-owner` only when a private-LAN owner review session is intentional.
- Public previews are watermarked and public in R2 under flat `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg` keys.
- Public browsing now loads previews through the custom Worker media route: `https://download.photos-by-elie.com/media`.
- The checkout Worker is no longer in the public preview hot path. Keep it focused on checkout, order state, Stripe/webhook handling, pre-Stripe private-file validation, and delivery.
- Private developed sources are in `photosbyelie-private/masters/<photo-id>/<original-file>`.
- Private buyer JPG deliverables are in `photosbyelie-private/renders/<photo-id>/<original-file>-jpg-{6mp,3mp,1mp}.jpg`.
- Public buyer delivery uses per-file private R2 download tokens. Local mock delivery can still generate flat ZIPs for test convenience.
- Uploaded masters, private render triplets, and public previews are treated as immutable after upload. Owner title/keyword/country edits update manifests/catalog SQLite/bootstrap files only; a future Lightroom-style XMP sidecar save should be an explicit Owner maintenance action.
- Physical print/frame products are buyer-hidden by default. Owner can deliberately enable them on localhost for review, but digital checkout should be proven first.
- Owner has local price editing. Published digital checkout defaults now use the restored original ladder: camera JPG 1 MP `$8`, JPG 3 MP `$16`, JPG 6 MP `$28`, full resolution `$65`; AI JPG 1 MP `$4`, JPG 3 MP `$8`, JPG 6 MP `$14`, full resolution `$25`. The buyer Pay section and Worker still include Stripe minimum-charge protection, though current public prices are above that floor.
- Camera vs AI is now a first-class catalog origin (`sourceOrigin`) used by public gallery filters, detail metadata, Owner active-catalog counts, and Worker checkout pricing. Do not rely only on the `ai` collection slug for AI-origin behavior.
- Public pages use English/French/Spanish translation. Owner-only localhost pages remain English-only by design.
- Waste Basket review now uses the shared gallery-card treatment and the same density/fit masonry behavior as public galleries.
- Public collection pages use the shared `gallery.html?gallery=<slug>` route.
- `v80.8` publishes the latest Owner title/keyword approvals into the public SQLite catalog and Worker catalog, adds model provenance to the Owner title/keyword review cards, defaults Owner Review to the title/keyword queue, and clears stale proposed rows that are already blocked or missing from the public catalog.
- `v81.4` publishes 239 approved title/keyword rows from batch `2026-05-19-230413-165Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- `v81.10` publishes 53 approved title/keyword rows from batch `2026-05-20-093025-705Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- `v82.0` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, Worker catalog, discarded media manifests, and the Corine Real Estate context timestamp.
- `v82.1` keeps the documented Nerja Best Mix glass alpha/frosting recipe, harmonizes shared filter/control heights, and stabilizes the homepage photo-stack entrance animation.
- `v82.2` changes the first-open gallery density fallback to 3 columns while preserving any saved user density choice.
- `v82.5` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, Worker catalog, and durable discarded-photo tombstones.
- `v82.7` hardens buyer order recovery and delivery links: `order.html` can look up an order by order ID and checkout email, Worker download tokens carry expiry/limit metadata, successful downloads are recorded on the order, and Stripe Checkout receives the buyer email for receipts.
- `v83.0` publishes Owner-approved title/keyword metadata into the buyer-facing SQLite catalog and Worker catalog, and refreshes the keyword blacklist compatibility export.
- `v83.1` saves rejected title/keyword review comments with the rejected proposal title and keywords attached for the next AI rework rung.
- `v83.2` lowers JPG 1 MP and 3 MP checkout tiers to $0.10 and $0.30, formats buyer pricing in cents, adds the Stripe $0.50 minimum-charge top-up, and adds a Dock launcher for localhost Owner.
- `v94.5` restores the original public digital-download ladder after proof-flow testing: camera `$8 / $16 / $28 / $65` and AI `$4 / $8 / $14 / $25` for JPG 1 MP, JPG 3 MP, JPG 6 MP, and full resolution.
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo, adds buyer trust notes to basket/order, and adds `support.html` for payment, delivery recovery, license, and support expectations.
- `v83.4` promotes the first Photos By Elie Facebook Page post alongside Pinterest features on the homepage.
- `v83.6` adds localhost-only POD supplier readiness, quality-tier routing, supplier option, and catalog schema preview panels in Owner Commerce while keeping public print checkout gated off.
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
- `v83.17` makes the stats panel restart-honest by counting only successful imports under Processed this run and surfacing failed attempts in the tile note.
- `v83.18` adds horizontal inset to the Owner tab strip so the first tab no longer crowds the left frame.
- `v83.19` renames Owner Imports to Expo, moves Expo before Real Estate, keeps broad Expo imports gallery-only, and puts the Real Estate source pulldown plus `RE import` button inside the Real Estate tab.
- `v83.20` defaults the Real Estate source pulldown to the selected client's current source so `New...` remains an explicit choice.
- `v83.21` makes Processed this run count completed photo attempts, including failed attempts, so the tile remains stable while failures stay visible in the note.
- `v83.22` makes the Processed this run note include successful completions, runs sweep Python calls through the Pillow-capable interpreter, and preflights Pillow before queuing photos.
- `v83.23` makes discarded/Waste Basket source paths participate in import and export filtering, records source paths in new tombstones, and adds a read-only audit for source-path tombstone dodgers in current manifests/R2 state.
- `v83.24` stops the Expo source pulldown from mining import-log subfolders, restores the Green + 4-star eligibility gate only for Camera imports/exports, leaves AI imports tombstone-driven, and adds an R2 audit/delete pass for ineligible Camera rows.
- Live checkout Worker version `143f9f7f-ab55-4f82-9a68-88e4ab663cdb` is deployed with the `v83.2` price/minimum-charge catalog and `DOWNLOAD` card statement descriptor suffix.
- Stripe sandbox checkout is proven end to end: success, decline, 3D Secure, webhook delivery, order recovery, per-file download, and download-all were manually verified.
- Live Stripe account `acct_1TWCksPuO9o6fOp6` is configured with the camera-tripod branding, brand color `#5B341E`, accent color `#D86A3E`, successful-payment customer receipts enabled, and refund emails off.
- Live Checkout card statement descriptor suffix is `DOWNLOAD`, so future charges should display like `PHOTOSELIE* DOWNLOAD` with the current Stripe descriptor prefix.
- Live Stripe webhook destination `we_1TZmoVPuO9o6fOp6JkBENiyV` is named `PhotosByElie Worker checkout` and posts `checkout.session.completed` to `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook` on Stripe API version `2026-04-22.dahlia`.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git.
- Live checkout proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming after Stripe fees, Worker order status `ready`, and one private JPEG download verified at `401,035` bytes.
- Price/offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`. It recommends keeping launch digital-only and, after owner approval, replacing the proof-flow low tiers with a real camera ladder of `$3 / $8 / $28 / $65` and a lower AI ladder of `$2 / $5 / $14 / $25`.
- Local POD preview draft: first print sizes are 12x16, 16x20, and 18x24; Prodigi is the primary/value route, Printful is the standard fallback route, theprintspace is the premium candidate, and Gelato stays as API-proof/global-routing candidate. `pod_settings.storefrontEnabled` remains false.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is `v90.13`; default Real Estate photo titles no longer include the property name, and the viewer strips the old `{property} - ` prefix at runtime so video/PDF output does not repeat the property name. The Real Estate fixed header is also more opaque so it matches the page panels instead of looking like a separate translucent strip, and the desktop bottom action bar hides output downloads until the Output step plus hides Clear selected until a selection exists after the shoot-picking step. The Owner Real Estate table has a per-row Login button that seeds the local session from the Owner-only client password and opens directly inside that client's matching local review context. The Real Estate client page starts on a saved shelf, saves current selections through the cloud deliverables/R2 path, names products with editable YYMMDD-type sequences, removes visible selection-file buttons, and opens prior work into a separate detail flow with Back to shelf plus Property/Photos/Titles/Order/Output navigation. PDF and video preview/download actions now save the active selection before rendering starts, so closing the browser mid-preview does not lose the current work. The browser video preview shows only the slideshow plus an obvious Close preview button and Play/Pause controls; if the preview cannot close its own tab, it returns directly to the Real Estate Output step instead of the generic entry page. On phone-sized Real Estate screens, the fixed Real Estate action bar and site footer are hidden across all steps so the wizard and media cards are not covered by repeated chrome. Video previews keep centered titles anchored to the bottom of the actual watermarked photo and fade music across the final slide before playback stops. Download flows keep HTML as preview-only and expose separate PDF and video file buttons; desktop video download now uses a normal file download instead of the native Safari share sheet, while phone/tablet-style browsers keep the native share behavior. The video file is prepared proactively after selection/settings changes, MP4 where supported and WebM otherwise, with a phone-safe vertical MP4 path. Real Estate video recording now requests pending MediaRecorder data before stop, reports a finalizing state after the last slide, uses a stop-event watchdog so iPhone/Safari does not stay forever on "Recording slide N/N," and loads still frames through Worker media URLs before direct R2 URLs with 1800px/900px fallbacks. Real Estate help dismissal is section-wide, not per gallery, while old per-gallery dismissals still count; v90.7 records dismissal in localStorage, sessionStorage, and a cookie fallback, and marks the automatic first-view prompt seen as soon as it opens. Real Estate video output uses the forty normalized Pixabay country candidates instead of the old original cue pool, picks Spain/Portugal/France/USA from the Output-page selector or Auto from project inference, routes public music playback through the Worker media route, and keeps required credit metadata in the slideshow manifest. The public slideshow music audition gallery reads Pixabay candidate metadata and MP3s from the same Worker/R2 media route on GitHub Pages, localhost still uses local files, the Worker preserves byte-range audio responses, and the gallery now uses direct CORS-enabled audio playback instead of a Web Audio graph so mobile browsers do not mute cross-origin MP3s. The next Real Estate hardening pass should move final PDF/video assembly fully server-side and rehearse one complete public client lifecycle.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest, then `npm run social:packages -- --date YYYY-MM-DD` finalizes first-party campaign targets, stages drag-ready local upload trees under `socials/{Platform}/YYYY-MM-DD/{theme-slug}/`, derives Threads from Instagram when useful, records published URLs or manual blockers, and publishes only when existing authentication allows it.
- The 2026-05-25 daily social package is prepared from public R2 previews only: Facebook `Albi River and Brick Cathedral` has 8 images, Instagram `Madrid Chapels and Courtyards` has 10 images, Pinterest `Northern Portugal Green Horizons` has exactly 5 images, and Threads has a 4-image Madrid variant. The Threads onboarding/test post was manually completed from Chrome; no platform URL was captured.
- The tracked QR coaster 3MF assets were refreshed after print/underside review. Treat them as current printable project files unless a newer slicer/export pass replaces them.

## First Commands On A Machine

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
npm install
npm test
npm run validate
python3 scripts/local_server.py 8000
```

Then open:

```text
http://localhost:8000/
http://localhost:8000/owner.html
```

If the checkout path is upper-case on a machine, use:

```bash
cd /Users/ecohen/Dev/PhotosByElie
```

## Current Priority

1. **Move Real Estate PDF/video assembly fully cloud-side.**
   - Use saved selection manifests as job inputs and keep local machines out of production output creation.
   - Return durable view/download URLs plus job status/failure detail back to the shelf.

2. **Run a full Real Estate client rehearsal.**
   - Import/publish/upload one client property set, save a selection, generate PDF/video, reopen from mobile, rename, and delete a throwaway product.

3. **Create first-party social springboards and a homepage latest-social shelf.**
   - Start with the 2026-05-27 social packages and use only public catalog data and watermarked public previews.
   - Apply the visible-site versioning SOP, validation, commit, and push before using any new URL in social posts.

4. **Teach the daily social automation to prepare the target before posting.**
   - Create or choose the first-party campaign/homepage target, stage platform upload trees, and record published URLs/manual blockers.
   - Keep Pinterest exactly five images; keep Facebook/Instagram at 5-10; add Threads 3-4 image variants only when useful.

5. **Finish import re-export de-duplication and clean duplicates.**
   - Use full source pathname plus modified date as the source anchor.
   - Same-path re-exports with a newer modified date should overwrite the previous master, previews, and JPG triplets rather than creating a duplicate photo.
   - Audit today's imports and prepare a reversible duplicate cleanup before deleting anything. The Italy audit proved selected-root subfolder imports can derive duplicate IDs for already-known source files.

6. **Add import source history management.**
   - Let Owner remove missing or stale remembered folders, optionally pin favorites, and inspect the last-used time/source path before starting a run.
   - Include a one-time review of any legacy entries saved before `v83.24`, because log-discovered folders are no longer added automatically but older remembered rows may still exist locally.
   - Keep `Owner.sqlite` authoritative; do not introduce another JSON state file.

7. **Keep Owner/generated state handoff-ready.**
   - Review local approval/proposal/discard/catalog state before each generated-data commit.
   - Commit tracked manifest changes only when they represent durable R2/catalog state.
   - Keep unrelated local edits out of feature commits.

8. **Review checkout trust and buyer support wording.**
   - `v83.3` ships conservative support/license defaults; owner should approve or adjust refund, delivery-refresh, and commercial-use language before heavier launch traffic.
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current refund/support policy draft before editing public copy.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

9. **Make checkout and delivery production-durable.**
   - Choose D1 vs KV for longer-term order state.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, delivery file keys, and download timing.
   - Current KV defaults retain checkout-session lookup keys for 90 days, keep download tokens available for 30 days, and allow 100 successful downloads per token unless Worker environment values override them.
   - Make receipt/order/download copy explicit and trustworthy.

10. **Package the buyer offer.**
   - Clarify usage rights, resolution labels, what Full resolution means, AI-origin handling, delivery expectations, refunds, and contact.
   - Decide first public offer: digital-only single assets, bundles, or collection packs.
   - Rephrase basket/order language around draft/review/availability so it builds confidence.

11. **Approve and deploy the real price and offer strategy.**
   - Review `docs/commerce/PRICE_OFFER_STRATEGY.md`.
   - After approval, change `assets/catalog/product-pricing.json`, regenerate catalog and Worker artifacts, bump the visible version, deploy the Worker, and run one low-value live proof purchase.
   - Defer bundles, collection packs, buy-all-liked, and promo-code hooks until single-photo launch behavior is proven.

12. **Curate the first sellable storefront.**
   - Review visible catalog before paid traffic or launch outreach.
   - Block photos that should not be sold or shown.
   - Pick featured collections and hero images.
   - Put strongest commercial/travel/editorial sets first.

## Active Sweep / Automation

- Daily automation: `photosbyelie-daily-cloud-media-sweep`
- It runs `zsh -lc './scripts/run_cloud_media_sweep.zsh --push'` so credentials from `~/.zshrc` are available.
- The wrapper uses `.review-logs/cloud-media-sweep.lock`; if a manual run is still active, the scheduled run exits without starting a second uploader.
- Daily automation: `Photos By Elie R2 master-chain repair`
- It runs `node scripts/repair_r2_master_chain.mjs --repair --prune` through the app automation. The pass reads live R2 masters first, restores missing catalog masters from Saturn/local sources, repairs private render triplets, prunes derivative ghosts, and refreshes the private-delivery/public-preview inventory manifests.
- Daily automation: `PBE Daily Social Posts`
- It runs as automation id `pbe-daily-social-posts` at 09:00 local time. The run should pick three distinct themes, prepare the first-party campaign/homepage springboard target before posting, collect 5-10 watermarked public media-route images for Facebook/Instagram and exactly 5 for Pinterest, stage upload-ready `socials/{Platform}/YYYY-MM-DD/{theme-slug}/` folders through `npm run social:packages`, publish only when Facebook/Instagram/Pinterest/Threads are already authenticated, and otherwise leave exact ready-to-publish captions, image lists, URLs, manifests, and manual blockers. It must not use private masters, unwatermarked private renders, buyer downloads, Owner-only metadata, or secrets.
- A manual run can be started with:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

Before starting a manual sweep, inspect the lock/log so only one R2 media sweep runs at a time.

The sweep:

1. Pulls latest `main`.
2. Deletes discarded public/private R2 media while preserving tombstones.
3. Scans Saturn Camera, Apple Photos album exports, and Leonardo developed-source folders.
4. Imports/uploads only non-discarded candidates.
5. Regenerates the public SQLite catalog artifacts, the small `photos-data.js` bootstrap, `worker/photos-catalog.generated.mjs`, `assets/media-sidecar.json`, and private delivery manifests.
6. Backfills missing private JPG 1/3/6 MP render triplets.
7. Deletes discarded R2 media again.
8. Runs tests and validation.
9. Commits and pushes tracked changes.

## Saturn / Import Sources

- Camera: `/Volumes/Saturn/Pictures/LR/Camera`
- Apple Photos album exports: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
- Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- RAW/DNG/NEF files are not public-site or cloud-storage inputs. Use developed JPG/TIFF sources.
- `tmp/import-cache` is the ignored disposable import/render workspace. Confirmed-upload preview JPGs can be removed after R2 upload.
- Reserve is manifest-only owner state; local preview asset folders are retired.

## Tracked Media Metadata

- `assets/expo-manifest.json`: public catalog/media manifest.
- `assets/media-sidecar.json`: provenance and public/private key mapping.
- `assets/private-delivery-manifest.json`: private master/render coverage.
- `assets/discarded/discarded-photo-ids.json`: durable owner discard tombstones.
- `assets/discarded-media-manifest.json`: generated discarded-media R2 cleanup record; tracked `Owner.sqlite` keeps trusted R2 object lifecycle state (`current`, `marked_for_delete`, `deleted_confirmed`) for routine cleanup.
- `assets/hidden/hidden-blacklist.json`: current blocked-photo blacklist.
- `assets/owner-actions/keyword-blacklist.json`: SQLite-derived compatibility export for the metadata-only keyword blacklist in `Owner.sqlite`; it removes useless keyword strings but does not filter photos or rewrite JPG/source metadata.
- `assets/owner-actions/country-assignments.jsonl`: SQLite-derived/audit Unknown-to-country move log.
- `assets/owner-actions/country-assignments.json`: SQLite-derived latest Unknown-to-country assignment index.
- `docs/r2-public-cors.json`: public R2 bucket CORS policy used for direct preview browsing.

Do not commit:

- `tmp/**`
- `.review-logs/**`
- `deliveries/**`
- secrets or local credentials
- large local preview/render files unless the pipeline explicitly says they are tracked site assets

## Useful Commands

Regenerate public catalog from current import metadata:

```bash
python3 scripts/export_photos_data.py --external-media
```

Regenerate Worker catalog and media sidecar:

```bash
node scripts/write_worker_catalog.mjs
node scripts/write_media_sidecar.mjs
```

Refresh local SQLite state inspection database:

```bash
python3 scripts/build_photo_state_db.py
open -a "DB Browser for SQLite" tmp/photo-state.sqlite
```

Backfill private delivery render triplets:

```bash
node scripts/sync_private_deliverables.mjs --commit-every 100 --push
```

Repair the live R2 master/derivative chain from source roots before buyer-facing checkout tests:

```bash
zsh -lc 'node scripts/repair_r2_master_chain.mjs --repair --prune'
```

Delete discarded R2 media while preserving tombstones:

```bash
node scripts/delete_discarded_r2_media.mjs --delete
```

Run the full cloud media sweep:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

## Checkout / Worker State

- Worker prototype lives in `worker/`.
- Public Worker: `https://photosbyelie-checkout-mock.ec92009.workers.dev`
- Real Stripe is wired behind Worker configuration; mock Stripe remains the local/default path unless Stripe secrets are configured.
- Sandbox Stripe and live Stripe are both manually proven. Live Cloudflare secrets are installed outside git.
- Live webhook destination: `we_1TZmoVPuO9o6fOp6JkBENiyV`, display name `PhotosByElie Worker checkout`, endpoint `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook`, event `checkout.session.completed`, API version `2026-04-22.dahlia`.
- Live Stripe receipt branding is saved with `assets/branding/photosbyelie-camera-tripod-logo-512.png`, `assets/branding/photosbyelie-camera-tripod-wordmark.png`, brand `#5B341E`, and accent `#D86A3E`.
- Live card statement descriptor suffix is `DOWNLOAD`.
- Live proof order: `PBE-20260522-BA062E956C`, `cs_live_...`, `pi_3TZtviPuO9o6fOp62QXLbvMF`, `$8.00` paid, order `ready`, one `jpg-1mp` private JPEG delivered.
- Price/offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price changes have been made from that draft.
- Checkout is guest-first and USD-only.
- Worker owns order ID, buyer email, USD total, basket snapshot, status, delivery file metadata, and signed-link-style download tokens.
- Routes currently implemented:
  - `GET /health`
  - `POST /checkout/guest`
  - `POST /checkout/account`
  - `POST /stripe-webhook`
  - `POST /mock-stripe/pay`
  - `GET /orders/:orderId?email=...`
  - `GET /download/:token`

Run Worker checks:

```bash
npm test
npm run validate
```

## Fresh Backlog

1. Finish full-path plus modified-date re-export overwrite behavior, then audit and clean today's duplicate imports reversibly.
2. Add import source history management for stale/missing remembered folders.
3. Make the Real Estate import control unmistakable and rehearse one full client lifecycle.
4. Finish import dependency/status preflights so failures are actionable before photo queueing.
5. Review and tune buyer support/refund/license wording.
6. Approve and deploy the real price and offer strategy.
7. Curate the first sellable storefront.
8. Add conversion analytics.
9. Improve public discovery and SEO beyond the first-pass `robots.txt` and `sitemap.xml`.
10. Create marketing landing pages and launch outreach.
11. Review the current Owner title/keyword queue, starting with batch `2026-05-24-000237-818Z`.
12. Verify Owner-private artifact separation after deploy.
13. Run the next generator pass after the current batch is resolved.
14. Polish Real Estate production outputs and access model, including optional music for RE videos and Ken Burns-style motion for slideshows.
15. Harden hidden/discarded lifecycle.
16. Extend Owner operations dashboard and state-table browsing.
17. Custom media-domain cutover is complete; keep future preview URLs on `https://download.photos-by-elie.com/media` unless a dedicated media hostname is attached.
18. Keep physical products and long-horizon media cleanup deliberate.
