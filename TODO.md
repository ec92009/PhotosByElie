# Photos By Elie Backlog

Last updated: 2026-05-24

## Current Facts

- Current visible build: `v83.15`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: use the Dock launcher or the active helper port near 8000, currently `http://localhost:8000/owner.html?v=83.15`.
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
- The Owner Imports tab has a source pulldown before `Start import`: remembered folders from `Owner.sqlite`/recent import logs, `All` for fixed source anchors, and `New...` opens the native folder chooser immediately. Successful selected-folder imports are recorded back into `Owner.sqlite`.
- Import source lanes share the same Owner progress renderer. Skipped source lanes are unfinished, a blocked catalog export is shown as the needs-attention phase rather than as silent downstream waiting, idle/future sweep phases stay hidden until relevant, and per-photo progress is now one thumbnail/name row rather than step checkboxes.
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
- `v83.11` adds the Owner import source pulldown, remembered source storage/discovery, explicit maintenance buttons, and truthful task-scoped progress stacks.
- `v83.12` makes GUI/Dock-launched imports see Homebrew tools such as `exiftool`, `ffmpeg`, and `ffprobe` so selected-folder imports do not fail on a stripped Safari helper PATH.
- `v83.13` opens the native folder chooser as soon as Owner selects `New...` in the import source pulldown and simplifies per-photo import progress to one thumbnail/name row per photo.
- `v83.14` reconciles Owner import waiting counts against the visible processed/active/photo rows so failed rows do not inflate the queue.
- `v83.15` surfaces the already-current import count so Owner can see photos skipped before the current run, removes the noisy per-photo queue summary strip above import thumbnails, and runs import render/upload work with a half-CPU parallel worker pool by default.
- Price and offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price change has been made from that draft yet.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is `v83.15`; this file remains the numbered backlog source of truth.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest with 5-10 watermarked public images per post, publishing only when existing authentication allows it and otherwise leaving ready-to-publish packages.
- The 2026-05-24 Facebook, Instagram, and Pinterest daily package is prepared only; each platform still needs final manual publish/account confirmation.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, browser checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Add import source history management.**
   - Let Owner remove missing or stale remembered folders, optionally pin favorites, and inspect the last-used time/source path before starting a run.
   - Keep `Owner.sqlite` authoritative; do not introduce another JSON state file.

2. **Review and tune buyer support/refund wording.**
   - `v83.3` has conservative defaults; owner should approve or adjust commercial-use, delivery-refresh, and refund language before heavier launch traffic.
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current refund/support policy draft before editing public copy.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

3. **Approve and deploy the real price and offer strategy.**
   - Review `docs/commerce/PRICE_OFFER_STRATEGY.md`, especially the proposed `$3 / $8 / $28 / $65` camera ladder and lower AI ladder.
   - After approval, update `assets/catalog/product-pricing.json`, regenerate catalog/Worker artifacts, bump the visible version, deploy the Worker, and run one low-value live proof purchase.
   - Defer bundles, collection packs, buy-all-liked, and promo-code hooks until single-photo launch behavior is proven.

4. **Curate the first sellable storefront.**
   - Apply strong title/keyword approvals, block unsellable rows, pick featured collections, and put the strongest commercial sets first.

5. **Add conversion analytics.**
   - Track privacy-conscious browsing, basket, checkout, payment, and download events while excluding localhost Owner activity.

6. **Improve public discovery and SEO.**
   - `robots.txt` and `sitemap.xml` are in place.
   - Add fuzzy search, richer page metadata, Open Graph images, canonical URLs, structured data, and per-campaign/per-gallery metadata without Owner-only metadata.

7. **Create marketing landing pages and launch outreach.**
   - Daily social-post automation is active; the 2026-05-23 Facebook Page post is published and verified, while Instagram and Pinterest still need final publish confirmation.
   - Build first-party campaign pages for strongest collections and prepare social/Pinterest/launch destinations that escape embedded browsers before checkout.

8. **Owner decision pass for the current title/keyword queue.**
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
