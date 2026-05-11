# Scripts

## Lightroom Thumbnail Builder

`build_lightroom_thumbnails.py` scans developed photo exports, keeps Lightroom green label/rating 4+ files, infers a country bucket, and writes two watermarked JPEG derivatives plus a resumable local preview-cache manifest. RAW/DNG/NEF files are owner-local source material only; export developed JPG/TIFF masters before importing them.

Required tools: `python3`, `exiftool`, `sips`, and Pillow. Pillow is used to normalize rotated source photos and bake the repeating preview watermark. Install it with `python3 -m pip install --user pillow`.

Default source resolves to the first available Camera folder in this order: `/Volumes/Saturn/Pictures/LR/Camera`, `/Volumes/Saturn-1/Pictures/LR/Camera`, `~/Pictures/LR/Camera`, then `~/Pictures/LR/2024`. The importer considers only developed `.jpg`, `.jpeg`, `.tif`, and `.tiff` files.

Default run:

```bash
python3 scripts/build_lightroom_thumbnails.py
```

Useful options:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn-1/Pictures/LR/Camera \
  --output-root assets/reserve \
  --years 2024-2026 \
  --batch-size 50 \
  --gallery-max 900 \
  --detail-max 1800
```

Resume on another machine by pointing `--source-root` at that machine's developed export folder. The script scans folders and files in reverse lexical order so newer year/month/day folders are handled first, tracks photos by relative path, and writes checkpoints to `assets/reserve/.build-state.jsonl`, so already-inspected files and already-rendered derivatives are skipped.

Use `--years 2024` for one year or `--years 2022-2024` for an inclusive range. The filter uses the first four-digit year found in each photo's path relative to the `Camera` folder.

For Leonardo/AI folders where files are already selected by presence rather than Lightroom rating, opt into every image and force the gallery bucket to AI:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
  --output-root assets/reserve \
  --select all \
  --force-country ai \
  --batch-size 50
```

For Apple Photos album exports, folder membership is the selection signal, but country inference should still decide the gallery bucket:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/Apple Photo Albums" \
  --output-root assets/reserve \
  --select all \
  --batch-size 50
```

Outputs:

- `assets/reserve/<country>/*_900.jpg`: watermarked gallery thumbnails.
- `assets/reserve/<country>/*_1800.jpg`: watermarked detail-page images.
- `assets/reserve/manifest.json`: selected photos, derivative paths, full keyword set, rating/color label when present, and web-facing display metadata.
- `assets/reserve/keywords.json`: keyword counts and photo references for filter UI.
- `assets/reserve/collections.json`: generated indexes for years, countries, regions, cities, orientations, and source formats.
- `assets/reserve/failures.json`: render/extraction errors that need attention.
- `assets/reserve/gps-metadata.json`: exact GPS coordinates keyed by the same relative photo paths.
- `assets/reserve/.build-state.jsonl`: append-only resume checkpoint.

By default the public manifest preserves all Lightroom keywords, while exact GPS coordinates are written to the separate ignored GPS file. Use `--redact-gps` to skip that private GPS file, or `--redact-private-keywords` only for a sanitized publishing pass.

## Public Catalog Export

`export_photos_data.py` promotes a publishable catalog subset from the local preview-cache manifest into `photos-data.js` and writes the tiny homepage manifest to `home-data.js`. In the current GitHub-code/R2-media model, use `--external-media` so Git tracks metadata and public media keys rather than preview JPGs. RAW-origin rows are kept out of public media because they do not have uploadable developed masters yet. Public R2 preview keys are flat by photo ID under `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`; country/gallery origin stays in catalog metadata and `assets/media-sidecar.json`, not in the object key.

For normal localhost preview with Owner tools, run the small local server instead of the bare static server:

```bash
python3 scripts/local_server.py 8000
```

This still serves the same static site files, but adds localhost-only endpoints that let the Owner page update the blocked blacklist, classify Unknown photos, save owner metadata edits, summarize R2 coverage, and run local R2 maintenance. GitHub Pages never gets those endpoints; the published site remains static.

Owner mutation endpoints are unlocked on localhost by the helper server without a password.

For a temporary private-LAN review session, bind to all interfaces and opt in to LAN owner endpoints:

```bash
python3 scripts/local_server.py 8000 --bind 0.0.0.0 --allow-lan-owner
```

We are walking away from the old Curation Pass workflow. Live localhost review is now the normal path; review snapshots are retained only as historical audit files.

The Expo cap is retired. For standalone exports, omit `--expo-cap` so the exporter publishes every eligible cloud-backed preview that is not blocked, discarded, RAW-only, or otherwise ineligible:

```bash
python3 scripts/export_photos_data.py
```

For the GitHub-code/R2-media publishing model, write the same public catalog and Expo manifest without copying preview JPGs into tracked `assets/expo`:

```bash
python3 scripts/export_photos_data.py --external-media
```

After changing the generated catalog, refresh the media sidecar so each flat public key keeps its original source and legacy country-prefixed provenance:

```bash
node scripts/write_media_sidecar.mjs
```

For normal H/X/U/P review, no Apply step is needed: the localhost server updates review state immediately and rewrites the generated catalog/state files. H or X blocks by adding the photo to the blocked blacklist, U removes the most recent block, and P on the Blocked page re-promotes by removing the photo from the blacklist. Unknown-to-country assignments are live server actions, not browser-staged assignments: they remove the assigned photo and its same-day cohort from Unknown immediately, update catalog metadata, and record the handoff in `assets/owner-actions/country-assignments.jsonl`, with a compact latest-state index in `assets/owner-actions/country-assignments.json`. If the server update fails, the Unknown page should leave the card visible and reset the country selector.

If an older review snapshot needs to be replayed, use `scripts/asset_state.py` directly:

```bash
python3 scripts/asset_state.py \
  ~/Downloads/photosbyelie-review.pbe-review \
  --rebuild-missing-manifests
```

That compatibility path applies country assignments and blocked choices from the snapshot. It is not the normal Owner flow anymore.

Because the local preview cache and blocked review data are ignored by Git, a fresh sync may have `photos-data.js` and `assets/expo-manifest.json` but no local preview-cache manifest. In that case the compatibility cleaner applies the pass directly from the site data where it can. If the derivatives live in another checkout or worktree, add it as a search root:

```bash
python3 scripts/asset_state.py \
  ~/Downloads/photosbyelie-review.pbe-review \
  --asset-source ~/Dev/photosByElie-full-assets
```

Use `--rebuild-missing-manifests` when you want to regenerate the local Lightroom and AI manifests from source archives before applying the pass. Override with `--source-root` or `--ai-source-root` when the archives are mounted somewhere else.

For a dry review preview without moving files, `export_photos_data.py` can take `--review-snapshot` or the older `--blacklist` alias. Use `--selection newest` only when you explicitly want the newest eligible rows instead of the default ordering. Use `--seed N` only with legacy capped/randomized export experiments.

The active storage contract is: Git tracks code/metadata and tiny assets; `assets/reserve` is an ignored local preview cache; Blocked is primarily a blacklist/review catalog; public preview media belongs on R2/CDN. The old raw-first staging folders are retired.

## Publish Validation

`validate_publish.js` checks the generated public catalog before publishing. It loads `home-data.js` and `photos-data.js`, verifies homepage counts/samples, duplicate photo IDs, collection page shells, resolution availability metadata, and either local `*_900.jpg`/`*_1800.jpg` derivative pairs or external public media keys.

The generated product list currently includes digital file options, physical print sizes, per-print framing choices, and mock shipping/handling offsets. Print labels keep both inch and centimeter dimensions, but `photos-data.js` infers the browser-locale measurement system to decide which unit appears first. Update `export_photos_data.py` when changing product ids, labels, prices, dimensions, frame options, shipping/handling amounts, or availability thresholds so regenerated `photos-data.js` keeps the public checkout model intact.

Run the validator before pushing public site changes:

```bash
node scripts/validate_publish.js
```

When GitHub Pages is serving code and metadata while public previews live in R2/CDN, validate the catalog keys instead of committed local JPG files:

```bash
node scripts/validate_publish.js --external-media
```

Use `--summary` when preparing a push. The summary prints collection counts, local preview-cache/blocked asset sizes, and publish-scope working-tree changes for `photos-data.js`, `assets/expo`, and `assets/expo-manifest.json`:

```bash
node scripts/validate_publish.js --summary
```

## R2 Media Sync

`sync_r2_media.py` prepares the Cloudflare R2 upload sets for the post-GitHub media layout:

- public watermarked previews go to `photosbyelie-public` under flat keys such as `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`
- local preview-cache and current catalog previews share that same public prefix because Reserve disappears from the cloud model and country/gallery origin lives in metadata
- private developed masters go to `photosbyelie-private` under `masters/<photo-id>/<original-file>`
- unwatermarked buyer JPG deliverables go to `photosbyelie-private` under `renders/<photo-id>/<original-file>-jpg-6mp.jpg`, `...-jpg-3mp.jpg`, and `...-jpg-1mp.jpg`; they stay private and the Worker only zips them after payment
- RAW/DNG/NEF sources and their embedded previews are skipped for both public and private uploads
- IDs listed in owner discard tombstones are skipped for import/upload and should be deleted from public and private R2 by `delete_discarded_r2_media.mjs`; the tombstone stays tracked so Saturn scans do not resurrect discarded photos

For the normal daily/manual sweep, prefer the lock-guarded wrapper:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

The wrapper sources `~/.zshrc`, pulls latest `main`, deletes discarded media from R2, imports Camera and Leonardo developed sources from Saturn, regenerates catalogs/sidecars, backfills missing private render triplets, validates, commits, and pushes. It uses `.review-logs/cloud-media-sweep.lock`; a scheduled automation will exit if a manual sweep is still active.

The Owner dashboard Fix it button starts this same wrapper through the local helper server when the tracked R2 coverage counts do not match policy.

Refresh the Owner storage/cost estimate after a large import, backfill, or blocked-media cleanup:

```bash
zsh -lc 'node scripts/write_storage_estimate.mjs'
```

The estimate writes `assets/storage-estimate.json`. Current public/private bytes come from live R2 listings; already-deleted blocked previews/renders are estimated from current average object sizes, while blocked master bytes come from the blocked catalog source metadata.

Dry-run the currently publishable Expo previews:

```bash
python3 scripts/sync_r2_media.py --scope public
```

Dry-run the full public browsing set, including local preview-cache previews:

```bash
python3 scripts/sync_r2_media.py --scope public --include-reserve
```

Dry-run private developed masters, using mounted Saturn source paths when available:

```bash
python3 scripts/sync_r2_media.py --scope private
```

Add `--upload` only after the dry-run counts look sane. The script uses `npx wrangler r2 object put`, so Wrangler must already be authorized on the machine.

Run one lane at a time unless there is a strong reason not to. Public and private uploads both call the same Cloudflare account API, so running them together can trigger `429 Too Many Requests` responses and eventually make Wrangler's OAuth token path wobble. The upload journal in `.review-logs/r2-upload-state.jsonl` records successful objects, so interrupted runs can be safely resumed without `--no-resume`.

Recommended public preview resume command:

```bash
python3 scripts/sync_r2_media.py --scope public --include-reserve --upload --workers 4 --request-min-interval 0.75
```

Recommended private master resume command, after public previews finish:

```bash
python3 scripts/sync_r2_media.py --scope private --upload --workers 2 --request-min-interval 1.5
```

On David, which owns the developed masters, generate/upload private buyer JPG renders during import/private upload:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /path/to/developed/files \
  --r2-upload private \
  --r2-private-renders
```

For private render backfill against the current catalog and tracked private-delivery manifest:

```bash
node scripts/sync_private_deliverables.mjs --commit-every 100 --push
```

For owner-discard cleanup:

```bash
node scripts/delete_discarded_r2_media.mjs --delete
```

That command deletes matching public previews, private masters, and private JPG render objects from R2, then writes `assets/discarded-media-manifest.json` as the durable do-not-resurrect record.

For an already-published photo, render/upload just its private JPG deliverables:

```bash
zsh -ic 'node scripts/render_private_deliverables.mjs --photo-id <photo-id>'
```

On David, `render_private_deliverables.mjs` first looks for the developed file under mounted local source roots such as `/Volumes/Saturn/Pictures/LR/Camera` and `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`, then falls back to private R2 only if the local master is not present. Add `--source-root /path/to/developed/files` or set `PBE_DELIVERY_SOURCE_ROOTS` when the developed corpus is mounted somewhere else. If S3 backend credentials are present, the private render and importer upload paths use the S3 backend automatically; you can also force it explicitly:

```bash
PBE_R2_BACKEND=s3 \
  node scripts/render_private_deliverables.mjs --photo-id <photo-id>
```

The uploader also retries transient Wrangler failures with longer backoff. If Wrangler reports `Invalid access token`, run `npx wrangler whoami` or `npx wrangler login`, then rerun the same resume command.

If Wrangler auth keeps failing, `sync_r2_media.py` can write through Cloudflare R2's S3-compatible API instead:

```bash
export R2_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."

python3 scripts/sync_r2_media.py \
  --scope public \
  --include-reserve \
  --backend s3 \
  --upload \
  --workers 2 \
  --request-min-interval 1.5
```

The S3 backend uses Python stdlib SigV4 signing and does not need Wrangler login state. Keep the same one-lane rule and start with a small `--limit 1` upload if credentials or bucket permissions were just created. Dry runs do not require credentials because they only build the local inventory.

After the public bucket contains only final baked-watermark previews and public access is enabled through an R2 dev URL or custom domain, put that URL in `media-config.js` as `publicBaseUrl`. Public pages can also be tested temporarily with `?mediaBase=https://example.invalid/path`; use `?mediaBase=local` to clear the stored override.

## Classified Unknown Public R2 Cleanup

`cleanup_classified_unknowns_public_r2.py` is a recovery tool for the narrow case where Unknown previews were already uploaded to public R2 before localhost country classification moved them into a real gallery. It reads a review log with `r2_moves`, uploads the classified target key first, then deletes the old Unknown key, with resumable state in `.review-logs/public-r2-unknowns-cleanup-state.jsonl`.

Dry-run the default review log:

```bash
python3 scripts/cleanup_classified_unknowns_public_r2.py --dry-run
```

Run it only after confirming no public/private R2 upload lane is active. The script checks for active R2 writer processes and the shared throttle lock before making changes.

## Local Asset Sync

`sync_local_assets.py` moves the ignored local vault state between the David and Max checkouts without asking Git to track preview-cache or blocked data. It syncs `assets/reserve`, `assets/hidden`, and `.review-logs` by default. The tracked public metadata should normally move through Git; add `--include-expo` only for a deliberate direct media handoff.

The script can run from either computer. Pass a known peer name when that machine is mounted, or pass an explicit repo path:

```bash
python3 scripts/sync_local_assets.py max
python3 scripts/sync_local_assets.py david
python3 scripts/sync_local_assets.py /Volumes/MHD2/Users/ecohen/Dev/PhotosByElie
```

It is a dry run unless `--apply` is present:

```bash
python3 scripts/sync_local_assets.py max --apply --progress
python3 scripts/sync_local_assets.py max --direction pull --apply
```

Leave `--delete` off for additive safety. Use it only when intentionally mirroring removals from source to destination.
