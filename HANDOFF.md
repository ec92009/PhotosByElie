# PhotosByElie Handoff

Use this when moving work between Max, David, or the laptop.

## Current Handoff: 2026-05-10 Media And Owner State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local owner preview: `python3 scripts/local_server.py 8000`
- Current visible build: `v71.23`
- Analyzed catalog: `10,133` photos. Public Expo catalog: `5,792` publishable cloud-backed photos after blocked exclusions.
- Local Owner actions are unlocked by `scripts/local_server.py` on localhost without a password. Add `--bind 0.0.0.0 --allow-lan-owner` only when a private-LAN owner review session is intentional.
- Owner now has an R2 coverage panel for private masters, private JPG 1/3/6 MP deliverables, and public low/high previews. Fix it starts `scripts/run_cloud_media_sweep.zsh --push` through the local helper server and respects the shared sweep lock. The active progress bar uses active-catalog coverage, not a moving log-plus-manifest total.
- Owner Current state is simplified to Analyzed / Blocked / Expo. As of `v71.23`, it reads `10,133` analyzed, `4,341` blocked, and `5,792` Expo photos.
- Owner has an editable local price-list table for digital resolutions, print sizes, frame add-ons, and mock S&H; publishing those edits to the public/Worker catalog is still backlog work.
- Public previews are watermarked and public in R2 under flat `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg` keys.
- Private developed sources are in `photosbyelie-private/masters/<photo-id>/<original-file>`.
- Private buyer JPG deliverables are in `photosbyelie-private/renders/<photo-id>/<original-file>-jpg-{6mp,3mp,1mp}.jpg`.
- Uploaded masters, private render triplets, and public previews are treated as immutable after upload. Owner title/keyword/country edits update manifests/catalogs only; a future Lightroom-style XMP sidecar save should be an explicit Owner maintenance action.
- RAW files are not public-site or cloud-storage inputs.
- Saturn developed-source folders are the steady-state upstream:
  - Camera: `/Volumes/Saturn/Pictures/LR/Camera`
  - Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- Owner-discarded photos are tombstoned and must not be re-imported from Saturn. The earlier `18` stale local blocked records were removed from the ignored Owner state; if they return from upstream, block/delete them with the normal batch.
- Before starting a manual sweep, inspect the lock/log so only one R2 media sweep runs at a time.
- Public pages use the shared language toggle for English/French/Spanish. Owner-only localhost pages are still English-only by design.

## First Commands On A Machine

```bash
cd /Users/ecohen/Dev/photosByElie
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

## Active Sweep / Automation

- Daily automation: `photosbyelie-daily-cloud-media-sweep`
- It runs `zsh -lc './scripts/run_cloud_media_sweep.zsh --push'` so credentials from `~/.zshrc` are available.
- The wrapper uses `.review-logs/cloud-media-sweep.lock`; if a manual run is still active, the scheduled run exits without starting a second uploader.
- A manual run can be started with:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

The sweep:

1. Pulls latest `main`.
2. Deletes discarded public/private R2 media while preserving tombstones.
3. Scans Saturn Camera and Leonardo developed-source folders.
4. Imports/uploads only non-discarded candidates.
5. Regenerates `photos-data.js`, `worker/photos-catalog.generated.mjs`, `assets/media-sidecar.json`, and private delivery manifests.
6. Backfills missing private JPG 1/3/6 MP render triplets.
7. Deletes discarded R2 media again.
8. Runs tests and validation.
9. Commits and pushes tracked changes.

## Tracked Media Metadata

- `assets/expo-manifest.json`: public catalog/media manifest.
- `assets/media-sidecar.json`: provenance and public/private key mapping.
- `assets/private-delivery-manifest.json`: private master/render coverage.
- `assets/discarded-media-manifest.json`: owner-discard tombstones and R2 object cleanup record.
- `assets/owner-actions/country-assignments.jsonl`: append-only Unknown-to-country move log.
- `assets/owner-actions/country-assignments.json`: latest Unknown-to-country assignment index.

Do not commit:

- `assets/reserve/**`
- `assets/hidden/**` except tracked blocked-list/tombstone files already in Git
- `.review-logs/**`
- `deliveries/**`
- secrets or local credentials

## Useful Commands

Regenerate public catalog from current import metadata:

```bash
python3 scripts/export_photos_data.py \
  --selection newest \
  --external-media \
  --review-snapshot assets/hidden/hidden-blacklist.json
```

Regenerate Worker catalog and media sidecar:

```bash
node scripts/write_worker_catalog.mjs
node scripts/write_media_sidecar.mjs
```

Backfill private delivery render triplets:

```bash
node scripts/sync_private_deliverables.mjs --commit-every 100 --push
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
- Public mock Worker: `https://photosbyelie-checkout-mock.ec92009.workers.dev`
- Real Stripe is wired behind Worker configuration; mock Stripe remains the local/default path until test-mode secrets and webhooks are configured.
- Checkout is guest-first and USD-only.
- Worker owns order ID, buyer email, USD total, basket snapshot, status, delivery ZIP metadata, and mock signed download tokens.
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

## Current Priority

1. Let the active cloud media sweep finish and confirm its final commit/push.
2. Confirm private masters and private JPG 1/3/6 MP coverage become complete for the active Expo catalog.
3. Make discard a first-class Owner action that deletes R2 bytes but keeps tombstones.
4. Configure Stripe test mode and verify hosted checkout/webhook/ZIP delivery end to end.
5. Move public preview delivery from the checkout Worker `/media/...` bridge to an R2 custom domain.
6. Decide production Owner identity/auth beyond the new localhost session gate.
