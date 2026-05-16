# Photos By Elie Backlog

Last updated: 2026-05-16

## Current Facts

- Current visible build: `v77.1`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Public catalog count: `5,827` active media rows.
- Public collection counts: France `289`, USA `151`, Spain `223`, Mexico `2`, AI `4,920`, Italy `24`, Portugal `216`, Slovakia `2`.
- Public catalog currently serves through TSV compatibility files under `assets/catalog/`, with a tracked compact SQLite catalog at `assets/catalog/photosbyelie.sqlite`.
- Local Owner workflow state is moving toward ignored `assets/owner-actions/Owner.sqlite`.
- Public previews are R2-backed and watermarked.
- Private sellable assets are R2-backed and unwatermarked.
- Waste Basket/discard tombstones are durable. A banned photo stays banned.
- The public catalog validator now rejects discarded/tombstoned ids in public catalog data and `assets/expo-manifest.json`.
- Photos sell four digital delivery flavors: full, JPG 6 MP, JPG 3 MP, and JPG 1 MP.
- Videos use a `still_900` gallery poster, a `short_5s_720p` detail preview, and full-original buyer delivery only.
- Liked and Basket now use fixed commerce headers, so the liked/basket/checkout/language/theme buttons stay frozen on mobile scroll.
- `npm run validate` and `npm test` are mandatory before publishing public-site changes.

## Numbered Backlog

1. **Switch public runtime loading to SQLite.**
   - Load `assets/catalog/photosbyelie.sqlite` on public pages.
   - Keep TSV/JS exports as compatibility until gallery, detail, basket, liked, Worker, and homepage paths are converted.
   - Preserve GitHub Pages compatibility and cache behavior.

2. **Make SQLite generation fully canonical and repeatable.**
   - Keep `scripts/build_public_catalog_db.py` as the one-command public DB rebuild.
   - Validate counts, foreign keys, duplicate media ids, keyword id lists, and asset rows.
   - Add a clear publish step for rebuilding SQLite plus compatibility exports.

3. **Move Owner workflows into `Owner.sqlite`.**
   - Move title/keyword queue, proposals, decisions, country assignments, keyword blacklist, and settings into the local DB.
   - Export tracked compatibility JSON only where the current UI still requires it.
   - Keep `Owner.sqlite` ignored and local-only.

4. **Add a parked title/keyword state.**
   - Use parked for rejected rows where current tooling cannot create a good human title.
   - Do not count parked rows as accepted.
   - Do not let parked rows block new ordinary title/keyword proposal batches.
   - Preserve Owner reject comments and previous proposal context.

5. **Rework Owner review scoring/reporting.**
   - Report accepted/applied, submitted-unchecked, rejected/rework, and parked counts separately.
   - Double-check accepted rows from applied audit state, not only the latest batch file.
   - Make score calculations use local source-of-truth state without GitHub or remote calls.

6. **Complete title/keyword proposal quality fixes.**
   - Guarantee every selected row has a non-empty human-readable proposed title.
   - Replace numeric, date-time, filename-style, and keyword-dump titles.
   - Use visual/catalog/source context conservatively when specific subject context is uncertain.
   - For rows rejected with "use the hints in the keywords to provide a decent title", derive the next title from keywords plus reliable context.

7. **Finish video import hardening.**
   - Keep Apple Photos mixed-album import video-aware.
   - Keep face albums off limits.
   - Preserve the two-pass portable PNG watermark overlay path for ffmpeg builds without `drawtext`.
   - Keep explicit `-t 5` on the overlay pass so short previews cannot drift.

8. **Migrate R2 keys to the flat SQLite-era conventions.**
   - Copy/verify masters from `masters/<media_id>/<original_file>` to `masters/<media_id>.<format>`.
   - Copy/verify photo render triplets to `renders/<media_id>_1mp.jpg`, `_3mp.jpg`, and `_6mp.jpg`.
   - Keep old keys until Worker checkout/delivery and manifests use the new keys.
   - Delete old keys only after an audit confirms no runtime path needs them.

9. **Prove Stripe checkout in test mode.**
   - Configure Stripe test keys and webhook secret in the Worker environment.
   - Test successful payment, declined payment, 3D Secure/authentication, webhook replay, and amount mismatch.
   - Confirm paid orders expose per-file private downloads and unpaid orders do not.

10. **Make checkout/order storage production-durable.**
    - Choose D1 or KV for durable order records.
    - Store order id, buyer email, basket snapshot, amount, payment status, delivery keys, and download events.
    - Add buyer-facing order recovery before considering full buyer accounts.

11. **Move product/pricing data out of generated JS constants.**
    - Create a dedicated price-list data file shared by public basket and Worker validation.
    - Include camera-photo, AI-origin, and video tiers.
    - Keep video at flat `$20` now while preserving length-tier structure for later pricing.

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

19. **Extend Owner operations dashboard.**
    - Surface catalog counts, private delivery coverage, discarded tombstones, Waste Basket state, active sweep status, and latest automation result.
    - Keep destructive R2 actions legible and confirmable.
    - Show progress in terms of actual deletion/repair counts.

20. **Add Owner state-table browser.**
    - Browse public/Owner state tables in a localhost-only UI.
    - Support table switching, filters, quick search, sorting, row counts, and copy/export.
    - Add photo-aware jumps to public detail, Owner detail, collection, and R2 keys.

21. **Make country collections open-ended.**
    - Stop treating countries as a fixed list.
    - Let Owner create new countries from Unknown assignment with `Other...`.
    - Generate collection metadata, slug, translations, route data, and homepage entries safely.

22. **Add gallery multi-select Owner metadata edits.**
    - Support shift range and command toggles.
    - Batch-add keywords without replacing existing keywords.
    - Design batch title behavior carefully before implementation.
    - Persist through manifest/DB Owner metadata paths without rewriting media files.

23. **Harden Owner identity and naming.**
    - Keep localhost helper boundaries for now.
    - Decide whether production Owner needs Cloudflare Access or Worker-backed login.
    - Rename auth-like files if they are really helper-availability checks.

24. **Add frontend smoke tests for buyer paths.**
    - Cover search/filter, detail open, like, add to basket, basket view, checkout draft, and embedded-browser escape.
    - Include mobile header behavior for gallery, detail, liked, and basket.

25. **Keep repo/media cleanup deliberate.**
    - Do not use GitHub as a media vault.
    - Keep source metadata edits non-destructive.
    - Keep root HTML while GitHub Pages serves from repo root.
    - Revisit bundling/minification and folder structure only after payment/media paths stabilize.
