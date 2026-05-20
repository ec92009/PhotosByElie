# PhotosByElie Handoff

Use this when moving work between Max, David, or the laptop.

For ignored Owner DB state and other sensitive Max/David handoffs, follow
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

## Current Handoff: 2026-05-19 Revenue Track

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local owner preview: `python3 scripts/local_server.py 8000`
- Current visible build: `v82.0`
- Social/Pinterest Visit Website destinations should point to first-party campaign mini-collections, currently `campaign.html?c=pinterest-invalides-2026-05-14`, so buyers can browse related photos and escape embedded browsers before checkout/download.
- Recent baseline commits include: `297c572d photosbyelie: add title keyword review batch 2026-05-19-230413`, `49471506 photosbyelie: publish title keyword review updates`, and `6ec82489 photosbyelie: tighten title keyword review workflow`.
- Current business direction: focus on turning the site into a selling machine. Payments, delivery trust, buyer offer clarity, pricing, curation, analytics, SEO, landing pages, and launch outreach now lead the backlog.
- Public Expo catalog: `6,239` publishable media rows: France `255`, USA `166`, Spain `641`, Mexico `2`, AI/Leonardo `4,921`, Italy `35`, Portugal `217`, Slovakia `2`.
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
- Owner has local price editing. Published defaults now distinguish camera-photo digital downloads from lower AI-origin downloads, with print/frame launch prices also refreshed; moving those defaults into a dedicated shared price-list file remains high priority.
- Camera vs AI is now a first-class catalog origin (`sourceOrigin`) used by public gallery filters, detail metadata, Owner active-catalog counts, and Worker checkout pricing. Do not rely only on the `ai` collection slug for AI-origin behavior.
- Public pages use English/French/Spanish translation. Owner-only localhost pages remain English-only by design.
- Waste Basket review now uses the shared gallery-card treatment and the same density/fit masonry behavior as public galleries.
- Public collection pages use the shared `gallery.html?gallery=<slug>` route.
- `v80.8` publishes the latest Owner title/keyword approvals into the public SQLite catalog and Worker catalog, adds model provenance to the Owner title/keyword review cards, defaults Owner Review to the title/keyword queue, and clears stale proposed rows that are already blocked or missing from the public catalog.
- `v81.4` publishes 239 approved title/keyword rows from batch `2026-05-19-230413-165Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- `v81.10` publishes 53 approved title/keyword rows from batch `2026-05-20-093025-705Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- `v82.0` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, Worker catalog, discarded media manifests, and the Corine Real Estate context timestamp.

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

1. **Keep Owner/generated state handoff-ready.**
   - Review local approval/proposal/discard/catalog state before each generated-data commit.
   - Commit tracked manifest changes only when they represent durable R2/catalog state.
   - Keep unrelated local edits out of feature commits.

2. **Prove Stripe checkout in test mode.**
   - Create/sign into Stripe on the Mac.
   - Configure Worker secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - Register `/stripe-webhook`.
   - Test successful payment, 3D Secure/authentication-required payment, declined card, verified webhook, private R2 per-file delivery, order page download, and failure states.

3. **Make checkout and delivery production-durable.**
   - Choose D1 vs KV for order state.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, delivery file keys, and download timing.
   - Rate-limit downloads.
   - Make receipt/order/download copy explicit and trustworthy.

4. **Package the buyer offer.**
   - Clarify usage rights, resolution labels, what Full resolution means, AI-origin handling, delivery expectations, refunds, and contact.
   - Decide first public offer: digital-only single assets, bundles, or collection packs.
   - Rephrase basket/order language around draft/review/availability so it builds confidence.

5. **Publish a real price and offer strategy.**
   - Move local Owner prices into a published price list shared by public basket and Worker validation.
   - Add launch pricing, bundles, collection packs, buy-all-liked, and later promo-code hooks.

6. **Curate the first sellable storefront.**
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
- `assets/discarded-media-manifest.json`: generated discarded-media R2 cleanup record; ignored `Owner.sqlite` keeps trusted R2 object lifecycle state (`current`, `marked_for_delete`, `deleted_confirmed`) for routine cleanup.
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
- Real Stripe is wired behind Worker configuration; mock Stripe remains the local/default path until test-mode secrets and webhooks are configured.
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

1. Prove Stripe checkout in test mode.
2. Make checkout and delivery production-durable.
3. Package the buyer offer clearly.
4. Publish a real price and offer strategy.
5. Curate the first sellable storefront.
6. Add conversion analytics.
7. Improve public discovery and SEO.
8. Create marketing landing pages.
9. Prepare launch and sales outreach.
10. Replace temporary `r2.dev` media URL with a custom media domain.
11. Parameterize gallery routes and split gallery/catalog data by collection.
12. Improve gallery merchandising layout.
13. Add buyer account or order recovery only if needed.
14. Decide when physical goods return.
15. Replace keyword removal with Owner keyword cleanup modal.
16. Make country collections open-ended.
17. Add gallery multi-select Owner metadata edits.
18. Extend Owner operations dashboard.
19. Harden owner identity and publish validation.
20. Keep long-horizon media and repo cleanup on the backburner.
