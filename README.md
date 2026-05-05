# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v66.22`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, AI, Portugal, and Slovakia collections
- `france.html`, `usa.html`, `spain.html`, `mexico.html`, `ai.html`, `portugal.html`, `slovakia.html`: thin gallery shells rendered from shared photo data
- `unknown.html`: localhost-only Owner queue for classifying unknown photos into real country galleries
- `photo.html`: reusable photo detail page; product checkboxes sync directly to the basket and the preview adapts to image orientation
- `basket.html`: localStorage-backed static basket page with a sticky total band
- `liked.html`: localStorage-backed liked photos page; basketed photos are automatically liked
- `owner.html`: localhost-only owner controls for live review actions, optional Curation Pass export, Unknown classification, Hidden review, and the Expo cap
- `hidden.html`: localhost-only review surface for hidden photos
- `basket-store.js`: shared basket source-of-truth helpers for detail and basket pages
- `liked-store.js`: shared liked-photo source-of-truth helpers for detail and liked pages
- `hidden-actions.js`: localhost-only live review action store for Hidden moves, undo, Expo cap, and owner assignment state
- `hidden-store.js`: localhost-only loader for the ignored Hidden catalog used by Hidden review and hidden-photo detail pages
- `hidden-page.js`: localhost-only Hidden review grid
- `basket-rail.js`: compact wide-screen basket rail for browsing and photo detail pages
- `photos-data.js`: shared collection, photo, product option, and mock price data
- `photo-gallery.js`: shared gallery renderer
- `photo-detail.js`: shared detail page, real-image preview support, and automatic basket sync
- `basket.js`: basket rendering, item removal, resolution reselection, and sticky total updates
- `liked.js`: liked page rendering, unlike actions, and resolution selection into the basket
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme and language toggle behavior for subpages
- `site-version.js`: appends the current visible version to same-site page navigation to avoid stale cached HTML
- `scripts/validate_publish.js`: pre-push generated-data, asset-pair, resolution metadata, and publish-summary check
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
- Reserve import now scans developed JPG/TIFF exports plus RAW files with embedded previews, keeps Camera photos at Lightroom green label/rating 4+, infers country/AI/Unknown buckets, writes watermarked `*_900.jpg` and `*_1800.jpg` pairs into `assets/reserve/<country>/`, and marks RAW-origin cards with a gallery overlay.
- On localhost, `H` hides a live-gallery photo, `U` undoes that hide, and `P` on the Hidden page returns a hidden photo to Reserve rather than directly to Expo.
- On localhost detail pages, Owner can edit Title and Keywords; saves update the catalog metadata, local preview JPEGs, and the original source export when it can be resolved from `sourceFiles`.
- On the localhost Unknown page, cards show title/keyword metadata, same-day unknown counts, day-before/day-after known-country context, and previous/next shooting-day context with relative day distance; arrow keys move the selected card, `H` hides it, `U` undoes the last hide, and double clicking a thumbnail opens a full-screen preview that dismisses on click.
- Assigning an Unknown photo to a country moves every loaded same-day unknown JPEG pair into that country's local Reserve folder, adds the country keyword to catalog/source metadata, refreshes the Reserve/Unknown catalogs, and immediately re-renders the Unknown hints.
- The localhost Owner page can export Curation Pass files as `.pbe-curation` for audit and batch work, but H/U/P review actions now move files immediately through the local server.
- The localhost preview can be served by `python3 scripts/local_server.py 8000`, which keeps the public site static while adding localhost-only endpoints for Curation Pass saving and live photo moves.
- Every page has the shared footer band; the Owner link appears only on localhost.
- On localhost gallery pages, single click moves the selection rectangle, Enter or double click opens detail, and the Grid slider adjusts thumbnail density within the current viewport limits.
- Gallery filters cover orientation, color mood, and subject, with Sort defaulting to Newest first on first display.
- When a photo detail page is opened from a gallery, Previous/Next follows that gallery's current filtered and sorted grid order.
- Subtle keyboard reminders appear above localhost curation grids and detail previews, with public detail pages showing the `L` like shortcut.
- Gallery thumbnails render at their real aspect ratio inside stable square cells; strong selection outlines are reserved for localhost curation.
- Gallery and Owner review cards show a small `RAW` overlay when the source metadata identifies a DNG/NEF/other raw original; the overlay is DOM-only and is not burned into preview files.
- Homepage representative samples refresh after all public country cards have been active once in the carousel.
- Any visible collection carousel card can be clicked to open its gallery, even when it is not the foreground card.
- Curation Pass exports include the current Owner-selected Expo cap for batch curation and audit paths.
- Curation Pass application remains available for larger batch rebuilds: it fills each public Expo collection from a randomized eligible Expo/Reserve pool, writes ignored JSON catalogs for local Reserve/Hidden review, and keeps Reserve promotions from preserving archive sequence order.
- `scripts/export_photos_data.py --expo-cap N` regenerates `photos-data.js` and syncs the publishable Expo asset set under `assets/expo` up to that maximum.
- The basket is the source of truth for selected product options.
- Likes are stored separately from basket selections, so a photo can be liked before any resolution is chosen; adding a photo to the basket also keeps it liked.
- Wide screens show a compact right-side basket rail while browsing photos and collections.
- Basket rail actions include both Open basket and Liked.
- The basket page has a reduced hero and a sticky product total band that remains visible while scrolling.
- The liked page mirrors the basket layout, but rows come from hearted photos and totals count only selected products.
- The liked page includes bulk selectors for Full, JPG 6 MP, JPG 3 MP, and JPG 1 MP resolution choices.
- The header includes a single language button cycling English, French, and Spanish; it persists the selected state for later translation work.
- Detail pages start with no product checked unless that photo is already in the basket.
- Detail pages support previous/next buttons and left/right arrow keys that continue across collection boundaries on both public and localhost builds.
- Detail pages support `L` to like/unlike and double click on the preview to open a full-screen overlay that dismisses on click or double click.
- Detail pages preserve the original preview aspect ratio; landscape previews use a wide, space-maximizing layout while portrait and square-ish previews align to the top of the detail panel.
- Detail pages surface available embedded metadata such as metadata title, description, capture time, software, lens, exposure, and focal length.
- Visible `PhotosByElie` watermark overlays protect homepage, gallery, basket, and detail preview images.
- Checking or unchecking a product on detail immediately updates localStorage.
- Tapping the heart on a detail preview immediately updates the browser-local liked list.
- Resolution choices are limited by verified available megapixels; if only a preview/export is verified, larger options stay hidden.
- Full resolution choices show the verified developed source format, such as `JPG preview/export` or `TIFF preview/export`.
- Detail and basket pages now state the baseline personal print/web license and call out that commercial, resale, and AI-training use need written approval.
- The basket page generates a static order-intent summary and mail draft from the local basket contents.
- Product choices now include digital files and physical prints at 4 x 6, 5 x 7, 8 x 10, and 11 x 14 inches.
- Print offers infer the preferred measurement system from browser locale, showing inches first for US-style locales and centimeters first for metric locales while keeping both units visible.
- Selected prints carry a count stepper and a per-print frame choice: no frame, plain white, or plain black. Using the count stepper or choosing a frame selects that print automatically.
- The generated order email includes a per-photo review with selected products, source confidence, review links, and subtotals.
- In the basket, unchecking every resolution keeps the photo row available for later reselection; only Remove deletes it.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.
