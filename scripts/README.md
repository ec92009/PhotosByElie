# Scripts

## Lightroom Thumbnail Builder

`build_lightroom_thumbnails.py` scans developed photo exports, keeps Lightroom green label/rating 4+ files, infers a country bucket, and writes two watermarked JPEG derivatives plus a resumable Reserve manifest. It no longer imports raw files; use Lightroom or another editor to develop/export the photos first.

Required tools: `python3`, `exiftool`, `sips`, `ffmpeg`, and Pillow. Pillow is used to normalize rotated source photos; if the local `ffmpeg` build does not include the `drawtext` filter, the script also falls back to Pillow for watermarking. Install it with `python3 -m pip install --user pillow`.

Default source resolves to the first available Camera folder in this order: `/Volumes/Saturn/Pictures/LR/Camera`, `/Volumes/Saturn-1/Pictures/LR/Camera`, `~/Pictures/LR/Camera`, then `~/Pictures/LR/2024`. The importer only considers `.jpg`, `.jpeg`, `.tif`, and `.tiff` files.

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

The Owner page writes the current Expo cap into each Curation Pass, and the cleaner honors that payload value unless you pass an explicit `--regular-cap` override. This cap is a maximum, not a required fill count: collections with fewer valid JPEG pairs publish fewer photos. For standalone bootstrap exports, the exporter randomly samples eligible photos in each collection, writes the selected set, records the random seed in `assets/expo-manifest.json`, and writes ignored localhost reserve data to `assets/reserve/reserve-data.json`:

```bash
python3 scripts/export_photos_data.py --regular-cap 30
```

To physically apply local review decisions, export a Curation Pass from the localhost Owner page and apply it with the cleaner:

```bash
python3 scripts/apply_curation_pass.py \
  ~/Downloads/photosbyelie-review.pbe-curation \
  --rebuild-missing-manifests
```

The exported Curation Pass records hidden photos, the browser's current Expo state after reserve replacements, reserve-only returns, the Expo cap, and owner country assignments from the Unknown queue. The cleaner moves hidden derivatives into the ignored `assets/hidden/` folder, removes those rows from the local ingest manifests when present, applies country assignments, and regenerates Expo while preserving browser-reviewed picks when they still exist and valid assets are available.

Because Reserve and Hidden are ignored by Git, a fresh sync may have `photos-data.js` and `assets/expo-manifest.json` but no local Reserve manifest. In that case the cleaner applies the pass directly from the site data: it copies promoted Reserve derivatives into `assets/expo`, moves removed Expo derivatives out of the public set, and rewrites `photos-data.js`, `assets/expo-manifest.json`, and `assets/reserve/reserve-data.json`. If the Reserve derivatives live in another checkout or worktree, add it as a search root:

```bash
python3 scripts/apply_curation_pass.py \
  ~/Downloads/photosbyelie-review.pbe-curation \
  --asset-source ~/Dev/photosByElie-full-assets
```

Use `--rebuild-missing-manifests` when you want to regenerate the local Lightroom and AI manifests from source archives before applying the pass. Override with `--source-root` or `--ai-source-root` when the archives are mounted somewhere else.

For a dry curation preview without moving files, `export_photos_data.py` can take `--curation-pass` or the older `--blacklist` alias. Use `--selection newest` only when you explicitly want the newest eligible rows instead of a random draw. Use `--seed N` to recreate a previous random draw.

The active curation states are `assets/expo` for tracked publishable Expo, `assets/reserve` for ignored local Reserve, and `assets/hidden` for ignored local Hidden. The old raw-first staging folders are retired.
