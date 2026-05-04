# Image Ingestion SOP

Repeatable workflow for importing Lightroom-selected photos into the static Photos By Elie site.

## Scope

Use this SOP when adding or refreshing real-photo galleries from developed Lightroom exports. The automated path builds watermarked gallery and detail JPEG derivatives plus metadata manifests into local Reserve; Expo is filled later by Curation Pass/export tooling.

Do not use this SOP for repo-only documentation edits, CSS-only page polish, or manual one-off fixes to existing gallery data.

## Source Convention

- Canonical Lightroom camera archive: `/Volumes/Saturn/Pictures/LR/Camera`
- Source files must be developed exports: `.jpg`, `.jpeg`, `.tif`, or `.tiff`.
- Do not import DNG, NEF, or other raw camera files. Develop/export them first.
- Lightroom sidecars should sit next to the image files as `.xmp` files when metadata is not embedded.
- The default importer selects developed files with Lightroom green label and rating 4 or higher. Use `--select all` only for explicitly curated folders such as Leonardo/AI.
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

Check availability before a long run:

```bash
command -v python3 exiftool ffmpeg
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
  --output-root assets/reserve \
  --years 2024 \
  --batch-size 50
```

Use `--limit N` for a small trial and `--dry-run` when checking selection behavior without writing derivatives. Use `--force` only when intentionally rebuilding existing derivatives.

## Resume Behavior

The builder is designed to be interrupted and resumed.

- `assets/reserve/.build-state.jsonl` records inspected and selected source paths.
- Existing derivatives are skipped unless `--force` is used.
- If a manifest row exists but a derivative is missing, rerunning from a source archive can regenerate that derivative.
- Use the same `--output-root` when resuming so checkpoints and manifests stay aligned.

## Outputs

- `assets/reserve/<country>/*_900.jpg`: watermarked gallery thumbnails.
- `assets/reserve/<country>/*_1800.jpg`: watermarked detail-page images.
- `assets/reserve/manifest.json`: selected photo metadata and derivative references.
- `assets/reserve/keywords.json`: keyword counts and photo references for future filtering.
- `assets/reserve/collections.json`: generated indexes for years, locations, orientation, source formats, and gallery countries.
- `assets/reserve/failures.json`: extraction or render failures to inspect before publishing.
- `assets/reserve/gps-metadata.json`: exact GPS metadata, ignored by Git.

## Privacy Rules

- Keep `assets/reserve` and `assets/hidden` untracked except for their `.gitkeep` folder placeholders.
- Do not paste exact GPS coordinates into public site data.
- Review public keywords before promoting them into `photos-data.js`.
- Use `--redact-private-keywords` if generating a sanitized manifest for publishing or review.
- Use `--redact-gps` for a run that should not write the private GPS file at all.

## Promote To Site Data

Promotion is automated by the Expo exporter/curation pass:

1. Build or refresh `assets/reserve/manifest.json`.
2. Export a Curation Pass from the localhost Owner page when applying browser review decisions.
3. Run `scripts/apply_curation_pass.py` or `scripts/export_photos_data.py --regular-cap N`.
4. Confirm Expo contains only publishable watermarked JPEGs under `assets/expo/<country>/`.
5. Run the visible versioning SOP when the public gallery changes.

## Verification

Before committing a gallery import:

```bash
node --check photos-data.js photo-gallery.js photo-detail.js basket.js liked.js photos.js
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

Also inspect `assets/reserve/failures.json`. Empty `failures` means the latest build did not record outstanding extraction or render errors.

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
