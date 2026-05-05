# Conversation Summary

Date: 2026-05-05

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current local visible build: `v66.24`
- Reserve has been rebuilt from Saturn Camera plus Leonardo sources, and Expo has been curated for the public build.
- The current local Expo set has 502 photos: 100 each for AI, France, Portugal, Spain, and USA, plus 2 Slovakia photos; Mexico is empty until matching developed Mexico assets are reintroduced.
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
- It scans developed `.jpg`, `.jpeg`, `.tif`, and `.tiff` files, plus RAW files such as `.dng`/`.nef` when an embedded preview JPEG can be extracted.
- For Camera imports, it keeps only Lightroom green label/rating 4+ files.
- It infers country/AI/Unknown buckets, writes watermarked Reserve JPEGs, records RAW source metadata, and updates the ignored Reserve manifest/catalog.
- Expo is populated only by `scripts/export_photos_data.py` or `scripts/apply_curation_pass.py`.

## Curation Direction

- Owner exports now use only `expo_cap` and `expo_state`; live H/U/P actions bypass the Curation Pass and move files immediately on localhost.
- Owner mode is now backed by `scripts/local_server.py`: exported `.pbe-curation` files can still be written to `~/Downloads`, and live H/U/P actions move files directly between Expo, Hidden, and Reserve.
- The owner review code now uses Hidden naming throughout: `hidden.html`, `hidden-page.js`, `hidden-actions.js`, `photosByElieHiddenActions`, and `photosbyelie:hiddenchange`.
- v66.6 added subtle shortcut reminders above localhost curation grids plus detail-page reminders for like, navigation, full-screen preview, and owner hide/undo.
- v66.7 added day-before/day-after known-country context to Unknown cards to help classify surrounding travel dates.
- v66.8 made Unknown country assignment a live localhost file move into country Reserve folders and added previous/next shooting-day context to the hints.
- v66.9 changes previous/next shooting-day hints to show relative day distance instead of raw dates.
- v66.10 adds localhost Owner editing for photo Title and Keywords, writes those changes into catalog/previews/source files when available, syncs collection-country keywords, and makes gallery display sort newest-first by default while leaving Reserve selection randomized.
- v66.11 top-aligns portrait and square-ish detail previews beside the metadata panel.
- v66.12 removes the dead gallery Restore control, trims gallery filters to orientation/color mood/subject plus newest-first sorting, fixes hidden controls overriding the HTML `hidden` attribute, and adds a tracked Max/David local asset sync script.
- v66.13 makes detail-page previous/next navigation follow the last gallery grid order when opened from a filtered or sorted gallery, while direct detail links still fall back to the full catalog sequence.
- v66.14 adds a gallery-card-only `RAW` overlay for photos whose source metadata points to DNG/NEF/other raw originals, without burning that badge into preview files.
- v66.15 extends the `RAW` overlay helper to Owner Hidden/Unknown review grids and re-enables RAW import through embedded `exiftool` preview extraction.
- v66.16 moves Liked bulk resolution controls below the header and hides keyboard shortcut hints on public tap-first phone screens until real keyboard input is detected, while localhost continues to show owner keyboard hints.
- v66.17 moves the Liked bulk resolution controls below the `Liked` page heading rather than below the global site header.
- v66.18 adds generated-data/publish validation, publish summaries, buyer-facing license notes, and a static basket order-intent email draft.
- v66.19 adds mock physical print products, plain white/plain black frame add-ons, product totals, and a generated order email that reviews each ordered photo with selected products, source confidence, links, and subtotals.
- v66.20 infers preferred print units from browser locale and orders print dimensions as inches-first or centimeters-first while still showing both units.
- v66.21 changes print products to carry quantity and per-print framing via no-frame, plain white, and plain black radio choices.
- v66.22 adds explicit print count steppers and auto-selects the related print when a buyer changes count or picks a frame.
- v66.23 changes plain white/plain black frame mock pricing to scale by selected physical print size.
- v66.24 adds mock physical-print shipping and handling by size, paired with an equal limited-time S&H discount so net totals are unchanged; downloads remain free.
- The Max handoff tar finished at `/Volumes/MHD2/Users/ecohen/Dev/PhotosByElie/photosbyelie-ignored-assets-2026-05-05.tar`, and `scripts/sync_local_assets.py` now provides a reusable dry-run/apply workflow for ignored Reserve/Hidden vault syncs between Max and David.
- Gallery filters are intentionally lean now: Orientation, Color mood, Subject, and Sort. Source and Availability were removed from the visible gallery filter row.
- Reserve and Hidden localhost catalogs are JSON files in ignored folders: `assets/reserve/reserve-data.json` and `assets/hidden/hidden-data.json`.
- Curation Pass logs now live outside assets in `.curation-logs/`.
- Existing browser behavior still uses the working “regular cap” internal storage key, but the physical/public vocabulary is Expo, Reserve, Hidden.

## Recent Decisions

- Generated JPGs are precious again after the Saturn rebuild.
- Camera imports dump every eligible developed green/4+ photo into Reserve and only try to classify countries.
- Published GitHub assets should include only the curated Expo set, never Reserve/Hidden.
