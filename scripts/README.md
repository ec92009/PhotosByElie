# Scripts

## Lightroom Thumbnail Builder

`build_lightroom_thumbnails.py` scans the Lightroom camera archive, selects photos with a green Lightroom label and rating 4 or higher, and writes two watermarked JPEG derivatives plus a resumable manifest.

Required tools: `python3`, `exiftool`, `sips`, `ffmpeg`, and Pillow. Pillow is used to normalize rotated source photos; if the local `ffmpeg` build does not include the `drawtext` filter, the script also falls back to Pillow for watermarking. Install it with `python3 -m pip install --user pillow`.

Default source:

```bash
python3 scripts/build_lightroom_thumbnails.py
```

Useful options:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn-1/Pictures/LR/Camera \
  --output-root assets/lightroom \
  --years 2024-2026 \
  --batch-size 50 \
  --gallery-max 900 \
  --detail-max 1800
```

If you export developed JPEGs from Lightroom and want the script to use those instead of letting `sips` develop the raw, point `--developed-root` at the export tree. For raw files such as `DNG` and `NEF`, the script will:

- scan the raw file for Lightroom metadata and keep the raw as the source of truth
- require a matching developed `*_1800.jpg`
- use a matching `*_900.jpg` when present
- generate the missing `*_900.jpg` from the `*_1800.jpg` when needed
- still add the watermark itself when writing the final site derivatives

Example:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn/Pictures/LR/Camera \
  --developed-root /Volumes/Saturn/Pictures/LR/Exports \
  --output-root assets/lightroom \
  --years 2022-2024
```

Resume on another machine by pointing `--source-root` at that machine's copy of the same `Camera` folder. The script scans folders and files in reverse lexical order so newer year/month/day folders are handled first, tracks photos by relative path, and writes checkpoints to `assets/lightroom/.build-state.jsonl`, so already-inspected files and already-rendered derivatives are skipped.

Use `--years 2024` for one year or `--years 2022-2024` for an inclusive range. The filter uses the first four-digit year found in each photo's path relative to the `Camera` folder.

For Leonardo/AI folders where files are already curated by presence rather than Lightroom rating, select every image and force the gallery bucket to AI:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
  --output-root assets/lightroom-ai \
  --select all \
  --force-country ai \
  --batch-size 50
```

Outputs:

- `assets/lightroom/gallery/*.jpg`: watermarked gallery thumbnails.
- `assets/lightroom/detail/*.jpg`: watermarked detail-page images.
- Gallery and detail derivatives are grouped by inferred country, e.g. `assets/lightroom/gallery/usa/*.jpg` and `assets/lightroom/detail/usa/*.jpg`.
- `assets/lightroom/manifest.json`: selected photos, derivative paths, full keyword set, Lightroom rating/color label, and web-facing display metadata.
- `assets/lightroom/keywords.json`: keyword counts and photo references for filter UI.
- `assets/lightroom/collections.json`: generated indexes for years, countries, regions, cities, orientations, and source formats.
- `assets/lightroom/failures.json`: render/extraction errors that need attention.
- `assets/lightroom/gps-metadata.json`: exact GPS coordinates keyed by the same relative photo paths. This file is ignored by Git by default.
- `assets/lightroom/.build-state.jsonl`: append-only resume checkpoint.

By default the public manifest preserves all Lightroom keywords, while exact GPS coordinates are written to the separate ignored GPS file. Use `--redact-gps` to skip that private GPS file, or `--redact-private-keywords` only for a sanitized publishing pass.

## Regular Asset Export

`export_photos_data.py` promotes a small publishable `Regular` subset from the local ingest manifests into `photos-data.js` and copies only those web derivatives into `assets/regular`.

The current starting cap is 10 photos per collection. By default the exporter randomly samples eligible photos in each collection, writes the selected set, records the random seed in `assets/regular/manifest.json`, and writes ignored localhost reserve data to `assets/reserve/reserve-data.js`:

```bash
python3 scripts/export_photos_data.py --regular-cap 10
```

To physically apply local review decisions, export a Curation Pass from the localhost Owner page and apply it with the cleaner:

```bash
python3 scripts/apply_curation_pass.py \
  ~/Downloads/photosbyelie-review.pbe-curation \
  --regular-cap 10
```

The exported Curation Pass records hidden photos, the browser's current `Regular` state after reserve replacements, reserve-only returns, the Regular cap, and owner country assignments from the Unknown queue. The cleaner moves hidden derivatives into the ignored `assets/.moderation-hidden/` folder, removes those rows from the local ingest manifests, applies country assignments, and regenerates `Regular` while preserving browser-reviewed picks when they still exist.

For a dry curation preview without moving files, `export_photos_data.py` can take `--curation-pass` or the older `--blacklist` alias. Use `--selection newest` only when you explicitly want the newest eligible rows instead of a random draw. Use `--seed N` to recreate a previous random draw.

The larger `assets/lightroom` and `assets/lightroom-ai` folders are treated as local reserve material and are ignored by Git. The public site should point at `assets/regular` until the owner workflow can promote replacements from reserve.
