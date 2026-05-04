# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v65.28`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, AI, Portugal, and Slovakia collections
- `france.html`, `usa.html`, `spain.html`, `mexico.html`, `ai.html`, `portugal.html`, `slovakia.html`: thin gallery shells rendered from shared photo data
- `unknown.html`: localhost-only Owner queue for classifying unknown photos into real country galleries
- `photo.html`: reusable photo detail page; resolution checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with a sticky total band
- `liked.html`: localStorage-backed liked photos page; basketed photos are automatically liked
- `owner.html`: localhost-only owner controls for Curation Pass export, Unknown classification, Hidden review, and the Expo cap
- `unworthy.html`: localhost-only review surface for hidden photos
- `basket-store.js`: shared basket source-of-truth helpers for detail and basket pages
- `liked-store.js`: shared liked-photo source-of-truth helpers for detail and liked pages
- `hidden-store.js`: localhost-only loader for the ignored Hidden catalog used by Hidden review and hidden-photo detail pages
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
- `site-version.js`: appends the current visible version to same-site page navigation to avoid stale cached HTML
- `AGENTS.md`: repo-level working preferences and versioning SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations, including versioning and Lightroom image ingestion
- `assets/`: shared By Elie logo asset, publishable Expo derivatives, and ignored local Reserve/Hidden working folders

## Preview

Use the GitHub Pages URL above after pushing to `main`.

## Current Behavior

- Public collections are ordered France, USA, Spain, Mexico, AI, Portugal, and Slovakia.
- Unknown photos are no longer presented as a public country-style collection; localhost Owner gets a dedicated classification queue.
- Unknown classification assigns every loaded unknown photo from the same capture day when one photo is assigned to a country, then removes assigned photos from the visible queue.
- Owner Unknown counts use the same current-queue filter as the Unknown page, so old browser assignment history does not subtract unrelated photos.
- Gallery pages load the publishable Expo subset from tracked `assets/expo`; the cap is a maximum, so collections publish fewer photos when fewer valid JPEG pairs are available.
- The three asset states are explicit on disk: `assets/expo` for publishable Expo, `assets/reserve` for ignored local Reserve, and `assets/hidden` for ignored local Hidden.
- Reserve import now scans developed JPG/TIFF exports only, keeps Camera photos at Lightroom green label/rating 4+, infers country/AI/Unknown buckets, writes watermarked `*_900.jpg` and `*_1800.jpg` pairs into `assets/reserve/<country>/`, and never scans DNG/NEF/raw files.
- On localhost, `H` hides a live-gallery photo, `U` undoes that hide, and `P` on the Hidden page returns a hidden photo to Reserve rather than directly to Expo.
- On the localhost Unknown page, arrow keys move the selected card, `H` hides it, and `U` undoes the last hide.
- The localhost Owner page exports Curation Pass files as `.pbe-curation`; the cleaner still accepts older `.pbe-blacklist` payloads for compatibility.
- Every page has the shared footer band; the Owner link appears only on localhost.
- On localhost gallery pages, single click moves the selection rectangle, Enter or double click opens detail, and the Grid slider adjusts thumbnail density within the current viewport limits.
- Gallery thumbnails render at their real aspect ratio inside stable square cells; strong selection outlines are reserved for localhost curation.
- Homepage representative samples refresh after all public country cards have been active once in the carousel.
- Any visible collection carousel card can be clicked to open its gallery, even when it is not the foreground card.
- Curation Pass exports include the current Owner-selected Expo cap so the cleaner can apply the browser's active maximum.
- Curation Pass application fills each public Expo collection from a randomized eligible Expo/Reserve pool, writes ignored JSON catalogs for local Reserve/Hidden review, and keeps Reserve promotions from preserving archive sequence order.
- `scripts/export_photos_data.py --regular-cap N` regenerates `photos-data.js` and syncs the publishable Expo asset set under `assets/expo` up to that maximum.
- The basket is the source of truth for selected resolutions.
- Likes are stored separately from basket selections, so a photo can be liked before any resolution is chosen; adding a photo to the basket also keeps it liked.
- Wide screens show a compact right-side basket rail while browsing photos and collections.
- Basket rail actions include both Open basket and Liked.
- The basket page has a reduced hero and a sticky total band that remains visible while scrolling.
- The liked page mirrors the basket layout, but rows come from hearted photos and totals count only selected resolution files.
- The liked page includes bulk selectors for Full, JPG 6 MP, JPG 3 MP, and JPG 1 MP resolution choices.
- The header includes a single language button cycling English, French, and Spanish; it persists the selected state for later translation work.
- Detail pages start with no resolution checked unless that photo is already in the basket.
- Detail pages support previous/next buttons and left/right arrow keys that continue across collection boundaries on both public and localhost builds.
- Detail pages support `L` to like/unlike and double click on the preview to open a full-screen overlay that dismisses on click or double click.
- Detail pages preserve the original preview aspect ratio; landscape previews use a wide, space-maximizing layout while portrait previews keep the existing treatment.
- Detail pages surface available embedded metadata such as metadata title, description, capture time, software, lens, exposure, and focal length.
- Visible `PhotosByElie` watermark overlays protect homepage, gallery, basket, and detail preview images.
- Checking or unchecking a resolution on detail immediately updates localStorage.
- Tapping the heart on a detail preview immediately updates the browser-local liked list.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Full resolution choices show the verified developed source format, such as `JPG preview/export` or `TIFF preview/export`.
- In the basket, unchecking every resolution keeps the photo row available for later reselection; only Remove deletes it.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.
