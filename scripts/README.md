# Scripts

## Lightroom Thumbnail Builder

`build_lightroom_thumbnails.py` scans the Lightroom camera archive, selects photos with a green Lightroom label and rating 4 or higher, and writes two watermarked JPEG derivatives plus a resumable manifest.

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

Resume on another machine by pointing `--source-root` at that machine's copy of the same `Camera` folder. The script scans folders and files in reverse lexical order so newer year/month/day folders are handled first, tracks photos by relative path, and writes checkpoints to `assets/lightroom/.build-state.jsonl`, so already-inspected files and already-rendered derivatives are skipped.

Use `--years 2024` for one year or `--years 2022-2024` for an inclusive range. The filter uses the first four-digit year found in each photo's path relative to the `Camera` folder.

Outputs:

- `assets/lightroom/gallery/*.jpg`: watermarked gallery thumbnails.
- `assets/lightroom/detail/*.jpg`: watermarked detail-page images.
- `assets/lightroom/manifest.json`: selected photos, derivative paths, full keyword set, Lightroom rating/color label, and web-facing display metadata.
- `assets/lightroom/keywords.json`: keyword counts and photo references for filter UI.
- `assets/lightroom/collections.json`: generated indexes for years, countries, regions, cities, orientations, and source formats.
- `assets/lightroom/failures.json`: render/extraction errors that need attention.
- `assets/lightroom/gps-metadata.json`: exact GPS coordinates keyed by the same relative photo paths. This file is ignored by Git by default.
- `assets/lightroom/.build-state.jsonl`: append-only resume checkpoint.

By default the public manifest preserves all Lightroom keywords, while exact GPS coordinates are written to the separate ignored GPS file. Use `--redact-gps` to skip that private GPS file, or `--redact-private-keywords` only for a sanitized publishing pass.
