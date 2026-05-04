# Conversation Summary

Date: 2026-05-04

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current local visible build: `v65.32`
- Reserve has been rebuilt from Saturn Camera plus Leonardo sources, and Expo has been curated for the public build.
- The current public Expo set has 127 photos: 25 each for AI, France, Portugal, Spain, and USA, plus 2 Slovakia photos.
- The ignored local Reserve pool has 10,150 photos with 0 import failures, including 9,253 AI images and 96 Unknowns for later classification.

## Asset Contract

- `assets/` is tracked again.
- `assets/byelie-logo.png` and root JSON metadata such as `assets/expo-manifest.json` are tracked.
- `assets/expo/<country>/` is the publishable, tracked Expo state.
- `assets/reserve/<country>/` is the local Reserve state and is ignored by Git except for `.gitkeep` folder placeholders.
- `assets/hidden/<country>/` is the local Hidden state and is ignored by Git except for `.gitkeep` folder placeholders.
- Each state has subfolders for `france`, `usa`, `spain`, `mexico`, `ai`, `portugal`, `slovakia`, and `unknown`.
- Future derivative pairs use flat state folders: `<id>_900.jpg` for gallery and `<id>_1800.jpg` for detail.

## Import Direction

- The importer is now a Reserve builder, not a publisher.
- It scans only developed `.jpg`, `.jpeg`, `.tif`, and `.tiff` files.
- For Camera imports, it keeps only Lightroom green label/rating 4+ files.
- It no longer scans DNG, NEF, or other raw camera formats.
- It infers country/AI/Unknown buckets, writes watermarked Reserve JPEGs, and updates the ignored Reserve manifest/catalog.
- Expo is populated only by `scripts/export_photos_data.py` or `scripts/apply_curation_pass.py`.

## Curation Direction

- Owner exports now include both `expo_cap`/`expo_state` and legacy `regular_cap`/`regular_state` fields.
- Reserve and Hidden localhost catalogs are JSON files in ignored folders: `assets/reserve/reserve-data.json` and `assets/hidden/hidden-data.json`.
- Curation Pass logs now live outside assets in `.curation-logs/`.
- Existing browser behavior still uses the working “regular cap” internal storage key, but the physical/public vocabulary is Expo, Reserve, Hidden.

## Recent Decisions

- Generated JPGs are precious again after the Saturn rebuild.
- Camera imports dump every eligible developed green/4+ photo into Reserve and only try to classify countries.
- Published GitHub assets should include only the curated Expo set, never Reserve/Hidden.
