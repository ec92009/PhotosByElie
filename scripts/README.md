# Scripts

## Lightroom Thumbnail Builder

`build_lightroom_thumbnails.py` scans developed photo exports plus RAW files with embedded previews, keeps Lightroom green label/rating 4+ files, infers a country bucket, and writes two watermarked JPEG derivatives plus a resumable Reserve manifest. RAW files are imported from embedded `exiftool` preview JPEGs, not from direct raw rendering.

Required tools: `python3`, `exiftool`, `sips`, `ffmpeg`, and Pillow. Pillow is used to normalize rotated source photos; if the local `ffmpeg` build does not include the `drawtext` filter, the script also falls back to Pillow for watermarking. Install it with `python3 -m pip install --user pillow`.

Default source resolves to the first available Camera folder in this order: `/Volumes/Saturn/Pictures/LR/Camera`, `/Volumes/Saturn-1/Pictures/LR/Camera`, `~/Pictures/LR/Camera`, then `~/Pictures/LR/2024`. The importer considers developed `.jpg`, `.jpeg`, `.tif`, `.tiff` files plus RAW formats such as `.dng` and `.nef` when an embedded preview can be extracted.

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

For Leonardo/AI folders where files are already curated by presence rather than Lightroom rating, opt into every image and force the gallery bucket to AI:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
  --output-root assets/reserve \
  --select all \
  --force-country ai \
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

## Expo Asset Export

`export_photos_data.py` promotes a small publishable Expo subset from the local Reserve manifest into `photos-data.js` and copies only those web derivatives into tracked `assets/expo`.

For normal localhost preview with Owner tools, run the small local server instead of the bare static server:

```bash
python3 scripts/local_server.py 8000
```

This still serves the same static site files, but adds localhost-only endpoints that let the Owner page save `.pbe-curation` files directly into `~/Downloads` and move H/U/P review photos directly between Expo, Hidden, and Reserve. GitHub Pages never gets those endpoints; the published site remains static.

The Owner page writes the current Expo cap into each Curation Pass, and the cleaner honors that payload value unless you pass an explicit `--expo-cap` override. This cap is a maximum, not a required fill count: collections with fewer valid JPEG pairs publish fewer photos. For standalone bootstrap exports, the exporter randomly samples eligible photos in each collection, writes the selected set, records the random seed in `assets/expo-manifest.json`, and writes ignored localhost reserve data to `assets/reserve/reserve-data.json`:

```bash
python3 scripts/export_photos_data.py --expo-cap 30
```

For normal H/U/P review, no Apply step is needed: the localhost server moves the JPEG pairs immediately and rewrites `photos-data.js`, `assets/expo-manifest.json`, `assets/reserve/reserve-data.json`, and `assets/hidden/hidden-data.json`.

For larger batch rebuilds, export a Curation Pass from the localhost Owner page and apply it with the cleaner:

```bash
python3 scripts/apply_curation_pass.py \
  ~/Downloads/photosbyelie-review.pbe-curation \
  --rebuild-missing-manifests
```

The exported Curation Pass records the browser's current Expo state, the Expo cap, and owner country assignments from the Unknown queue. The cleaner applies country assignments and regenerates Expo by preserving browser-reviewed picks first, then random-filling remaining slots from eligible Reserve/current candidates. Country-assigned Unknowns are eligible to fill their newly assigned collection in that same pass.

Because Reserve and Hidden are ignored by Git, a fresh sync may have `photos-data.js` and `assets/expo-manifest.json` but no local Reserve manifest. In that case the cleaner applies the pass directly from the site data: it copies promoted Reserve derivatives into `assets/expo`, moves removed Expo derivatives out of the public set, and rewrites `photos-data.js`, `assets/expo-manifest.json`, and `assets/reserve/reserve-data.json`. If the Reserve derivatives live in another checkout or worktree, add it as a search root:

```bash
python3 scripts/apply_curation_pass.py \
  ~/Downloads/photosbyelie-review.pbe-curation \
  --asset-source ~/Dev/photosByElie-full-assets
```

Use `--rebuild-missing-manifests` when you want to regenerate the local Lightroom and AI manifests from source archives before applying the pass. Override with `--source-root` or `--ai-source-root` when the archives are mounted somewhere else.

For a dry curation preview without moving files, `export_photos_data.py` can take `--curation-pass` or the older `--blacklist` alias. Use `--selection newest` only when you explicitly want the newest eligible rows instead of a random draw. Use `--seed N` to recreate a previous random draw.

The active curation states are `assets/expo` for tracked publishable Expo, `assets/reserve` for ignored local Reserve, and `assets/hidden` for ignored local Hidden. The old raw-first staging folders are retired.

## Publish Validation

`validate_publish.js` checks the generated public catalog before publishing. It loads `photos-data.js`, verifies duplicate photo IDs, local image references, matching `*_900.jpg`/`*_1800.jpg` derivative pairs, collection page shells, and resolution availability metadata.

The generated product list currently includes digital file options, physical print sizes, and simple frame add-ons. Print labels keep both inch and centimeter dimensions, but `photos-data.js` infers the browser-locale measurement system to decide which unit appears first. Update both `export_photos_data.py` and `apply_curation_pass.py` when changing product ids, labels, prices, dimensions, or availability thresholds so regenerated `photos-data.js` keeps the public checkout model intact.

Run the validator before pushing public site changes:

```bash
node scripts/validate_publish.js
```

Use `--summary` when preparing a push. The summary prints collection counts, Expo/Reserve/Hidden asset sizes, and publish-scope working-tree changes for `photos-data.js`, `assets/expo`, and `assets/expo-manifest.json`:

```bash
node scripts/validate_publish.js --summary
```

## Local Asset Sync

`sync_local_assets.py` moves the ignored local vault state between the David and Max checkouts without asking Git to track Reserve or Hidden. It syncs `assets/reserve`, `assets/hidden`, and `.curation-logs` by default. The tracked public `assets/expo` folder should normally move through Git; add `--include-expo` only for a deliberate direct media handoff.

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
