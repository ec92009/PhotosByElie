# Photos By Elie TODO

Last updated: 2026-05-05

## Completed

- Replaced the remaining mock Mexico gallery with ten DNG-backed Puerto Vallarta selections, including preview exports, source file descriptions, megapixel counts, captions, and available derivative notes in `photos-data.js`.
- Added a repeatable Lightroom thumbnail builder and documented the ingestion, privacy, promotion, and verification workflow in `docs/sops/IMAGE_INGESTION_SOP.md`.
- Added rendered 2022 Spain-context Lightroom sale candidates to the public Spain gallery.
- Published the first capped Expo subset to GitHub Pages and added the local Owner and Hidden review surfaces.
- Added localhost moderation semantics where `H` hides in the live gallery, `U` undoes there, and `P` on the Hidden page returns a hidden photo to `Reserve` rather than straight back into Expo.
- Added localhost gallery single-click selection, double-click detail navigation, and a viewport-limited Grid density slider.
- Removed the collection number and archive blurb from gallery heroes.
- Renamed owner-facing blacklist export to Curation Pass, including `.pbe-curation` downloads and the Apply Curation Pass helper while keeping old payload compatibility.
- Expanded Owner into the curation command center with Curation Pass export, Expo cap, Hidden review, Unknown classification, and state counts.
- Moved Unknown out of the public homepage carousel and into a localhost-only owner classification queue.
- Polished the homepage by keeping only public collection cards, making every visible carousel card navigate to its collection, refreshing representative samples on carousel turns, improving the Archive shape copy, and adding the shared footer band across pages.
- Updated detail-page previous/next controls and left/right arrow keys so navigation continues across collection boundaries instead of looping inside one country.
- Made basket selections automatically feed the Liked list, pruned stale catalog entries from basket rendering, and expanded Unknown classification with same-day assignment plus H/U moderation.
- Removed assigned photos from the Unknown classification queue immediately after country assignment.
- Exercised a synthetic Curation Pass against a disposable local copy and hardened the direct-assets cleaner so missing Reserve derivatives are skipped, Expo fills up to the configured cap from available assets, and assigned visible Unknown photos move into the target country Reserve.
- Pruned the local Reserve index to physical JPEGs and cache-busted localhost Reserve loading so refills do not show stale broken previews.
- Made Expo selection random through the export and Curation Pass paths so Reserve fills do not preserve chronological archive runs.
- Updated public gallery cells to show real photo aspect ratios inside square slots, reserving strong selection framing for localhost curation.
- Tightened homepage sampling so representative photos refresh after a full public-country carousel cycle, not every single card change.
- Re-ran the Curation Pass cleaner in a disposable copy after the randomization change and verified expected publish counts with zero missing image references.
- Let visible side cards in the collection carousel navigate directly to their galleries instead of requiring a foregrounding click first.
- Added the visible ignored `assets/hidden` folder and a local Hidden catalog so the three physical asset states are now Expo, Reserve, and Hidden.
- Reset the asset contract to tracked `assets/expo` plus ignored `assets/reserve` and `assets/hidden`, with one country/AI/Unknown subfolder per state.
- Retired raw-first ingest assumptions: future imports scan developed JPG/TIFF exports into Reserve and leave Expo to curation.
- Imported the full Saturn Camera and Leonardo developed JPG/TIFF sources into local Reserve, curated a capped v65.30 public Expo build, and kept Unknown local-only.
- Added Unknown full-screen thumbnail preview, title/keyword metadata, and more reliable H/U shortcuts.
- Hardened Hidden review so it waits for local catalogs and avoids blank unresolved cards during load.
- Changed Curation Pass exports to declare browser-state curation, and updated the cleaner to preserve browser Expo picks first, then random-fill gaps from eligible current/Reserve photos, including country-assigned Unknowns.
- Added localhost-only live file actions so H/U/P move JPEG pairs directly between Expo, Hidden, and Reserve while GitHub Pages remains fully static.
- Renamed the owner review workflow to `hidden.html`, `hidden-page.js`, `hidden-actions.js`, `photosByElieHiddenActions`, and `photosbyelie:hiddenchange`.
- Added subtle keyboard reminder strips for owner curation grids and detail-page like/navigation shortcuts.
- Added day-before/day-after known-country context to Unknown cards so country assignment can use nearby travel dates.
- Made Unknown country assignment a live localhost file move into country Reserve folders and added previous/next shooting-day context.
- Changed previous/next shooting-day Unknown hints to use relative day distance instead of raw dates.
- Added localhost Owner editing for detail-page Title and Keywords, with saves flowing into catalog metadata, preview JPEG tags, and resolvable source exports.
- Added a localhost Owner country-keyword sync and changed gallery display default to newest-first without changing randomized Expo selection.
- Removed the dead gallery Restore control plus Source/Availability filters, fixed hidden controls rendering as empty pills, and tightened gallery filter wrapping.
- Added `scripts/sync_local_assets.py` so ignored Reserve/Hidden assets can be dry-run or synced between Max and David from either checkout.
- Made detail-page previous/next navigation follow the last gallery's filtered and sorted grid order when the current photo came from that gallery.
- Added gallery and Owner review `RAW` overlays for DNG/NEF/other raw-origin photos so duplicates can be reviewed without burning labels into preview files.
- Added `scripts/validate_publish.js` for generated-data validation, derivative-pair checks, resolution metadata checks, and publish summaries with Expo/Reserve/Hidden sizes.
- Added buyer-facing license notes on detail and basket pages plus a static basket order-intent summary and mail draft.
- Added mock physical print products, plain white/plain black frame add-ons, and a per-photo order review in the generated basket email.
- Added locale-inferred print unit ordering so metric locales see centimeter dimensions first and US-style locales see inch dimensions first.

## Current Priority Stack

1. **Harden Expo/Reserve/Hidden publishing.**
   - Keep Expo small and publishable under tracked `assets/expo`, keep `assets/reserve` and `assets/hidden` ignored/local, and preserve the safe GitHub Pages path without archive churn.
   - Keep treating the Owner-selected Expo cap as an upper bound for live local review and batch curation, not as a fixed global default.
   - Use `scripts/sync_local_assets.py` for local vault handoff rather than pushing Reserve/Hidden to Git.
   - Run `node scripts/validate_publish.js --summary` before public pushes.

2. **Improve gallery and detail review ergonomics.**
   - Add panoramic orientation filtering.
   - Add gallery hover metadata for title and safe context.
   - Retest gallery-selected detail navigation, mobile swipes, full-screen preview, and H/U/P owner shortcuts on narrow screens.

3. **Polish mobile buying and navigation.**
   - Tighten bottom action layout on detail pages.
   - Decide whether public detail needs single-tap full-screen preview in addition to double click.
   - Keep liked/basket affordances clear without duplicating controls in cramped views.

4. **Scale gallery generation.**
   - Reimport developed Lightroom JPG/TIFF exports into Reserve, then use export/live owner tooling to fill Expo.
   - Keep importer country classification improving, but do not let import write directly to Expo.
   - Keep monitoring embedded RAW preview imports for low-resolution or missing-preview failures before promoting RAW-origin photos into Expo.

5. **Keep operations steady.**
   - Document procedures, revisit branch protection, and defer a backend decision until the static/local curation model proves its limits.

## Product Backlog

1. **Automate manifest promotion into `photos-data.js`.**
   - Convert selected rows from `assets/reserve/manifest.json` into collection entries.
   - Preserve public-safe metadata, source file proof, and verified derivative dimensions.
   - Keep manual review for titles, captions, pricing, and privacy before publishing.
   - Preserve the physical-state contract: importer fills Reserve, curation fills Expo, Hidden stays local.

2. **Improve basket checkout from mock email to real order intent.**
   - Static order intent now exists on the basket page and includes per-photo email review details.
   - Decide whether checkout stays email-based, uses Stripe payment links, or moves to a small backend.

3. **Add basic photo licensing terms.**
   - Baseline personal print/web terms now appear on detail and basket pages.
   - Product choices now include mock physical prints and simple frame add-ons.
   - Expand the language into a fuller terms page if real checkout launches.
   - Keep prices tied to product choices until the pricing model is better tested.

4. **Add collection filtering and sorting.**
   - Filter by orientation, color mood, and subject.
   - Add a Panoramic orientation option before normal Landscape, likely based on aspect ratio `>= 2.0` or `>= 2.2`.
   - Sort by newest, collection order, price, and megapixel size.
   - Keep filters lightweight enough for GitHub Pages.
   - For localhost curation only, consider filling filtered views from matching Reserve photos when Expo matches fall below the Owner cap.
   - Keep buyer-facing filtered Reserve fill deferred until non-GitHub media hosting exists.

5. **Polish persistent favorites.**
   - Favorites already persist in localStorage and can move liked photos into the basket.
   - Retest the liked flow on mobile.
   - Decide whether favorites need collection-level affordances beyond the detail-page heart.

6. **Improve mobile gallery navigation.**
   - Add visible previous/next controls near gallery grids.
   - On narrow screens, duplicate primary CTA buttons and previous/next navigation at the bottom of each page, above the footer.
   - On phone-sized detail pages, horizontal swipes should trigger previous/next photo navigation.
   - On detail pages, single click/tap on the photo should enter full-screen preview; click/tap again should dismiss it.
   - Retest detail-page cross-collection previous/next navigation on mobile.
   - Consider a compact thumbnail strip for detail pages.
   - Retest swiping on phone after every carousel or gallery interaction change.

7. **Polish homepage collection sampling.**
   - Refresh the random representative photos after every full carousel cycle.
   - Use the number of public country collections as the cycle length so the samples rotate at a predictable pace.
   - Retest visible side-card navigation after carousel layout changes.

8. **Add SEO and social sharing metadata per collection and photo.**
   - Give each collection a stronger title and description.
   - Add share-ready preview images once real photos are imported.
   - Consider static generated detail pages later if search indexing becomes important.

9. **Decide when to leave pure GitHub Pages.**
   - Stay static while localStorage basket, email checkout, and manual fulfillment are enough.
   - Move to a backend when logins, customer accounts, paid downloads, private galleries, or inventory/order tracking become required.
   - Likely budget-conscious path: GitHub Pages plus Stripe links first, then a small hosted backend only when proven necessary.
   - Treat buyer-facing access to Reserve-sized catalogs as a post-GitHub/media-hosting phase.

10. **Document operating procedures.**
   - Add SOPs for importing photos, resizing derivatives, updating prices, testing basket behavior, and publishing.
   - Keep versioning under the existing MailAssist SOP.
   - Include a short recovery note for clearing localStorage during testing.

## Backlog: Archive Curation And Publishing

1. **Re-establish publishing away from one-machine dependence.**
   - Publish a lightweight, repeatable subset instead of relying on the current single-computer local archive.
   - Separate publishable web assets from the heavyweight local ingest and moderation workspace.
   - Decide whether the public site should ship only the curated Expo set while `Reserve` remains local or external.
   - Define a safe path for syncing publishable assets to GitHub without dragging the full Saturn archive into normal Git history.

2. **Introduce a third moderation state: Reserve.**
   - Keep Expo, `Reserve`, and Hidden as distinct states.
   - Use the Owner-selected Expo cap as an upper bound rather than a required count.
   - Future sold/pinned photos should be added on top of the Owner cap, not counted inside it.
   - Store Reserve and Hidden assets in visible local folders that are ignored from Git.
   - Keep future Expo fills randomized so Reserve promotions do not publish as chronological sequences.

3. **Add a localhost-only Owner surface.**
   - Keep refining the new `Owner` page as moderation needs become clearer.
   - Keep Batch Export there as an optional audit/batch action.
   - Verify the Expo cap control against live local moves and future cleaner passes.
   - Keep the Hidden page collection-like and localhost-only.
   - Preserve the rule that `P` returns a hidden photo to `Reserve`, not directly to Expo.

4. **Move Unknown into an Owner classification workflow.**
   - Remove `Unknown` from the public country-style collection list and treat it as an owner-only curation queue.
   - Add a manual classification path for assigning an unknown photo to a real country.
   - Decide whether classification writes a small owner export, updates the Lightroom manifest, or feeds directly into the cleaner script.
   - Preserve enough context while classifying, such as filename, capture time, GPS metadata, keywords, and nearby shoot folders.

5. **Refine localhost gallery selection behavior.**
   - Keep retesting single-click selection and double-click detail opening during live curation.
   - Preserve keyboard-first moderation flow and avoid making accidental navigation too easy while curating.
   - Retest single-click, double-click, arrow movement, and hide/undo on a phone-sized viewport.

6. **Add zoom control for gallery density.**
   - Refine the new Grid slider after live curation use.
   - Consider whether density should be local-only forever or become a public browsing preference.

7. **Show real photo aspect ratios in square gallery cells.**
   - Keep each gallery slot as a stable square background so the grid stays tidy.
   - Render the photo inside that square at its real aspect ratio instead of cropping or stretching it.
   - Use neutral/white bars where necessary so portrait, landscape, panorama, and square images all feel intentional.
   - Remove or soften public gallery borders/rectangles; reserve obvious selection framing for localhost curation mode.
   - Done for the current public grid; retest on mobile and tune the neutral cell background if needed.

8. **Add gallery hover metadata.**
   - Show a lightweight tooltip when hovering over a gallery photo.
   - Start with the photo title, then consider adding capture date, country, source type, or other safe metadata.
   - Keep touch devices clean; the tooltip should not block curation controls or accidental-tap prevention.

9. **Backburner: add GitHub branch protection.**
   - Revisit rulesets after the lightweight publish workflow has settled.
   - Protect `main` from force-pushes and accidental deletion.
   - Avoid blocking the solo publishing loop until the release path is smooth.
