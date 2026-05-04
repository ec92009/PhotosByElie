# Photos By Elie TODO

Last updated: 2026-05-04

## Completed

- Replaced the remaining mock Mexico gallery with ten DNG-backed Puerto Vallarta selections, including preview exports, source file descriptions, megapixel counts, captions, and available derivative notes in `photos-data.js`.
- Added a repeatable Lightroom thumbnail builder and documented the ingestion, privacy, promotion, and verification workflow in `docs/sops/IMAGE_INGESTION_SOP.md`.
- Added rendered 2022 Spain-context Lightroom sale candidates to the public Spain gallery.
- Published the first capped `Regular` subset to GitHub Pages and added the local Owner and Unworthy review surfaces.
- Added localhost moderation semantics where `H` hides in the live gallery, `U` undoes there, and `P` on the Unworthy page returns a hidden photo to `Reserve` rather than straight back into `Regular`.
- Added localhost gallery single-click selection, double-click detail navigation, and a viewport-limited Grid density slider.
- Removed the collection number and archive blurb from gallery heroes.

## Current Priority Stack

1. **Rename blacklist to Curation Pass.**
   - The export now carries hides, reserve returns, cap changes, and future classification decisions, so the owner-facing name should match the broader job before the workflow grows further.

2. **Make Owner the curation command center.**
   - Keep the cap control, Curation Pass export, Unworthy review, and future Unknown classification tools together on localhost.

3. **Move Unknown into Owner classification.**
   - Remove Unknown from public country-style galleries and create a manual path to classify each item into a real country with useful metadata context.

4. **Finish the browser-to-disk curation loop.**
   - Ensure H/U/P actions, reserve-only state, cap changes, replacements, and future country assignments export cleanly and can be applied by the off-browser cleaner.

5. **Harden Regular/Reserve publishing.**
   - Keep Regular small and publishable, keep Reserve and Unworthy ignored/local, and preserve the safe GitHub Pages path without archive churn.

6. **Improve live curation speed.**
   - Refine gallery density/zoom, aspect-preserving thumbnails, hover metadata, arrow movement, selection behavior, and mobile retesting so reviewing photos feels fast.

7. **Polish the homepage experience.**
   - Fix carousel hit targets, refresh samples on each carousel turn, add the bottom band everywhere, and give the Archive shape section better copy.

8. **Scale gallery generation.**
   - Automate manifest promotion into `photos-data.js` once the curation states and publishing rules are stable.

9. **Round out buyer-facing product basics.**
   - Add licensing, checkout/order intent, filtering/sorting, favorites polish, mobile navigation, and SEO/social metadata.

10. **Keep operations steady.**
   - Document procedures, revisit branch protection, and defer a backend decision until the static/local curation model proves its limits.

## Product Backlog

1. **Automate manifest promotion into `photos-data.js`.**
   - Convert selected rows from `assets/lightroom/manifest.json` into collection entries.
   - Preserve public-safe metadata, source file proof, and verified derivative dimensions.
   - Keep manual review for titles, captions, pricing, and privacy before publishing.

2. **Improve basket checkout from mock email to real order intent.**
   - Keep the current static basket behavior as the source of truth.
   - Add an order summary screen before checkout.
   - Decide whether checkout stays email-based, uses Stripe payment links, or moves to a small backend.

3. **Add basic photo licensing terms.**
   - Draft clear language for personal use, web use, print use, AI-generated imagery, and commercial use.
   - Show a short license note on photo detail and basket pages.
   - Keep prices tied to resolution choices until the pricing model is better tested.

4. **Add collection filtering and sorting.**
   - Filter by orientation, color mood, subject, source type, and availability.
   - Sort by newest, collection order, price, and megapixel size.
   - Keep filters lightweight enough for GitHub Pages.

5. **Polish persistent favorites.**
   - Favorites already persist in localStorage and can move liked photos into the basket.
   - Retest the liked flow on mobile.
   - Decide whether favorites need collection-level affordances beyond the detail-page heart.

6. **Improve mobile gallery navigation.**
   - Add visible previous/next controls near gallery grids and detail pages.
   - Consider a compact thumbnail strip for detail pages.
   - Retest swiping on phone after every carousel or gallery interaction change.

7. **Add SEO and social sharing metadata per collection and photo.**
   - Give each collection a stronger title and description.
   - Add share-ready preview images once real photos are imported.
   - Consider static generated detail pages later if search indexing becomes important.

8. **Decide when to leave pure GitHub Pages.**
   - Stay static while localStorage basket, email checkout, and manual fulfillment are enough.
   - Move to a backend when logins, customer accounts, paid downloads, private galleries, or inventory/order tracking become required.
   - Likely budget-conscious path: GitHub Pages plus Stripe links first, then a small hosted backend only when proven necessary.

9. **Document operating procedures.**
   - Add SOPs for importing photos, resizing derivatives, updating prices, testing basket behavior, and publishing.
   - Keep versioning under the existing MailAssist SOP.
   - Include a short recovery note for clearing localStorage during testing.

## Backlog: Archive Curation And Publishing

1. **Re-establish publishing away from one-machine dependence.**
   - Publish a lightweight, repeatable subset instead of relying on the current single-computer local archive.
   - Separate publishable web assets from the heavyweight local ingest and moderation workspace.
   - Decide whether the public site should ship only the curated `Regular` set while `Reserve` remains local or external.
   - Define a safe path for syncing publishable assets to GitHub without dragging the full Saturn archive into normal Git history.

2. **Introduce a third moderation state: Reserve.**
   - Keep `Regular`, `Reserve`, and `Unworthy` as distinct states.
   - Start with a much smaller regular cap such as `10` per country, then raise it progressively during curation.
   - Store reserve assets in a location that can be ignored from Git when appropriate.
   - When a regular photo becomes unworthy on localhost, replace it with a random reserve photo from the same country.
   - Decide whether reserve promotion should be deterministic per session or reshuffled after each applied moderation pass.

3. **Add a localhost-only Owner surface.**
   - Keep refining the new `Owner` page as moderation needs become clearer.
   - Keep `Export blacklist` there as a primary action.
   - Verify the `Regular` cap control against a real exported blacklist and cleaner pass.
   - Keep the `Unworthy` page collection-like and localhost-only.
   - Preserve the rule that `P` returns a hidden photo to `Reserve`, not directly to `Regular`.

4. **Move Unknown into an Owner classification workflow.**
   - Remove `Unknown` from the public country-style collection list and treat it as an owner-only curation queue.
   - Add a manual classification path for assigning an unknown photo to a real country.
   - Decide whether classification writes a small owner export, updates the Lightroom manifest, or feeds directly into the cleaner script.
   - Preserve enough context while classifying, such as filename, capture time, GPS metadata, keywords, and nearby shoot folders.

5. **Rename the blacklist workflow to Curation Pass.**
   - Replace owner-facing `blacklist` wording with `Curation Pass`, since the export now carries hides, reserve returns, cap changes, and future classification decisions.
   - Consider renaming the downloadable extension from `.pbe-blacklist` to something like `.pbe-curation`.
   - Consider renaming scripts/buttons around the same concept, for example `Export Curation Pass` and `Apply Curation Pass`.
   - Keep the old blacklist name as a compatibility alias until existing exports are no longer useful.

6. **Refine localhost gallery selection behavior.**
   - Keep retesting single-click selection and double-click detail opening during live curation.
   - Preserve keyboard-first moderation flow and avoid making accidental navigation too easy while curating.
   - Keep `Export blacklist` accessible from the homepage footer for localhost owner workflows.
   - Retest single-click, double-click, arrow movement, and hide/undo on a phone-sized viewport.

7. **Add zoom control for gallery density.**
   - Refine the new Grid slider after live curation use.
   - Consider whether density should be local-only forever or become a public browsing preference.

8. **Show real photo aspect ratios in square gallery cells.**
   - Keep each gallery slot as a stable square background so the grid stays tidy.
   - Render the photo inside that square at its real aspect ratio instead of cropping or stretching it.
   - Pick a neutral background treatment that makes portrait, landscape, panorama, and square images all feel intentional.

9. **Add gallery hover metadata.**
   - Show a lightweight tooltip when hovering over a gallery photo.
   - Start with the photo title, then consider adding capture date, country, source type, or other safe metadata.
   - Keep touch devices clean; the tooltip should not block curation controls or accidental-tap prevention.

10. **Fix homepage carousel card hit targets.**
   - Clicking a collection card currently navigates even when that card is not the foreground carousel item.
   - Restrict navigation to the active/foreground card, or otherwise make background cards non-clickable.
   - Retest keyboard and pointer behavior after the carousel hit target fix.

11. **Refresh homepage samples on each pooch turn.**
   - When the main-page carousel/pooch advances, pick fresh representative sample photos instead of keeping the same page-load random picks.
   - Keep the hero stack and carousel cards in sync so each turn feels like a new browseable sample set.
   - Avoid jarring layout shifts while images refresh.

12. **Add the bottom band everywhere.**
   - Use the footer/bottom band consistently across home, gallery, detail, owner, unworthy, basket, and liked pages.
   - Show owner-only links such as `Owner` and `Export blacklist` only on localhost.
   - Keep published footer contents public-safe, likely `By Elie`, `Collections`, and other public navigation only.
   - Make the band responsive so it stays readable on narrow screens.

13. **Give the homepage archive stats something worth saying.**
   - Revisit the `Archive shape` band and replace placeholder-feeling stats/copy with something more meaningful.
   - Keep the section compact, useful, and visually balanced with the rest of the homepage.
   - Consider whether the values should describe the public Regular set, the local archive, the reserve workflow, or the broader By Elie media vault.

14. **Backburner: add GitHub branch protection.**
   - Revisit rulesets after the lightweight publish workflow has settled.
   - Protect `main` from force-pushes and accidental deletion.
   - Avoid blocking the solo publishing loop until the release path is smooth.
