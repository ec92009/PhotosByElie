# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v65.12`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, AI, Portugal, and Slovakia collections
- `france.html`, `usa.html`, `spain.html`, `mexico.html`, `ai.html`, `portugal.html`, `slovakia.html`: thin gallery shells rendered from shared photo data
- `unknown.html`: localhost-only Owner queue for classifying unknown photos into real country galleries
- `photo.html`: reusable photo detail page; resolution checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with a sticky total band
- `liked.html`: localStorage-backed liked photos page where liked-only photos can be turned into basket selections
- `owner.html`: localhost-only owner controls for Curation Pass export, Unknown classification, Unworthy review, and the Regular gallery cap
- `unworthy.html`: localhost-only review surface for hidden photos
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
- `assets/`: shared By Elie logo asset, publishable regular derivatives, and ignored local Lightroom/Leonardo reserve outputs

## Preview

Use the GitHub Pages URL above after pushing to `main`.

## Current Behavior

- Public collections are ordered France, USA, Spain, Mexico, AI, Portugal, and Slovakia.
- Unknown photos are no longer presented as a public country-style collection; localhost Owner gets a dedicated classification queue.
- Gallery pages currently load a capped `Regular` subset of 10 photos per collection from `assets/regular`.
- The larger Lightroom and Leonardo ingest outputs live under ignored local folders `assets/lightroom` and `assets/lightroom-ai` and act as the reserve pool.
- On localhost, `H` marks a live-gallery photo unworthy, `U` undoes that hide, and `P` on the Unworthy page returns a hidden photo to Reserve rather than directly to the Regular gallery.
- The localhost Owner page exports Curation Pass files as `.pbe-curation`; the cleaner still accepts older `.pbe-blacklist` payloads for compatibility.
- Every page has the shared footer band; the Owner link appears only on localhost.
- On localhost gallery pages, single click moves the selection rectangle, double click opens detail, and the Grid slider adjusts thumbnail density within the current viewport limits.
- `scripts/export_photos_data.py --regular-cap 10` regenerates `photos-data.js` and syncs the small publishable regular asset set.
- The basket is the source of truth for selected resolutions.
- Likes are stored separately from basket selections, so a photo can be liked before any resolution is chosen.
- Wide screens show a compact right-side basket rail while browsing photos and collections.
- Basket rail actions include both Open basket and Liked.
- The basket page has a reduced hero and a sticky total band that remains visible while scrolling.
- The liked page mirrors the basket layout, but rows come from hearted photos and totals count only selected resolution files.
- The liked page includes bulk selectors for Full, JPG 6 MP, JPG 3 MP, and JPG 1 MP resolution choices.
- The header includes a single language button cycling English, French, and Spanish; it persists the selected state for later translation work.
- Detail pages start with no resolution checked unless that photo is already in the basket.
- Detail pages support left/right arrow keys for previous/next photo navigation on both public and localhost builds.
- Detail pages preserve the original preview aspect ratio; landscape previews use a wide, space-maximizing layout while portrait previews keep the existing treatment.
- Detail pages surface available embedded metadata such as metadata title, description, capture time, software, lens, exposure, and focal length.
- Visible `PhotosByElie` watermark overlays protect homepage, gallery, basket, and detail preview images.
- Checking or unchecking a resolution on detail immediately updates localStorage.
- Tapping the heart on a detail preview immediately updates the browser-local liked list.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Full resolution choices show the verified file format, such as `JPG preview/export`; Mexico entries now prove DNG source availability through `sourceFiles`.
- In the basket, unchecking every resolution keeps the photo row available for later reselection; only Remove deletes it.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.
