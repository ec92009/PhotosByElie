# Conversation Summary

Date: 2026-05-04

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current local visible build prepared for publish: `v65.27`
- Local `main` contains verified v65.27 Owner/Unknown queue count alignment and is ready for commit and push.

## Latest Decisions

- Use the terms `Expo`, `Reserve`, and `Hidden` for the three curation states.
- `assets/regular` remains the publishable Expo asset root.
- `assets/reserve` and `assets/hidden` are visible local/ignored working folders for Reserve and Hidden.
- `assets/.moderation-hidden` remains only for local Curation Pass apply logs.
- Old `assets/lightroom` and `assets/lightroom-ai` ingest staging folders have been removed locally after migrating the still-referenced Reserve JPEGs into `assets/reserve/legacy`.
- The Owner-selected Expo cap travels inside each `.pbe-curation` file.
- The cap is an upper bound, not a required fill count. Collections with fewer valid JPEG pairs publish fewer photos.
- Applied Curation Passes use random Expo selection from the eligible Expo/Reserve pool, so Reserve fills do not preserve archive sequence order.
- Future sold/pinned photos should sit on top of the Owner-selected Expo cap, not count against it.
- Hidden photos promoted with `P` go back to Reserve, not directly to Expo.
- Future import work should use developed Lightroom JPG exports, not raw DNG/NEF files.

## Current Publish Set

The latest cap-25 Curation Pass was applied locally. `photos-data.js` now publishes:

- France: 25
- USA: 16
- Spain: 25
- Mexico: 10
- AI: 10
- Portugal: 10
- Slovakia: 25

Verification found `0` missing local image references. The publishable `assets/regular` set contains 262 JPG derivatives, about 67 MB total, and sample inspection confirmed the visible `PhotosByElie` watermark is present on generated previews.

## Recent Work Completed

- Added direct-assets Curation Pass support so the cleaner can operate from site data and physical assets when local Lightroom manifests are unavailable.
- Pruned stale Reserve entries so localhost refills no longer promote missing preview files.
- Added cache-busting for localhost Reserve data.
- Made random selection stay random in the manifest export path and in direct-assets Curation Pass application.
- Re-ran the latest real Curation Pass in a disposable copy after the randomization change; publish counts matched expectations and missing image references stayed at `0`.
- Added the visible ignored `assets/hidden` folder and `hidden-store.js`; direct-assets Curation Pass application now moves hidden JPEG derivatives there and writes `assets/hidden/hidden-data.js` for localhost Hidden review.
- Renamed owner-facing blacklist export to Curation Pass while preserving compatibility with older `.pbe-blacklist` payloads.
- Expanded Owner into a localhost-only command center with Curation Pass export, Expo cap, Hidden review, Unknown classification, and state counts.
- Fixed Owner export feedback:
  - Save the current Expo cap before exporting.
  - Trigger a `.pbe-curation` download.
  - Show the generated filename.
  - Show the generated JSON payload in a textarea as a fallback when browser downloads are silent.
- Added `site-version.js` so same-site page links and carousel `data-href` navigation receive the current `?v=` query string. This avoids navigating from a fresh homepage into stale cached gallery/detail HTML.
- Moved Unknown out of public collection surfaces and into a localhost-only classification workflow.
- Unknown classification assigns every loaded unknown photo from the same capture day and removes assigned photos from the queue immediately.
- Owner now counts the Unknown queue with the same rules as the Unknown page: current unknown photos only, excluding current hidden IDs and current country assignments.
- Added H/U moderation to Unknown.
- Detail previous/next buttons and left/right arrows now continue across collection boundaries on public and localhost builds.
- Detail pages support double-click full-screen preview overlays, click/double-click dismissal, and `L` to like/unlike.
- Gallery pages support local keyboard selection, Enter-to-detail navigation, H/U moderation, Reserve refill, and a viewport-limited Grid slider.
- Public gallery cells now show photos at their real aspect ratio inside stable square slots, with strong selection outlines limited to localhost owner mode.
- Footer band is present across pages, with the Owner link only on localhost.
- Homepage carousel and hero samples refresh from collection photos after every full public-country carousel cycle.
- Visible carousel side cards now navigate directly to their galleries rather than first moving to the foreground.
- User promoted the browser-local Hidden queue back toward Reserve to start the next moderation pass from a fresh hidden baseline.
- The TODO was reprioritized around:
  - starting buyer-side product basics,
  - hardening Expo/Reserve/Hidden publishing,
  - live review ergonomics,
  - homepage sampling,
  - gallery generation,
  - operations.

## Verification Run

- `node --check owner.js unworthy-store.js photo-gallery.js photo-detail.js unworthy-page.js reserve-store.js`
- `python3 -m py_compile scripts/export_photos_data.py scripts/apply_curation_pass.py`
- Python `HTMLParser` over all root HTML files
- Node data scan for missing local `gallerySrc` and `imageSrc` references
- Node smoke test confirmed Owner ignores unrelated old country assignments when counting the current Unknown queue.
- `git diff --check`
- Local `curl` confirmed root HTML shows `PHOTOS BY ELIE - v65.27`, cache-bust strings use `?v=65.27`, and `unworthy.html` loads `hidden-store.js?v=65.27`.

## Important Notes

- The in-app browser downloads `.pbe-curation` files into `.playwright-mcp`, while the user's external browser may save elsewhere.
- `~/Downloads` did not show the expected curation file during the latest check; Owner now exposes the payload directly so this is not a blocker.
- The public GitHub Pages site still showed `v65.15` with 10 pictures per gallery before the current push because the local build had not yet been pushed to `origin/main`.
