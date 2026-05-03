# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v64.21`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, and AI collections
- `france.html`, `usa.html`, `spain.html`, `mexico.html`, `ai.html`: thin gallery shells rendered from shared photo data
- `photo.html`: reusable photo detail page; resolution checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with a sticky total band
- `liked.html`: localStorage-backed liked photos page where liked-only photos can be turned into basket selections
- `basket-store.js`: shared basket source-of-truth helpers for detail and basket pages
- `liked-store.js`: shared liked-photo source-of-truth helpers for detail and liked pages
- `basket-rail.js`: compact wide-screen basket rail for browsing and photo detail pages
- `photos-data.js`: shared collection, photo, resolution, and mock price data
- `photo-gallery.js`: shared gallery renderer
- `photo-detail.js`: shared detail page, real-image preview support, and automatic basket sync
- `basket.js`: basket rendering, item removal, resolution reselection, and sticky total updates
- `liked.js`: liked page rendering, unlike actions, and resolution selection into the basket
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme and language toggle behavior for subpages
- `AGENTS.md`: repo-level working preferences and versioning SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations, including versioning and Lightroom image ingestion
- `assets/`: shared By Elie logo asset, resized Lightroom gallery previews, and resized Leonardo AI gallery images

## Preview

Use the GitHub Pages URL above after pushing to `main`.

## Current Behavior

- Collections are ordered France, USA, Spain, Mexico, AI.
- France and Mexico use resized JPEG previews from their matching Lightroom source folders under `/Users/ecohen/Pictures/LR/`; Spain now includes its original previews plus rendered 2022 Lightroom sale candidates from `assets/lightroom`; the USA gallery uses five green-rated 2014 sale candidates from `assets/lightroom`.
- The home carousel and hero stack use the first selected France, USA, Spain, and Mexico previews.
- The AI gallery uses eight resized Leonardo-generated JPGs from `~/Pictures/Leonardo/2023/06/08/UPSCALE`.
- The basket is the source of truth for selected resolutions.
- Likes are stored separately from basket selections, so a photo can be liked before any resolution is chosen.
- Wide screens show a compact right-side basket rail while browsing photos and collections.
- Basket rail actions include both Open basket and Liked.
- The basket page has a reduced hero and a sticky total band that remains visible while scrolling.
- The liked page mirrors the basket layout, but rows come from hearted photos and totals count only selected resolution files.
- The liked page includes bulk selectors for Full, JPG 6 MP, JPG 3 MP, and JPG 1 MP resolution choices.
- The header includes a single language button cycling English, French, and Spanish; it persists the selected state for later translation work.
- Detail pages start with no resolution checked unless that photo is already in the basket.
- Detail pages preserve the original preview aspect ratio; landscape previews use a wide, space-maximizing layout while portrait previews keep the existing treatment.
- Detail pages surface available embedded metadata such as metadata title, description, capture time, software, lens, exposure, and focal length.
- Visible `PhotosByElie` watermark overlays protect homepage, gallery, basket, and detail preview images.
- Checking or unchecking a resolution on detail immediately updates localStorage.
- Tapping the heart on a detail preview immediately updates the browser-local liked list.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Full resolution choices show the verified file format, such as `JPG preview/export`; Mexico entries now prove DNG source availability through `sourceFiles`.
- In the basket, unchecking every resolution keeps the photo row available for later reselection; only Remove deletes it.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.
