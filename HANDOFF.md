# PhotosByElie Handoff

Use this when moving work between Max, David, or the laptop.

For Owner DB state and other sensitive Max/David handoffs, follow
[`docs/sops/MAX_DAVID_SYNC_SOP.md`](./docs/sops/MAX_DAVID_SYNC_SOP.md).
GitHub carries code, safe metadata, SOPs, and handoff notes; private Owner DB
snapshots and client artifacts move through private R2; SSH/Codex Remote SSH is
for remote execution.

## Handoff Direction

- Primary Max/David transport is Gmail self-email on `ec92009@gmail.com`.
- Max-to-David prompts use exact subject `MAX2DAVID`; David-to-Max acknowledgements, progress, and final reports use exact subject `DAVID2MAX`.
- Only trust self-to-self handoff messages from `ec92009@gmail.com` to `ec92009@gmail.com`.
- If `hostname` or ComputerName starts with `David`, read `MAX2DAVID` email first and use `MAX2DAVID.md` as inbound reference/fallback.
- If `hostname` or ComputerName starts with `Max`, read `DAVID2MAX` email first and use `DAVID2MAX.md` as inbound reference/fallback.
- Use `MAX_DAVID_CHAT.md` only for legacy/manual quick notes or when email is unavailable.
- Before David starts acting on a new Max task, David should send or queue a `DAVID2MAX` acknowledgement email saying `David: starting <short task name>` so Max can see the task is in progress.
- Do not edit the opposite-direction file unless the user explicitly asks; record requested prompt or spec changes in the outbound file instead.

## Current Handoff: 2026-05-22 Revenue Track

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local owner preview: `python3 scripts/local_server.py 8000`
- Current visible build: `v83.12`
- Social/Pinterest Visit Website destinations should point to first-party campaign mini-collections, currently `campaign.html?c=pinterest-invalides-2026-05-14`, so buyers can browse related photos and escape embedded browsers before checkout/download.
- Recent baseline commits include: `eafac300 photosbyelie: record owner r2 lifecycle state`, `e87dbacb photosbyelie: add import source menu backlog`, `a04dedb9 photosbyelie: polish owner import progress`, and `3891f05d photosbyelie: fix owner launcher reuse`.
- Current business direction: focus on turning the site into a selling machine. Payments, delivery trust, buyer offer clarity, pricing, curation, analytics, SEO, landing pages, and launch outreach now lead the backlog.
- Public Expo catalog: `6,016` publishable media rows: France `123`, USA `159`, Spain `558`, Mexico `2`, AI/Leonardo `4,921`, Italy `35`, Portugal `216`, Slovakia `2`.
- Public catalog data is SQLite-backed: `assets/catalog/photosbyelie.sqlite` is the active plain payload, and `photos-data.js` is the bootstrap for the existing `window.photosByElieData` browser contract. Brotli `.sqlite.br` is legacy-only and not part of normal operations.
- Waste Basket is the Owner-facing model for unwanted photos. Basketed photos are live-blacklisted and can be put back; emptying the basket deletes public previews, private masters, and private render triplets, then leaves durable tombstones so those masters do not return.
- Waste Basket purge was intentionally paused during catalog migration. Resume only when ready to monitor the `Cloud media left` progress.
- Tombstoned/Waste Basket photos are not buyer inventory. Basket checkout now prunes stale browser selections for tombstoned photos and validates selected private master/render availability before Stripe.
- Owner R2 coverage excludes Waste Basket tombstones from active repair targets and can list missing private masters/triplets for active photos, preferring Saturn/source-file repair when the source path resolves. The Owner dashboard is grouped into Review, Real Estate, Catalog, Cloud, and Commerce tabs, with cloud sweep progress details shown inline by phase.
- Local Owner actions are unlocked by `scripts/local_server.py` on localhost without a password. Add `--bind 0.0.0.0 --allow-lan-owner` only when a private-LAN owner review session is intentional.
- Public previews are watermarked and public in R2 under flat `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg` keys.
- Public browsing now loads previews directly from the public R2 `r2.dev` endpoint: `https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev`.
- The checkout Worker is no longer in the public preview hot path. Keep it focused on checkout, order state, Stripe/webhook handling, pre-Stripe private-file validation, and delivery.
- Private developed sources are in `photosbyelie-private/masters/<photo-id>/<original-file>`.
- Private buyer JPG deliverables are in `photosbyelie-private/renders/<photo-id>/<original-file>-jpg-{6mp,3mp,1mp}.jpg`.
- Public buyer delivery uses per-file private R2 download tokens. Local mock delivery can still generate flat ZIPs for test convenience.
- Uploaded masters, private render triplets, and public previews are treated as immutable after upload. Owner title/keyword/country edits update manifests/catalog SQLite/bootstrap files only; a future Lightroom-style XMP sidecar save should be an explicit Owner maintenance action.
- Physical print/frame products are buyer-hidden by default. Owner can deliberately enable them on localhost for review, but digital checkout should be proven first.
- Owner has local price editing. Published digital checkout defaults now use $0.10 for JPG 1 MP and $0.30 for JPG 3 MP, with the buyer Pay section and Worker adding a Stripe $0.50 minimum-charge top-up only when needed.
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
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo, adds buyer trust notes to basket/order, and adds `support.html` for payment, delivery recovery, license, and support expectations.
- `v83.4` promotes the first Photos By Elie Facebook Page post alongside Pinterest features on the homepage.
- `v83.6` adds localhost-only POD supplier readiness, quality-tier routing, supplier option, and catalog schema preview panels in Owner Commerce while keeping public print checkout gated off.
- `v83.7` lets the Owner import flow choose a local source folder instead of depending only on fixed source anchors.
- `v83.8` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, and durable discarded-photo tombstones, reducing active public rows to `6,016`.
- `v83.9` keeps selected-folder imports focused on import phases, avoids banned-photo cleanup noise in that path, caches import thumbnails, and gives the per-photo import matrix visible working states.
- `v83.10` makes the active/next import matrix state obvious with an inferred active worker row, animated next-queued row, and live dots inside unchecked cells.
- `v83.11` adds the Owner import source pulldown, remembered source storage/discovery, explicit maintenance buttons, and truthful task-scoped progress stacks.
- `v83.12` makes GUI/Dock-launched imports see Homebrew tools such as `exiftool`, `ffmpeg`, and `ffprobe` so selected-folder imports do not fail on a stripped Safari helper PATH.
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
- Latest checkpoint is `v83.12`; Owner imports now see Homebrew tools from GUI-launched helpers, use a remembered source selector, optional maintenance actions have their own task buttons, task stacks show only meaningful phases, and `TODO.md` remains the numbered backlog source of truth.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest with 5-10 watermarked public images per post, publishing only when existing authentication allows it and otherwise leaving ready-to-publish packages.
- The 2026-05-24 daily social package is prepared only: Facebook, Instagram, and Pinterest all need final manual publish/account confirmation before anything is posted from that package.
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

1. **Add import source history management.**
   - Let Owner remove missing or stale remembered folders, optionally pin favorites, and inspect the last-used time/source path before starting a run.
   - Keep `Owner.sqlite` authoritative; do not introduce another JSON state file.

2. **Keep Owner/generated state handoff-ready.**
   - Review local approval/proposal/discard/catalog state before each generated-data commit.
   - Commit tracked manifest changes only when they represent durable R2/catalog state.
   - Keep unrelated local edits out of feature commits.

3. **Review checkout trust and buyer support wording.**
   - `v83.3` ships conservative support/license defaults; owner should approve or adjust refund, delivery-refresh, and commercial-use language before heavier launch traffic.
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current refund/support policy draft before editing public copy.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

4. **Make checkout and delivery production-durable.**
   - Choose D1 vs KV for longer-term order state.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, delivery file keys, and download timing.
   - Current KV defaults retain checkout-session lookup keys for 90 days, keep download tokens available for 30 days, and allow 100 successful downloads per token unless Worker environment values override them.
   - Make receipt/order/download copy explicit and trustworthy.

5. **Package the buyer offer.**
   - Clarify usage rights, resolution labels, what Full resolution means, AI-origin handling, delivery expectations, refunds, and contact.
   - Decide first public offer: digital-only single assets, bundles, or collection packs.
   - Rephrase basket/order language around draft/review/availability so it builds confidence.

6. **Approve and deploy the real price and offer strategy.**
   - Review `docs/commerce/PRICE_OFFER_STRATEGY.md`.
   - After approval, change `assets/catalog/product-pricing.json`, regenerate catalog and Worker artifacts, bump the visible version, deploy the Worker, and run one low-value live proof purchase.
   - Defer bundles, collection packs, buy-all-liked, and promo-code hooks until single-photo launch behavior is proven.

7. **Curate the first sellable storefront.**
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
- It runs as automation id `pbe-daily-social-posts` at 09:00 local time. The run should pick three distinct themes, collect 5-10 watermarked public R2/social images per platform post, publish only when Facebook/Instagram/Pinterest are already authenticated, and otherwise leave exact ready-to-publish captions, image lists, and manual steps. It must not use private masters, unwatermarked private renders, buyer downloads, Owner-only metadata, or secrets.
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

1. Add import source history management for stale/missing remembered folders.
2. Review and tune buyer support/refund/license wording.
3. Approve and deploy the real price and offer strategy.
4. Curate the first sellable storefront.
5. Add conversion analytics.
6. Improve public discovery and SEO beyond the first-pass `robots.txt` and `sitemap.xml`.
7. Create marketing landing pages and launch outreach.
8. Review the current Owner title/keyword queue, starting with batch `2026-05-24-000237-818Z`.
9. Verify Owner-private artifact separation after deploy.
10. Run the next generator pass after the current batch is resolved.
11. Rehearse the Real Estate client lifecycle.
12. Polish Real Estate production outputs and access model.
13. Harden hidden/discarded lifecycle.
14. Extend Owner operations dashboard and state-table browsing.
15. Replace temporary `r2.dev` media URL with a custom media domain.
16. Keep physical products and long-horizon media cleanup deliberate.
