# Image Ingestion SOP

Repeatable workflow for importing Lightroom-selected photo and video media into the static Photos By Elie site.

## Scope

Use this SOP when adding or refreshing real media galleries from developed Lightroom exports. The automated path builds watermarked photo gallery/detail JPEG derivatives, video poster/short-preview derivatives, and metadata manifests into a disposable local import cache; Expo is filled later by live Owner review or export tooling.

Do not use this SOP for repo-only documentation edits, CSS-only page polish, or manual one-off fixes to existing gallery data.

> Retired Apple Photos path: browser-hosted direct import, Sidecar PhotoKit
> work, and the standalone Photos Bridge are no longer supported production
> workflows. The legacy local-server import endpoints fail closed with `410
> Backstage required`. Use PhotosByElie Backstage for native Photos access,
> culling, metadata, and export; use this SOP only after media is available as
> a normal developed source folder.

## Source Convention

- Canonical Lightroom camera archive: `/Volumes/Saturn/Pictures/LR/Camera`
- Apple Photos album exports for small source-agnostic import tests: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
- Source files must be developed exports: `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.mov`, `.mp4`, or `.m4v`.
- Do not import DNG, NEF, or other raw camera files as public media masters. Develop/export them first. The retired direct Apple Photos path is not a fallback.
- Lightroom sidecars may sit next to source media files as `.xmp` files when metadata is not embedded. The Photos By Elie Owner flow does not rewrite source files or sidecars automatically after upload; future XMP saves should be explicit Owner maintenance actions.
- The default importer selects developed files with Lightroom green label and rating 4 or higher. Use `--select all` only for explicitly selected folders such as Leonardo/AI.
- Apple Photos album exports are treated as explicitly selected by folder membership, so use `--select all` and let country inference assign them to a gallery or Unknown.
- The importer can use exported Apple Photos album/folder names as country hints when embedded country/GPS metadata is missing, for example a Malaga or Valencia folder can infer Spain. PhotoKit metadata is available only through the signed Backstage workflow and is not supplied by this folder importer.
- Legacy direct Apple Photos imports exported still images as Photos' rendered JPEG, including HEIC and RAW-backed assets; that path is retired and this note is historical only.
- Direct Apple Photos dry runs and Bridge fallback exports are retired. Use Backstage's native Photos workflow when PhotoKit access is required.
- Legacy Apple Photos video imports used the original MOV/MP4/M4V file plus generated poster and short-preview derivatives; direct PhotoKit import is retired.
- Direct Apple Photos imports are retired. The legacy local-server routes return `410 Backstage required`; use PhotosByElie Backstage for native Photos access instead.
- Sidecar and the standalone Photos Bridge are retired. Scheduled and connector maintenance uses authenticated IPC to the signed Backstage app and fails closed when it is unavailable.
- Apple Photos/iCloud remains a supported source through PhotosByElie Backstage. Backstage owns the Photos permission and routes maintenance through authenticated IPC; Python, browser, scheduled, and connector code must not inspect `.photoslibrary` contents or acquire a second PhotoKit identity.
- The old temporary Apple Photos import cache and `.pbe-apple-photos-assets.json` sidecars are legacy artifacts; they are not part of the supported production intake path.
- The builder groups derivatives by inferred gallery country using Lightroom country fields, country keywords, and known location hints.

## Prerequisites

Run from the repo root:

```bash
cd /Users/ecohen/Dev/PhotosByElie
```

Required command-line tools:

- `python3`
- `swift` from Xcode Command Line Tools only when building the signed Backstage
  app during development
- `exiftool`
- `ffmpeg`
- `ffprobe`
- Python `Pillow` package, used to bake photo and video-preview watermarks.

Check availability before a long run:

```bash
command -v python3 exiftool ffmpeg ffprobe
```

For Apple Photos work, open PhotosByElie Backstage and grant that signed app
Full Photos access. There is no supported raw-Swift, browser-hosted, Sidecar, or
standalone-Bridge fallback; those callers either use authenticated Backstage
IPC or fail closed.

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

Legacy Owner direct Apple Photos import (retired):

```bash
python3 scripts/local_server.py 8000
open http://localhost:8000/owner.html
```

The old **Import from Photos**, album dry-run, and **Import to Expo** controls
are retired. Their local-server routes return `410 Backstage required`. Use
Backstage **Fixtures**, **Culling**, **Metadata**, and **Uploads** instead; if a
normal folder import is needed, place developed media in a source folder and
run the ordinary pipeline above.

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

- Keep `tmp/import-cache` untracked. Hidden uses JSON state only (`assets/hidden/hidden-blacklist.json` and local `assets/hidden/hidden-data.json`); do not keep local preview media under Hidden.
- Keep `tmp/apple-photos-import` untracked. It is a localhost temporary export cache for direct Apple Photos imports, not a canonical library export.
- Keep `assets/owner-actions/country-assignments.jsonl` and `assets/owner-actions/country-assignments.json` only as SQLite-derived handoff/audit exports for localhost Unknown-to-country moves; `Owner.sqlite` is the authoritative write path. Each Unknown assignment is a live server action, not a browser-staged value: it should remove the chosen photo and same-day cohort from Unknown immediately and move them into the target Reserve country. If the move fails, the card should remain visible and the country selector should reset.
- Keep `assets/owner-actions/keyword-blacklist.json` only as a SQLite-derived UI compatibility export. The authoritative blacklist is `Owner.sqlite:keyword_blacklist`. It is metadata-only: import/export scripts use it to omit useless keyword strings from generated catalog metadata and keyword indexes, not to block, discard, skip, or rewrite media/source files.
- Treat Waste Basket media as owner-controlled undo assets, not clock-controlled assets. Ordinary X creates a recoverable Owner SQLite entry with immutable provenance; putting it back restores the exact prior state. Only an explicitly confirmed Empty Waste Basket operation activates a global tombstone. It retains source media, R2 objects, and history; publication/search/delivery/commerce remain fail-closed until the separate explicit tombstone-restore path is used.
- Do not paste exact GPS coordinates into public site data.
- Review public keywords before promoting them into the generated catalog SQLite/bootstrap files.
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
node --check catalog-sqlite.js photos-data.js scripts/catalog_tsv.cjs scripts/write_catalog_tsv.cjs photo-gallery.js photo-detail.js basket.js liked.js photos.js
python3 scripts/build_public_catalog_db.py --quiet
sqlite3 assets/catalog/photosbyelie.sqlite 'pragma integrity_check; pragma foreign_key_check;'
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
