# Photos By Elie TODO

Last updated: 2026-05-02

## Prioritized Next Steps

1. **Replace mock non-AI photos with real source images.**
   - Import a small first batch for France, USA, Spain, and Mexico.
   - Record each photo's source file description, megapixel count, collection, title, caption, and available derivatives in `photos-data.js`.
   - Keep the first import intentionally small so naming and metadata rules are proven before scaling.

2. **Create an image ingestion workflow.**
   - Define a source folder convention for originals and generated JPG sizes.
   - Generate web thumbnails and gallery previews from full-size files.
   - Preserve original filenames and write a repeatable manifest so future imports are not manual.

3. **Improve basket checkout from mock email to real order intent.**
   - Keep the current static basket behavior as the source of truth.
   - Add an order summary screen before checkout.
   - Decide whether checkout stays email-based, uses Stripe payment links, or moves to a small backend.

4. **Add basic photo licensing terms.**
   - Draft clear language for personal use, web use, print use, AI-generated imagery, and commercial use.
   - Show a short license note on photo detail and basket pages.
   - Keep prices tied to resolution choices until the pricing model is better tested.

5. **Add collection filtering and sorting.**
   - Filter by orientation, color mood, subject, source type, and availability.
   - Sort by newest, collection order, price, and megapixel size.
   - Keep filters lightweight enough for GitHub Pages.

6. **Add persistent favorites.**
   - Use localStorage for a static-site favorite list.
   - Let users move favorites into the basket.
   - Keep favorites separate from basket rows so browsing does not imply purchase intent.

7. **Improve mobile gallery navigation.**
   - Add visible previous/next controls near gallery grids and detail pages.
   - Consider a compact thumbnail strip for detail pages.
   - Retest swiping on phone after every carousel or gallery interaction change.

8. **Add SEO and social sharing metadata per collection and photo.**
   - Give each collection a stronger title and description.
   - Add share-ready preview images once real photos are imported.
   - Consider static generated detail pages later if search indexing becomes important.

9. **Decide when to leave pure GitHub Pages.**
   - Stay static while localStorage basket, email checkout, and manual fulfillment are enough.
   - Move to a backend when logins, customer accounts, paid downloads, private galleries, or inventory/order tracking become required.
   - Likely budget-conscious path: GitHub Pages plus Stripe links first, then a small hosted backend only when proven necessary.

10. **Document operating procedures.**
    - Add SOPs for importing photos, resizing derivatives, updating prices, testing basket behavior, and publishing.
    - Keep versioning under the existing MailAssist SOP.
    - Include a short recovery note for clearing localStorage during testing.
