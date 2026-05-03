# Conversation Summary

Date: 2026-05-03

## Scope

Continued work on the Photos By Elie static GitHub Pages site in `/Users/ecohen/Dev/PhotosByElie`, served locally at `http://localhost:8000/` and intended for `https://ec92009.github.io/PhotosByElie/`. The current visible version is `v64.19`.

## Repositories And Folders

- Primary repo worked from: `/Users/ecohen/Dev/photosByElie`.
- Related copy observed but not updated during the latest cycles: `/Users/ecohen/Dev/Webapps/PhotosByElie`.
- Source photo folders used earlier in the session:
  - France: `/Volumes/ecohen/Pictures/LR/France`
  - USA: `/Volumes/ecohen/Pictures/LR/USA`
  - Spain: `/Volumes/ecohen/Pictures/LR/Spain`
  - Mexico: `/Users/ecohen/Pictures/LR/Mexico`
  - AI samples: `~/Pictures/Leonardo/2023/06/08/UPSCALE`
- Archive copy completed during the latest follow-up:
  - Source: `/Volumes/Saturn/Pictures/LR/Camera/2024`
  - Destination: `/Volumes/ecohen/Pictures/LR/2024`
  - Verification: `rsync` exited with code 0, source and destination both contained 692 files, and a dry-run `rsync --itemize-changes` reported no pending changes.

## Major Site Work

- Added ten randomized Lightroom preview images each for France, USA, and Spain.
- Replaced the Mexico placeholder shell with ten DNG-backed Puerto Vallarta Lightroom selections.
- AI remains a Leonardo AI gallery.
- The homepage hero stack and collection carousel use the same representative collection photos.
- Collection cards use a classic Polaroid-style frame with the handwritten country name below the image.
- The carousel and hero stack use the classic Polaroid aspect ratio `3.483 / 4.233`.
- The carousel height was tuned so the spaniel companion aligns with the lower edge of the photos.
- Removed extra card copy and numeric labels from collection cards.
- Removed the "Pooch-powered carousel" comment.
- Updated hero language to say the live-shot galleries are the user's DSLR photos, while the AI gallery is built with Leonardo AI.

## Basket Work

- Removed the unnecessary Request access button and the detail-page Basket count pill.
- Removed the large left rail from the basket page.
- Basket totals now render as `N files, $M`.
- Basket page hero was reduced substantially to avoid unused vertical space.
- Basket totals moved into a thin sticky band above the basket content so they remain visible while scrolling.
- Basket rows keep per-photo resolution checkboxes, item totals, thumbnails, and Remove actions.
- Unchecking all resolution options keeps the basket row available for reselection; Remove deletes the row.
- Basket entry points now include a Liked button.

## Liked Photos

- Added a heart-shaped checkbox at the top right of the detail preview.
- Liked photos persist in browser-local storage separately from basket resolution choices.
- Added `liked.html`, which mirrors the basket page layout but lists hearted photos.
- Liked photos can have zero selected resolutions; checking resolutions on the Liked page adds those files to the basket immediately.
- The Liked page total band counts selected files and dollars for liked photos only.
- The Liked page total band includes bulk selectors for Full, 6 MP, 3 MP, and 1 MP resolution choices across all liked photos.

## Photo Detail Work

- Detail previews preserve the original image aspect ratio.
- Landscape images now use a wide, space-maximizing detail layout with metadata below the image.
- Portrait treatment remains unchanged.
- Detail titles prefer useful metadata titles or non-generic filenames instead of generic labels where available.
- Detail pages surface available metadata including metadata title, description, keywords, capture time, software, lens, exposure, and focal length.
- Exact GPS and personal/family keywords were filtered out of the metadata shown in the app.

## Metadata

- Extracted metadata for all current image-backed photos into `photos-data.js`.
- France, USA, Spain, and AI image entries include preview dimensions and available embedded metadata.
- Mexico image entries now include DNG source file descriptions, 20.7 MP source counts, preview dimensions, captions, and available derivative notes.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Detail pages and Full resolution choices show verified file formats such as `JPG preview/export`; Mexico Full choices now show DNG source proof via `sourceFiles`.

## Header And Language

- Added a single language button next to the Day/Night button.
- The language button cycles through English, French, and Spanish on each click.
- The selected language is persisted in `localStorage` and mirrored to `document.documentElement.lang` and `data-language`.
- This is UI/state plumbing only; full text translation has not yet been implemented.

## Preview Protection

- Added visible `PhotosByElie` watermark overlays to homepage Polaroids, gallery cards, basket thumbnails, and detail previews.
- The watermark opacity was later reduced by 75% so it remains present without dominating the photos.

## Versioning And Commits

- Versioning is intentionally bumped every visible web-page cycle.
- Current visible version: `v64.19`.
- Latest visible cycle added the Mexico DNG-backed gallery import and completed the first real-photo replacement TODO.
- Branch state before this docs refresh: `main` was ahead of `origin/main` by 14 local commits.
- Repo re-evaluation found the canonical standalone PhotosByElie app at `v64.19`; the older `/Users/ecohen/Dev/Webapps/PhotosByElie` mirror remained stale relative to the standalone app.
- Latest local commits after `origin/main` before this docs refresh include:
  - `79b3ad3 photosbyelie: use verified preview formats`
  - `9f87949 photosbyelie: refresh handoff summary`
  - `e7b2a7a photosbyelie: add liked bulk resolution selectors`
  - `fe42c6c photosbyelie: show source formats`
  - `ed3cf99 photosbyelie: simplify detail metadata`
  - `26a798c photosbyelie: simplify home hero`
  - `b2f9ed0 photosbyelie: simplify basket hero`
  - `2ca19cc photosbyelie: simplify liked hero`
  - `00f26ff photosbyelie: add liked photos flow`
  - `4135ff3 photosbyelie: restore narrow detail basket actions`
  - `478fad1 photosbyelie: correct visible version day`
  - `bb56e19 photosbyelie: move detail resolutions into rail`
  - `83356e2 photosbyelie: widen basket thumbnails`
  - `66c89b9 photosbyelie: add detail navigation links`

## Verification

- Local static checks have been run repeatedly:
  - `node --check` for the JS files
  - Python `HTMLParser` over all `.html` files
  - `git diff --check`
- Browser verification was performed in the in-app browser for:
  - Basket page sticky total band and language toggle
  - Detail page original aspect ratio
  - Landscape detail layout on `france-7`
  - Watermark visibility and softened opacity on `usa-4`
  - Homepage Polaroid watermark overlays
  - Liked page heart flow and bulk resolution selectors
