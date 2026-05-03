# Photos By Elie TODO

Last updated: 2026-05-03

## Completed

- Replaced the remaining mock Mexico gallery with ten DNG-backed Puerto Vallarta selections, including preview exports, source file descriptions, megapixel counts, captions, and available derivative notes in `photos-data.js`.
- Added a repeatable Lightroom thumbnail builder and documented the ingestion, privacy, promotion, and verification workflow in `docs/sops/IMAGE_INGESTION_SOP.md`.

## Prioritized Next Steps

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
