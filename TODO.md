# Photos By Elie Backlog

Last updated: 2026-05-18

## Current Facts

- Current visible build: `v79.16`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Public catalog count: `904` active media rows.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Public pages attempt `assets/catalog/photosbyelie.sqlite.br` first where supported, with plain `assets/catalog/photosbyelie.sqlite` as the guaranteed fallback.
- Home and gallery search/filter/sort share the `photosByEliePhotoFilter` helpers. Filters include media type, date from/to, orientation, size/duration, color mood, subject, collection/origin where relevant, and sort.
- Video detail pages show duration when catalog metadata provides it. Video products remain full-original delivery only for mainline commerce.
- Real Estate client review supports mixed photo/video selection, editable titles, project assignment, drag ordering, A4/Letter PDF drafts, selection table save/load/share, slideshow-plan sharing, and selected-original ZIP delivery.
- Real Estate outputs are scoped one project at a time. A single media item may be assigned to multiple projects, but generated PDFs/slideshows should be separated per project.
- In Real Estate PDFs, videos become stills from 10% into the source video. In Real Estate slideshow plans, videos preserve source duration and still photos use the configured seconds-per-photo value.
- Local Owner workflow state writes to ignored `assets/owner-actions/Owner.sqlite` and ignored Real Estate client settings. Public contexts must stay sanitized.
- `npm run validate` and `npm test` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Prove Stripe checkout in test mode.**
   - Configure Stripe test keys and webhook secret in the Worker environment.
   - Test successful payment, declined payment, 3D Secure/authentication, webhook replay, and amount mismatch.
   - Confirm paid orders expose private download tokens and unpaid orders do not.

2. **Make checkout and order storage production-durable.**
   - Choose KV, D1, or a deliberate hybrid for order records.
   - Persist order id, buyer email, basket snapshot, totals, payment status, delivery keys, token events, and recovery facts.
   - Add buyer-facing order lookup/recovery before considering full buyer accounts.

3. **Add browser-side ZIP assembly for paid mainline delivery.**
   - Keep the Worker on per-file private tokens; do not make the Worker assemble large archives.
   - Add an order-page action that fetches ready purchased files and creates a single ZIP in the browser.
   - Use a streaming-capable ZIP path with stored entries for JPG/video assets.
   - Keep per-file downloads as fallback for embedded browsers, failed ZIP assembly, and large mobile orders.

4. **Move Real Estate output assembly to the cloud.**
   - Treat the saved selection manifest as the contract: client, project, media id, title, order, paper size, PDF treatment, and slideshow treatment.
   - Generate one PDF per project and one slideshow per project from that manifest.
   - Keep browser-generated PDFs/slideshow plans as a useful draft/fallback, not the final production path.

5. **Finish Real Estate slideshow generation.**
   - Still photos should use the configured seconds-per-photo duration.
   - Source videos should pass through untrimmed and keep their original duration.
   - Use a basic carousel transition and make output timing visible in the manifest/review UI.

6. **Harden Real Estate save/load/share flows.**
   - Keep native browser save/open/share behavior where available.
   - Make fallback Downloads behavior explicit in status text and help copy.
   - Ensure selection tables and legacy JSON load cleanly across desktop, phone, GitHub Pages, and localhost.

7. **Polish the Real Estate wide-screen selection workspace.**
   - Keep filters compact and sticky.
   - Preserve a strong preview grid while making selected media/order management easy.
   - Continue improving the right-side or draft-basket ordering model without hurting the phone workflow.

8. **Finish Owner-managed Real Estate lifecycle.**
   - Keep client config, property folder conventions, import, publish, upload, and Worker secret prep coherent.
   - Document the safe path from Saturn property folders to public context, public previews, private masters, and Worker access.
   - Keep ignored local credentials out of tracked assets.

9. **Decide the production Real Estate access model.**
   - Current public contexts use browser-side hashes and Worker secrets for originals.
   - Decide whether final client auth should move to Worker/D1, Cloudflare Access, or another server-side gate.
   - Keep static preview constraints explicit in the decision.

10. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
    - Attach a domain such as `media.photosbyelie.com`.
    - Update `media-config.js`.
    - Retest GitHub Pages gallery, detail, basket, liked, and Real Estate preview loading.

11. **Curate the first sellable storefront.**
    - Apply title/keyword approvals to the strongest catalog rows.
    - Block or discard photos that should not be sold.
    - Pick featured collections and hero images that feel intentional.

12. **Clarify the buyer offer.**
    - Explain full, 6 MP, 3 MP, and 1 MP downloads in buyer terms.
    - Clarify personal, commercial, resale, and AI-training licensing.
    - Add concise delivery, refund, custom-license, and contact help.

13. **Add conversion analytics.**
    - Track privacy-conscious funnel events: collection view, search/filter, like, add to basket, checkout start, payment complete, and download.
    - Report revenue by photo, collection, source origin, and product format.
    - Keep localhost Owner activity out of buyer analytics.

14. **Improve public discovery and SEO.**
    - Add fuzzy search over title, keywords, places, and collections.
    - Add page titles, descriptions, Open Graph images, canonical URLs, sitemap, and structured data where useful.
    - Avoid exposing Owner-only metadata.

15. **Create more first-party campaign pages.**
    - Add focused pages for travel/editorial licensing, wall art, AI imagery, and country sets.
    - Keep Pinterest/social traffic on first-party pages with direct paths to galleries, liked, or basket.
    - Use real images and concise copy.

16. **Extend the Owner operations dashboard.**
    - Surface catalog counts, private delivery coverage, discarded tombstones, Waste Basket state, active sweep status, and latest automation result.
    - Keep destructive R2 actions legible and confirmable.
    - Show repair/deletion progress as actual object counts.

17. **Add an Owner state-table browser.**
    - Browse public and Owner state tables in a localhost-only UI.
    - Support table switching, filters, quick search, sorting, row counts, and copy/export.
    - Add photo-aware jumps to public detail, Owner detail, collection, and R2 keys.

18. **Make country collections open-ended.**
    - Stop treating countries as a fixed list.
    - Let Owner create new countries from Unknown assignment with `Other...`.
    - Generate collection metadata, slug, translations, route data, and homepage entries safely.

19. **Add gallery multi-select Owner metadata edits.**
    - Support shift range and command toggles.
    - Batch-add keywords without replacing existing keywords.
    - Design batch title behavior carefully before implementation.

20. **Add frontend smoke tests for buyer and client paths.**
    - Cover search/filter, detail open, like, add to basket, checkout draft, and embedded-browser escape.
    - Cover Real Estate login, selection, save/load, PDF draft, slideshow plan, originals ZIP, and footer/action-bar clearance.
    - Include mobile header/action-bar behavior.

21. **Keep physical products behind Owner review.**
    - Keep print/frame products off publicly until samples and fulfillment rules are settled.
    - Compare POD vendors for US/EU quality, packaging, landed cost, API fit, and support.
    - Re-enable only after pricing, shipping, refunds, and customer support are clear.

22. **Keep repo and media cleanup deliberate.**
    - Do not use GitHub as a media vault.
    - Keep source metadata edits non-destructive.
    - Keep root HTML while GitHub Pages serves from repo root.
    - Revisit bundling/minification and folder structure only after payment/media paths stabilize.
