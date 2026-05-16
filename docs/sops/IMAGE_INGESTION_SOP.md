# Image Ingestion SOP

Repeatable workflow for importing Lightroom-selected photos into the static Photos By Elie site.

## Scope

Use this SOP when adding or refreshing real-photo galleries from developed Lightroom exports. The automated path builds watermarked gallery and detail JPEG derivatives plus metadata manifests into a disposable local import cache; Expo is filled later by live Owner review or export tooling.

Do not use this SOP for repo-only documentation edits, CSS-only page polish, or manual one-off fixes to existing gallery data.

## Source Convention

- Canonical Lightroom camera archive: `/Volumes/Saturn/Pictures/LR/Camera`
- Apple Photos album exports for small source-agnostic import tests: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
- Source files must be developed exports: `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.mov`, `.mp4`, or `.m4v`.
- Do not import DNG, NEF, or other raw camera files. Develop/export them first.
- Lightroom sidecars may sit next to the image files as `.xmp` files when metadata is not embedded. The Photos By Elie Owner flow does not rewrite source files or sidecars automatically after upload; future XMP saves should be explicit Owner maintenance actions.
- The default importer selects developed files with Lightroom green label and rating 4 or higher. Use `--select all` only for explicitly selected folders such as Leonardo/AI.
- Apple Photos album exports are treated as explicitly selected by folder membership, so use `--select all` and let country inference assign them to a gallery or Unknown.
- The importer can use Apple Photos album/folder names as country hints when embedded country/GPS metadata is missing, for example a Malaga or Valencia album can infer Spain.
- Keep Apple Photos still-image exports at full pixel size. If explicit JPEG quality control is needed, post-process exported corrected JPEGs to quality 90 without resizing; do not switch to RAW/NEF for the public pipeline.
- Keep Apple Photos video exports as original MOV/MP4/M4V files. The importer generates a watermarked `still_900` poster at 10% into the source video for gallery cards and a watermarked 5-second `short_5s_720p` MP4 preview for detail pages. Buyer delivery for videos is the original/full video only.
- The builder groups derivatives by inferred gallery country using Lightroom country fields, country keywords, and known location hints.

## Prerequisites

Run from the repo root:

```bash
cd /Users/ecohen/Dev/photosByElie
```

Required command-line tools:

- `python3`
- `exiftool`
- `ffmpeg`
- `ffprobe`
- Python `Pillow` package, used to bake photo and video-preview watermarks.

Check availability before a long run:

```bash
command -v python3 exiftool ffmpeg ffprobe
```

## Build Derivatives

Default scan:

```bash
python3 scripts/build_lightroom_thumbnails.py
```

Recommended focused scan for a year or year range:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn/Pictures/LR/Camera \
  --output-root tmp/import-cache \
  --years 2024 \
  --batch-size 50
```

Use `--limit N` for a small trial and `--dry-run` when checking selection behavior without writing derivatives. Use `--force` only when intentionally rebuilding existing derivatives.

Apple Photos album video test import:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/Apple Photo Albums/2025 Cordoba, la Mezquita" \
  --output-root tmp/cordoba-import-cache \
  --select all \
  --force-country spain \
  --batch-size 50 \
  --r2-upload none
```

Use only `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`. Do not use `/Volumes/Saturn/Pictures/LR/Apple Photo Albums With Faces` unless the Owner explicitly authorizes that source in the current run.

## Resume Behavior

The builder is designed to be interrupted and resumed.

- `tmp/import-cache/.build-state.jsonl` records inspected and selected source paths.
- Existing derivatives are skipped unless `--force` is used.
- If a manifest row exists but a derivative is missing, rerunning from a source archive can regenerate that derivative.
- Use the same `--output-root` when resuming so checkpoints and manifests stay aligned.

## Outputs

- `tmp/import-cache/<country>/*_900.jpg`: watermarked photo gallery thumbnails and video gallery posters.
- `tmp/import-cache/<country>/*_1800.jpg`: watermarked photo detail-page images.
- `tmp/import-cache/<country>/*_short_5s_720p.mp4`: watermarked video detail-page clips.
- `tmp/import-cache/manifest.json`: selected photo/video metadata and derivative references.
- `tmp/import-cache/keywords.json`: keyword counts and photo references for future filtering.
- `tmp/import-cache/collections.json`: generated indexes for years, locations, orientation, source formats, and gallery countries.
- `tmp/import-cache/failures.json`: extraction or render failures to inspect before publishing.
- `tmp/import-cache/gps-metadata.json`: exact GPS metadata, ignored by Git.

## Privacy Rules

- Keep `tmp/import-cache` untracked. Hidden uses JSON state only (`assets/hidden/hidden-blacklist.json` and local `assets/hidden/hidden-data.json`); do not keep local preview JPGs under Hidden.
- Keep `assets/owner-actions/country-assignments.jsonl` and `assets/owner-actions/country-assignments.json` tracked; they are exported handoff artifacts for localhost Unknown-to-country moves, while the ignored local SQLite owner-state tables are the write path. Each Unknown assignment is a live server action, not a browser-staged value: it should remove the chosen photo and same-day cohort from Unknown immediately and move them into the target Reserve country. If the move fails, the card should remain visible and the country selector should reset.
- Keep `assets/owner-actions/keyword-blacklist.json` tracked. It is metadata-only: import/export scripts use it to omit useless keyword strings from generated catalog metadata and keyword indexes, not to block, discard, skip, or rewrite photos/JPGs.
- Treat Waste Basket media as owner-controlled undo assets, not clock-controlled assets. Basketed photos can be put back until the owner empties the basket; emptying deletes public previews, private masters, and private render triplets, then keeps only durable tombstone state: photo id plus blacklisted master/source path so future Saturn/import sweeps do not resurrect the file.
- Do not paste exact GPS coordinates into public site data.
- Review public keywords before promoting them into the generated catalog TSV/bootstrap files.
- Use `--redact-private-keywords` if generating a sanitized manifest for publishing or review.
- Use `--redact-gps` for a run that should not write the private GPS file at all.

## Promote To Site Data

Promotion is automated by live Owner actions first, with exporter/review snapshots as fallback tools:

1. Build or refresh `tmp/import-cache/manifest.json`.
2. Prefer H/U/P and Unknown assignment in the localhost Owner surfaces; those actions move files immediately.
3. Run `scripts/export_photos_data.py --external-media` to publish every eligible cloud-backed preview.
4. Confirm Expo excludes blocked, discarded, RAW-only, and otherwise ineligible photos.
5. Run the visible versioning SOP when the public gallery changes.

We are walking away from the old Curation Pass workflow. Review snapshots are retained only for audit trails and emergency batch rebuilds.

## Verification

Before committing a gallery import:

```bash
node --check photos-data.js scripts/catalog_tsv.cjs scripts/write_catalog_tsv.cjs photo-gallery.js photo-detail.js basket.js liked.js photos.js
python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path

for path in Path(".").glob("*.html"):
    parser = HTMLParser()
    parser.feed(path.read_text(encoding="utf-8"))
print("HTML parse OK")
PY
git diff --check
```

Also inspect `tmp/import-cache/failures.json`. Empty `failures` means the latest build did not record outstanding extraction or render errors.

For user-visible gallery changes, preview the active pages locally and follow `SHOW_ME_SOP.md` for reporting URLs and the visible version.

## Commit And Push

For a completed public gallery import:

```bash
git status --short
git add <changed files>
git commit -m "photosbyelie: import <collection> lightroom gallery"
git push origin main
```

For repo-only ingestion documentation or script maintenance, use a docs or tooling-specific commit message and do not bump `VERSION`.
