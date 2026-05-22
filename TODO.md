# Photos By Elie Backlog

Last updated: 2026-05-22

## Current Facts

- Current visible build: `v83.4`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: `http://localhost:8000/owner.html?v=83.4`.
- Current catalog scale: `6,019` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Latest handoff sweep published Owner-approved title/keyword metadata into the public SQLite catalog and Worker catalog without changing the active row count.
- Public catalog loading and rebuilds use plain `assets/catalog/photosbyelie.sqlite`; Brotli `.sqlite.br` is legacy-only and not part of normal operations.
- A normalized SQL-shaped JSON catalog may be viable later, but only after measuring whether SQLite decode/rebuild costs are actually material.
- Title/keyword review state is SQLite-backed in ignored local `assets/owner-actions/Owner.sqlite`.
- Title/keyword batch/review JSON under `assets/owner-actions/title-keyword-review-queue/` is ignored/local review-page and audit output. It is no longer tracked as deployable public metadata.
- Latest generated title/keyword review batch: `2026-05-20-185753-222Z`.
- Current Owner title/keyword counts: accepted `1076`, submitted-unchecked/proposed `418`, rejected `0`, blocked `27`, parked `62`.
- `Owner.sqlite` title/keyword table counts: batches `13`, queue `1583`, proposals `2359`, decisions `1931`.
- Batch `2026-05-20-181058-181Z` had `100` weak local-rule proposals and all `100` were rejected for rework; replacement batch `2026-05-20-185753-222Z` has `200` proposals: `100` Codex-backed rework rows, `100` ordinary local rows, `0` model blockers, `0` keyword-target misses, and `74` `needs_owner_context` rows.
- The generator now uses a larger Owner-state subprocess buffer, filters internal marker keywords like `NotMyPhoto`, expands safe local keyword floors, and reports proposal quality counts before write/import.
- Real Estate owner clients can save/edit/delete, discover media-bearing property folders, import available configured properties with count/total progress, publish sanitized contexts, dry-run/upload R2 objects, and prepare the Worker secret payload.
- Start Imports scans the full fixed import anchors every time: Camera, Apple Photos, Leonardo, and Real Estate. It must not treat clean catalog coverage as proof that no new source files exist, and changed source files must re-render/re-upload even when their R2 keys already exist.
- Import source lanes share the same Owner matrix/progress renderer. Skipped source lanes are unfinished, and a blocked catalog export is shown as the needs-attention phase rather than as silent downstream waiting.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Stripe sandbox checkout is proven end to end: successful card, declined-card behavior, 3D Secure, verified webhook, order recovery, per-file download, and download-all were manually checked.
- Live Stripe account `acct_1TWCksPuO9o6fOp6` has branding saved, successful-payment customer receipts enabled, and live webhook destination `we_1TZmoVPuO9o6fOp6JkBENiyV` posting `checkout.session.completed` to the deployed Worker.
- Live Checkout card statement descriptor suffix is `DOWNLOAD`, producing `PHOTOSELIE* DOWNLOAD` with the current Stripe descriptor prefix.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git; secret values must never be committed or written into docs.
- Live checkout proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming after Stripe fees, Worker order `ready`, and one private JPEG download verified.
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo, adds buyer trust notes to basket/order, and adds `support.html` for payment, delivery, recovery, license, and support expectations.
- `v83.4` promotes the first Facebook Page feature in the homepage Featured section alongside Pinterest features.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, browser checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Clean up the live webhook presentation.**
   - Optionally rename Stripe destination `we_1TZmoVPuO9o6fOp6JkBENiyV` from the generated name `charismatic-rhythm` to `PhotosByElie Worker checkout`.
   - Leave the endpoint, event, and API version untouched unless a live proof exposes a problem.

2. **Review and tune buyer support/refund wording.**
   - `v83.3` has conservative defaults; owner should approve or adjust commercial-use, delivery-refresh, and refund language before heavier launch traffic.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

3. **Publish a real price and offer strategy.**
   - Move local Owner prices into a published price list shared by public basket and Worker validation.
   - Decide launch bundles, collection packs, buy-all-liked, and promo-code hooks.

4. **Curate the first sellable storefront.**
   - Apply strong title/keyword approvals, block unsellable rows, pick featured collections, and put the strongest commercial sets first.

5. **Add conversion analytics.**
   - Track privacy-conscious browsing, basket, checkout, payment, and download events while excluding localhost Owner activity.

6. **Improve public discovery and SEO.**
   - Add fuzzy search, richer page metadata, Open Graph images, canonical URLs, sitemap, and structured data without Owner-only metadata.

7. **Create marketing landing pages and launch outreach.**
   - Build first-party campaign pages for strongest collections and prepare social/Pinterest/launch destinations that escape embedded browsers before checkout.

8. **Owner decision pass for batch `2026-05-20-185753-222Z`.**
   - Open `owner-review.html?view=title-keywords` locally and review the 200 pending proposals.
   - Pay special attention to the 74 `needs_owner_context` rows and the 100 Codex-backed rework rows from the rejected family-travel batch.

9. **Verify Owner-private artifact separation after deploy.**
   - Confirm public GitHub Pages no longer serves title/keyword batch or approval JSON.
   - Keep `Owner.sqlite` and generated review JSON local/ignored; use SQLite/helper output for localhost review.

10. **Run the next generator pass after the current batch is resolved.**
   - Use the improved local keyword floor, larger subprocess buffer, and batch-summary preservation fix.
   - Compare keyword-target misses, `source_context`, and `needs_owner_context` counts against `2026-05-20-185753-222Z`.

11. **Escalate thin ordinary title/keyword rows to stronger context.**
   - Use vision/model passes for photos where source path and existing keywords are too thin.
   - Keep conservative titles and mark uncertainty instead of inventing landmarks.

12. **Run a full Real Estate client lifecycle rehearsal.**
   - Pick one client folder on Saturn, use discovered properties, import previews, publish context, run upload dry-run, and prepare the Worker secret.
   - Check local and public review URLs before any real upload.

13. **Polish Real Estate production outputs and access.**
   - Move final PDF/slideshow assembly to cloud/server-side execution using saved manifests.
   - Choose Worker/D1, Cloudflare Access, or another server-side gate for client auth.

14. **Harden hidden/discarded lifecycle.**
   - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
   - Avoid publishing partial hidden/discarded state.

15. **Add Owner state-table browsing.**
   - Browse public and Owner SQLite tables in a localhost-only UI with filters, sort, copy/export, and photo-aware jumps.

16. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
   - Attach a media domain, update `media-config.js`, and retest public and Real Estate preview loading.

17. **Parameterize gallery routes and split gallery/catalog data by collection.**
   - Reduce first-load catalog weight only after measuring current SQLite fetch/decode and gallery scan costs.

18. **Improve gallery merchandising layout.**
   - Add curated collection ordering, stronger visual entry points, and buyer-friendly browse paths.

19. **Add frontend smoke tests for buyer and client paths.**
   - Cover search/filter, detail, like, basket, checkout draft, Real Estate login, selection, PDF/slideshow draft, originals ZIP, and mobile controls.

20. **Keep physical products behind Owner review.**
   - Re-enable print/frame products only after samples, fulfillment, pricing, shipping, refunds, and support are settled.

21. **Keep repo and media cleanup deliberate.**
   - Do not use GitHub as a media vault. Keep root HTML while GitHub Pages serves from repo root.
