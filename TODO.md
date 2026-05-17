# Photos By Elie Backlog

Last updated: 2026-05-17

## Current Facts

- Current visible build: `v77.3`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Public catalog count: `5,827` active media rows.
- Public collection counts: France `289`, USA `151`, Spain `223`, Mexico `2`, AI `4,920`, Italy `24`, Portugal `216`, Slovakia `2`.
- Public pages load `assets/catalog/photosbyelie.sqlite` first, with TSV compatibility fallback under `assets/catalog/`.
- Product/pricing data is generated from `assets/catalog/product-pricing.json` into public SQLite product tables, with JSON used only as a TSV/runtime fallback.
- Local Owner workflow state writes to ignored `assets/owner-actions/Owner.sqlite`, with JSON compatibility exports where the current UI still needs them.
- Public previews are R2-backed and watermarked.
- Private sellable assets are R2-backed and unwatermarked.
- Waste Basket/discard tombstones are durable. A banned photo stays banned.
- The public catalog validator now rejects discarded/tombstoned ids in public catalog data and `assets/expo-manifest.json`.
- Photos sell four digital delivery flavors: full, JPG 6 MP, JPG 3 MP, and JPG 1 MP.
- Videos use a `still_900` gallery poster, a `short_5s_720p` detail preview, and full-original buyer delivery only.
- Liked and Basket now use fixed commerce headers, so the liked/basket/checkout/language/theme buttons stay frozen on mobile scroll.
- `npm run validate` and `npm test` are mandatory before publishing public-site changes.

## Numbered Backlog

1. **Completed: Switch public runtime loading to SQLite.**
   - Public pages now load `assets/catalog/photosbyelie.sqlite` through `catalog-sqlite.js`.
   - TSV remains as a compatibility fallback for GitHub Pages and current tooling.

2. **Completed: Make SQLite generation repeatable.**
   - `scripts/build_public_catalog_db.py` rebuilds the public DB and validates integrity, foreign keys, duplicate media ids, keyword ids, and required asset rows.
   - `node scripts/write_catalog_tsv.cjs` refreshes TSV compatibility exports, the SQLite bootstrap, and the public DB together.

3. **Completed: Move active Owner workflow state into `Owner.sqlite`.**
   - Title/keyword queue, proposals, decisions, country assignments, keyword blacklist, and settings import into the local DB.
   - Localhost actions now write blacklist, country assignment, and title/keyword decision changes into `Owner.sqlite`, then export compatibility JSON.

4. **Completed: Add parked title/keyword state.**
   - The generator parks rows it cannot title defensibly and keeps filling ordinary-new slots.
   - Parked rows are excluded from accepted/rejected scoring and future ordinary batches until manually reset.

5. **Completed: Rework Owner review scoring/reporting.**
   - `python3 scripts/owner_state_db.py --review-counts` reports accepted/applied, submitted-unchecked, rejected/rework, and parked counts from local DB state.

6. **Completed: Enforce title/keyword proposal quality.**
   - Queue generation refuses empty/placeholder proposed titles, parks weak rows, and derives rework titles from keyword/source context where possible.

7. **Completed: Finish video import hardening.**
   - Apple Photos mixed-album import remains video-aware.
   - Face albums remain off limits by SOP.
   - The portable Pillow overlay path uses an explicit `-t 5` on the ffmpeg overlay pass.

8. **Completed: Migrate R2 keys to the flat SQLite-era conventions.**
   - Worker checkout/delivery now prefers `masters/<media_id>.<format>` and `renders/<media_id>_<1|3|6>mp.jpg`.
   - Legacy nested master/render keys remain as delivery fallbacks during the cleanup window.
   - R2 server-side copy/verify moved the copyable private masters and photo render triplets to the flat target keys.
   - Latest live coverage: `5,801 / 5,827` catalog photos have private masters and `5,799 / 5,827` have complete private render triplets.
   - Residual repair queue: `26` missing masters, `6` flat render target gaps covered by legacy fallback, and `10` public preview gaps.
   - Do not delete old keys until a later audit confirms no runtime path needs them.

9. **Prove Stripe checkout in test mode.**
   - Configure Stripe test keys and webhook secret in the Worker environment.
   - Test successful payment, declined payment, 3D Secure/authentication, webhook replay, and amount mismatch.
   - Confirm paid orders expose per-file private downloads and unpaid orders do not.

10. **Make checkout/order storage production-durable.**
    - Choose D1 or KV for durable order records.
    - Store order id, buyer email, basket snapshot, amount, payment status, delivery keys, and download events.
    - Add buyer-facing order recovery before considering full buyer accounts.

11. **Completed: Move product/pricing data out of generated JS constants.**
    - `assets/catalog/product-pricing.json` is the generator/fallback source for photo products, print/frame prices, shipping/handling, and video tiers.
    - `assets/catalog/photosbyelie.sqlite` now contains `price_tiers`, `products`, `product_prices`, `frame_options`, `frame_prices`, `shipping_handling_prices`, and `video_price_tiers`.
    - Public SQLite loading, TSV fallback tooling, and Worker catalog generation now reconstruct the same product price list.
    - Videos use `video-original` delivery at flat `$20` across the current length tiers.

12. **Keep physical products behind Owner review.**
    - Keep print/frame products off publicly until samples and fulfillment rules are settled.
    - Compare POD vendors for US/EU quality, packaging, landed cost, API fit, and support.
    - Re-enable only after pricing, shipping, refunds, and customer support are clear.

13. **Curate the first sellable storefront.**
    - Apply title/keyword approvals to the strongest catalog rows.
    - Block/discard photos that should not be sold.
    - Pick featured collections and hero images that feel intentional.
    - Put travel/editorial/buyer-friendly sets first.

14. **Add buyer-facing offer clarity.**
    - Explain full vs 6 MP vs 3 MP vs 1 MP in buyer terms.
    - Clarify personal, commercial, resale, and AI-training licensing.
    - Add concise FAQ/help copy for delivery, refunds, custom licensing, and contact.

15. **Add conversion analytics.**
    - Track privacy-conscious funnel events: collection view, search/filter, like, add to basket, checkout start, payment complete, download.
    - Store enough paid-order facts to report revenue by photo, collection, origin, and product format.
    - Keep Owner/local review activity out of buyer analytics.

16. **Improve public search and SEO.**
    - Add fuzzy search over title, keywords, places, and collections.
    - Add page titles, descriptions, Open Graph images, canonical URLs, sitemap, and structured data where useful.
    - Avoid exposing Owner-only metadata.

17. **Create more first-party campaign pages.**
    - Add focused pages for travel/editorial licensing, wall art, AI imagery, and country sets.
    - Keep Pinterest/social traffic on first-party pages with direct paths to galleries, liked, or basket.
    - Use real images and concise copy.

18. **Replace temporary `r2.dev` preview URL with a custom media domain.**
    - Attach a custom R2 domain such as `media.photosbyelie.com`.
    - Update `media-config.js`.
    - Retest GitHub Pages gallery/detail/basket/liked preview loading.

19. **Create private customer collections for Real Estate and Wedding/Events.**
    - Add password-locked collection pages for customer-delivered Real Estate Photos and Wedding/Events Photos.
    - Keep private collection access separate from public country/AI galleries and search.
    - Decide where passwords and access metadata live, ideally Worker/D1 or another server-side store rather than public static files.
    - Preserve buyer-facing commerce paths where appropriate while preventing unauthenticated preview or asset discovery.

20. **Extend Owner operations dashboard.**
    - Surface catalog counts, private delivery coverage, discarded tombstones, Waste Basket state, active sweep status, and latest automation result.
    - Keep destructive R2 actions legible and confirmable.
    - Show progress in terms of actual deletion/repair counts.

21. **Add Owner state-table browser.**
    - Browse public/Owner state tables in a localhost-only UI.
    - Support table switching, filters, quick search, sorting, row counts, and copy/export.
    - Add photo-aware jumps to public detail, Owner detail, collection, and R2 keys.

22. **Make country collections open-ended.**
    - Stop treating countries as a fixed list.
    - Let Owner create new countries from Unknown assignment with `Other...`.
    - Generate collection metadata, slug, translations, route data, and homepage entries safely.

23. **Add gallery multi-select Owner metadata edits.**
    - Support shift range and command toggles.
    - Batch-add keywords without replacing existing keywords.
    - Design batch title behavior carefully before implementation.
    - Persist through manifest/DB Owner metadata paths without rewriting media files.

24. **Harden Owner identity and naming.**
    - Keep localhost helper boundaries for now.
    - Decide whether production Owner needs Cloudflare Access or Worker-backed login.
    - Rename auth-like files if they are really helper-availability checks.

25. **Add frontend smoke tests for buyer paths.**
    - Cover search/filter, detail open, like, add to basket, basket view, checkout draft, and embedded-browser escape.
    - Include mobile header behavior for gallery, detail, liked, and basket.

26. **Keep repo/media cleanup deliberate.**
    - Do not use GitHub as a media vault.
    - Keep source metadata edits non-destructive.
    - Keep root HTML while GitHub Pages serves from repo root.
    - Revisit bundling/minification and folder structure only after payment/media paths stabilize.
