# Photos By Elie Backlog

Last updated: 2026-05-24

## Current Facts

- Current visible build: `v83.10`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: use the Dock launcher or the active helper port near 8000, currently `http://localhost:8001/owner.html?v=83.10`.
- Current catalog scale: `6,016` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Latest handoff sweep published Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, and durable discarded-photo tombstones.
- Public catalog loading and rebuilds use plain `assets/catalog/photosbyelie.sqlite`; Brotli `.sqlite.br` is legacy-only and not part of normal operations.
- A normalized SQL-shaped JSON catalog may be viable later, but only after measuring whether SQLite decode/rebuild costs are actually material.
- Title/keyword review state is SQLite-backed in tracked durable `assets/owner-actions/Owner.sqlite`; WAL/SHM sidecars stay ignored/local.
- Title/keyword batch/review JSON under `assets/owner-actions/title-keyword-review-queue/` is compatibility/audit output. New JSON is ignored by default; tracked snapshots are not authoritative public catalog state.
- Latest generated title/keyword review batch: `2026-05-24-000237-818Z`.
- Current Owner title/keyword queue states: applied `1776`, approved `20`, proposed `214`, rejected `84`, blocked `210`, parked `62`.
- `Owner.sqlite` table counts: title batches `19`, queue `2366`, proposals `3318`, decisions `3094`, R2 objects `32788`, country assignments `1553`, keyword blacklist `40`.
- Batch `2026-05-20-181058-181Z` had `100` weak local-rule proposals and all `100` were rejected for rework; replacement batch `2026-05-20-185753-222Z` has `200` proposals: `100` Codex-backed rework rows, `100` ordinary local rows, `0` model blockers, `0` keyword-target misses, and `74` `needs_owner_context` rows.
- Batch `2026-05-24-000237-818Z` is the latest generated review snapshot: `101` batch rows in `title_keyword_batches`, `101` currently proposed queue rows, and tracked `latest.json`/batch JSON compatibility snapshots.
- The generator now uses a larger Owner-state subprocess buffer, filters internal marker keywords like `NotMyPhoto`, expands safe local keyword floors, and reports proposal quality counts before write/import.
- Real Estate owner clients can save/edit/delete, discover media-bearing property folders, import available configured properties with count/total progress, publish sanitized contexts, dry-run/upload R2 objects, and prepare the Worker secret payload.
- Start Import opens a local folder chooser and scans only the selected folder. The automation sweep can still scan the fixed anchors: Camera, Apple Photos, Leonardo, and Real Estate. It must not treat clean catalog coverage as proof that no new source files exist, and changed source files must re-render/re-upload even when their R2 keys already exist.
- Import source lanes share the same Owner matrix/progress renderer. Skipped source lanes are unfinished, and a blocked catalog export is shown as the needs-attention phase rather than as silent downstream waiting.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Stripe sandbox checkout is proven end to end: successful card, declined-card behavior, 3D Secure, verified webhook, order recovery, per-file download, and download-all were manually checked.
- Live Stripe account `acct_1TWCksPuO9o6fOp6` has branding saved, successful-payment customer receipts enabled, and live webhook destination `we_1TZmoVPuO9o6fOp6JkBENiyV` named `PhotosByElie Worker checkout`, posting `checkout.session.completed` to the deployed Worker.
- Live Checkout card statement descriptor suffix is `DOWNLOAD`, producing `PHOTOSELIE* DOWNLOAD` with the current Stripe descriptor prefix.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git; secret values must never be committed or written into docs.
- Live checkout proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming after Stripe fees, Worker order `ready`, and one private JPEG download verified.
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo, adds buyer trust notes to basket/order, and adds `support.html` for payment, delivery, recovery, license, and support expectations.
- `v83.4` promotes the first Facebook Page feature in the homepage Featured section alongside Pinterest features.
- `v83.6` adds localhost-only POD supplier readiness, quality-tier routing, supplier option, and catalog schema preview panels in Owner Commerce while keeping public print checkout gated off.
- `v83.7` lets the Owner import flow choose a local source folder instead of depending only on fixed source anchors.
- `v83.8` removes three newly discarded Museo Ruso Malaga photos from buyer-facing catalog/homepage state and keeps durable deletion tombstones for their R2 keys.
- `v83.9` keeps selected-folder imports focused on import phases, avoids banned-photo cleanup noise in that path, caches import thumbnails, and gives the per-photo import matrix visible working states.
- `v83.10` makes the active/next import matrix state visible: an inferred active worker row turns blue, the next queued row animates, and unchecked cells show a live dot instead of static beige boxes.
- Price and offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price change has been made from that draft yet.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is `v83.10`; this file remains the numbered backlog source of truth.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest with 5-10 watermarked public images per post, publishing only when existing authentication allows it and otherwise leaving ready-to-publish packages.
- The 2026-05-24 Facebook, Instagram, and Pinterest daily package is prepared only; each platform still needs final manual publish/account confirmation.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, browser checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Make the Owner progress stack truthful and action-based.**
   - Goal: stop showing a long, dead-looking stack of every possible sweep phase when only one import or maintenance task is actually happening.
   - Inputs/assumptions: selected-folder imports, broad automation sweeps, banned-photo/R2 cleanup, catalog export, validation, and storage checks are related operational tools but should not all look queued during a simple import.
   - Scope: show progress bars only for phases that are currently running, actually queued, recently finished, blocked, or explicitly selected for the current task.
   - Add separate buttons for unrelated cleanup/maintenance tasks, such as banned-photo R2 cleanup double-check, final cleanup sweep, storage estimate refresh, catalog/export validation, or any other task that should not imply it is part of the current import.
   - Deliverables: a clearer Imports/Cloud task launcher, truthful current/queued task stack, explicit maintenance buttons, and copy that distinguishes import work from optional cleanup work.
   - Validation/definition of done: starting a selected-folder import shows only selected-folder import work plus real downstream blockers; unrelated cleanup phases stay hidden until started; maintenance buttons start their own visibly separate tasks; skipped or interrupted work is shown as blocked/unfinished without implying all later phases are waiting.

2. **Add an Owner import source menu.**
   - Goal: replace the immediate `Start Import` action with a pulldown that makes the import source explicit before work begins.
   - Inputs/assumptions: `Start Import` currently opens a native folder chooser for a selected-folder import; automation sweeps can still run the broad fixed-anchor path.
   - Scope: list every remembered imported source folder, include `All` for broad source sweep, include `New...` for native folder selection, and record successful source roots durably in `Owner.sqlite`.
   - Deliverables: Owner UI pulldown, helper endpoint/storage for remembered roots, clear path labels for folders with similar names, tests/syntax checks, and browser verification on `owner.html?tab=imports`.
   - Validation/definition of done: existing selected-folder import still works, `All` triggers the broad automation-style sweep, `New...` records the chosen folder after a successful start, remembered folders persist across reloads, and the import matrix keeps the `v83.10` visible progress behavior.
   - Decisions still needed: whether remembered folders should be removable from the menu immediately or handled later through state-table browsing.

3. **Review and tune buyer support/refund wording.**
   - `v83.3` has conservative defaults; owner should approve or adjust commercial-use, delivery-refresh, and refund language before heavier launch traffic.
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current refund/support policy draft before editing public copy.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

4. **Approve and deploy the real price and offer strategy.**
   - Review `docs/commerce/PRICE_OFFER_STRATEGY.md`, especially the proposed `$3 / $8 / $28 / $65` camera ladder and lower AI ladder.
   - After approval, update `assets/catalog/product-pricing.json`, regenerate catalog/Worker artifacts, bump the visible version, deploy the Worker, and run one low-value live proof purchase.
   - Defer bundles, collection packs, buy-all-liked, and promo-code hooks until single-photo launch behavior is proven.

5. **Curate the first sellable storefront.**
   - Apply strong title/keyword approvals, block unsellable rows, pick featured collections, and put the strongest commercial sets first.

6. **Add conversion analytics.**
   - Track privacy-conscious browsing, basket, checkout, payment, and download events while excluding localhost Owner activity.

7. **Improve public discovery and SEO.**
   - `robots.txt` and `sitemap.xml` are in place.
   - Add fuzzy search, richer page metadata, Open Graph images, canonical URLs, structured data, and per-campaign/per-gallery metadata without Owner-only metadata.

8. **Create marketing landing pages and launch outreach.**
   - Daily social-post automation is active; the 2026-05-23 Facebook Page post is published and verified, while Instagram and Pinterest still need final publish confirmation.
   - Build first-party campaign pages for strongest collections and prepare social/Pinterest/launch destinations that escape embedded browsers before checkout.

9. **Owner decision pass for the current title/keyword queue.**
   - Open `owner-review.html?view=title-keywords` locally and review the active proposed rows, starting with batch `2026-05-24-000237-818Z`.
   - Pay special attention to the `84` rejected rows waiting for the next rework path and the `62` parked rows that need owner context.

10. **Verify Owner-private artifact separation after deploy.**
   - Confirm public GitHub Pages no longer serves title/keyword batch or approval JSON.
   - Keep `Owner.sqlite` as the durable source of truth; treat title/keyword JSON as compatibility/audit output, not public source of truth.

11. **Run the next generator pass after the current batch is resolved.**
   - Use the improved local keyword floor, larger subprocess buffer, and batch-summary preservation fix.
   - Compare keyword-target misses, `source_context`, and `needs_owner_context` counts against `2026-05-24-000237-818Z`.

12. **Escalate thin ordinary title/keyword rows to stronger context.**
   - Use vision/model passes for photos where source path and existing keywords are too thin.
   - Keep conservative titles and mark uncertainty instead of inventing landmarks.

13. **Run a full Real Estate client lifecycle rehearsal.**
   - Pick one client folder on Saturn, use discovered properties, import previews, publish context, run upload dry-run, and prepare the Worker secret.
   - Check local and public review URLs before any real upload.

14. **Polish Real Estate production outputs and access.**
   - Move final PDF/slideshow assembly to cloud/server-side execution using saved manifests.
   - Choose Worker/D1, Cloudflare Access, or another server-side gate for client auth.

15. **Harden hidden/discarded lifecycle.**
   - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
   - Avoid publishing partial hidden/discarded state.

16. **Add Owner state-table browsing.**
   - Browse public and Owner SQLite tables in a localhost-only UI with filters, sort, copy/export, and photo-aware jumps.

17. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
   - Attach a media domain, update `media-config.js`, and retest public and Real Estate preview loading.

18. **Parameterize gallery routes and split gallery/catalog data by collection.**
   - Reduce first-load catalog weight only after measuring current SQLite fetch/decode and gallery scan costs.

19. **Improve gallery merchandising layout.**
   - Add curated collection ordering, stronger visual entry points, and buyer-friendly browse paths.

20. **Add frontend smoke tests for buyer and client paths.**
   - Cover search/filter, detail, like, basket, checkout draft, Real Estate login, selection, PDF/slideshow draft, originals ZIP, and mobile controls.

21. **Keep physical products behind Owner review.**
   - Re-enable print/frame products only after samples, fulfillment, pricing, shipping, refunds, and support are settled.

22. **Keep repo and media cleanup deliberate.**
   - Do not use GitHub as a media vault. Keep root HTML while GitHub Pages serves from repo root.
