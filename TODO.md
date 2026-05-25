# Photos By Elie Backlog

Last updated: 2026-05-25

## Current Facts

- Current visible build: `v86.2`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: use the Dock launcher or the active helper port near 8000, currently `http://localhost:8000/owner.html?v=86.2`.
- Public slideshow music app: `https://ec92009.github.io/PhotosByElie/slideshow-music.html?v=86.2`.
- Current catalog scale: `6,664` public media rows in `assets/catalog/photosbyelie.sqlite`: AI/Leonardo `4,921`, France `315`, Italy `25`, Mexico `2`, Portugal `216`, Slovakia `2`, Spain `1,024`, USA `159`.
- The catalog baseline audit is complete. Compared with the earlier `6,016`-row checkpoint at `736fe76b`, the current catalog is `+648` rows overall: AI/Leonardo is unchanged at `4,921`; France is `+192`; Spain is `+466`; Italy is `25` instead of `35`; USA, Portugal, Mexico, and Slovakia are unchanged. The Italy `0` state was caused by missing Italy path/GPS hints, which left Florence, San Gimignano, and Pisa rows as `unknown` and therefore excluded from public export.
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
- The Owner Expo tab has a source pulldown before `Start Expo import`: remembered gallery folders from `Owner.sqlite`, `All` for fixed Expo source anchors, and `New...` opens the native folder chooser immediately. Import-log subfolders are no longer auto-discovered into the pulldown. Real Estate has its own source pulldown plus `RE import` button inside the Real Estate tab. Successful selected-folder imports are recorded back into the appropriate Owner source history.
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
- `v83.16` replaces import progress prose with a four-tile stats panel: photos found, processed before, processed this run, and time left.
- `v83.17` makes the stats panel restart-honest by counting only successful imports under Processed this run and surfacing failed attempts in the tile note.
- `v83.18` adds breathing room between the Owner tab strip buttons and the panel frame.
- `v83.19` renames Owner Imports to Expo, moves Expo before Real Estate, keeps Expo imports gallery-only, and gives Real Estate its own source pulldown plus `RE import` folder-picker flow inside the Real Estate tab.
- `v83.20` defaults the Real Estate source pulldown to the selected client's current source so `New...` remains an explicit choice.
- `v83.21` makes Processed this run count completed photo attempts, including failed attempts, so the tile remains stable while failures stay visible in the note.
- `v83.22` makes the Processed this run note include successful completions, runs sweep Python calls through the Pillow-capable interpreter, and preflights Pillow before queuing photos.
- `v83.23` makes discarded/Waste Basket source paths participate in import and export filtering, records source paths in new tombstones, and adds a read-only audit for source-path tombstone dodgers in current manifests/R2 state.
- `v83.24` stops the Expo source pulldown from mining import-log subfolders, restores the Green + 4-star eligibility gate only for Camera imports/exports, leaves AI imports tombstone-driven, and adds an R2 audit/delete pass for ineligible Camera rows.
- `v85.0` adds a public slideshow music mini-app with eleven original subdued Spanish-style guitar cues, each under two minutes, plus play/pause, seeking, MP3 links, and volume controls.
- `v86.0` adds ten more classical-guitar-leaning cues with more variety: tremolo studies, waltz, Phrygian lullaby, salon miniature, counterpoint, and nocturne.
- `v86.1` restores Italy rows to the public catalog by adding Florence/Firenze, Pisa, San Gimignano, and Tuscany country hints to import/export inference; generated SQLite, homepage, Expo manifest, and Worker catalog artifacts now agree on `6,664` active rows with Italy at `25`.
- `v86.2` adds ten original two-guitar Latin/world-fusion slideshow cues at 86-116 bpm, with separate rhythm and lead parts, for thirty-one total music app choices.
- Price and offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price change has been made from that draft yet.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is `v86.2`; this file remains the numbered backlog source of truth.
- New import/re-export rule requested by Owner: the durable import anchor should be the full source pathname plus the source modified date. If only the modified date changes for the same source path, the new render should overwrite the older stored forms instead of creating a duplicate media row.
- Italy audit detail: the 25 restored rows come from `2025 Florence`, `2025 San Gimignano`, and `2025 Pisa`. The 10 Italy rows present in the old `736fe76b` baseline but absent now came from the phone-export folder `Pisa, 12 May 2025`; do not bulk-import that folder until same-path overwrite/de-dupe is implemented, because a selected-root subfolder import can derive duplicate IDs.
- Current source-path tombstone audit found `0` manifest dodgers and `0` current R2 dodgers from `4,699` discarded IDs and `301` recovered discarded source paths. Current Camera eligibility audit found `10` ineligible raw import-cache rows and `0` current R2 objects after cleanup.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest, with 5-10 watermarked public images for Facebook/Instagram and exactly 5 for Pinterest because Pinterest accepts only 5 photos at a time. It publishes only when existing authentication allows it and otherwise leaves ready-to-publish packages.
- The 2026-05-24 Facebook, Instagram, and Pinterest daily package is prepared only; each platform still needs final manual publish/account confirmation.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, browser checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Finish source re-export de-duplication and clean today's duplicates.**
   - Use full source pathname plus modified date as the import anchor.
   - If the same source path is re-exported with a newer modified date, overwrite the prior generated master, public previews, and private JPG triplets instead of creating a second photo identity.
   - The Italy audit proved the failure mode: importing a selected subfolder can derive fresh IDs for already-known source files. Fix the anchor first, then audit today's imports and prepare a reversible duplicate cleanup plan before deleting anything.
   - Import/export already filters known tombstoned source paths; the remaining work is overwriting same-path newer re-exports instead of allocating fresh IDs.

2. **Add import source history management.**
   - Let Owner remove missing or stale remembered folders, optionally pin favorites, and inspect the last-used time/source path before starting a run.
   - Include a one-time review of any legacy entries saved before `v83.24`, because log-discovered folders are no longer added automatically but older remembered rows may still exist locally.
   - Keep `Owner.sqlite` authoritative; do not introduce another JSON state file.

3. **Make the Real Estate import control unmistakable and run a full RE rehearsal.**
   - Keep the import control inside the Real Estate tab, near the RE source selector, with the same remembered-source and `New...` folder-picker behavior as Expo.
   - Pick one client folder on Saturn, use discovered properties, import previews, publish context, run upload dry-run, and prepare the Worker secret.
   - Check local and public review URLs before any real upload.

4. **Preflight import dependencies before starting photo work.**
   - Check Pillow, `exiftool`, `ffmpeg`/`ffprobe`, R2 upload configuration, and source readability before queuing photos.
   - Surface one actionable Owner status instead of letting missing dependencies create per-photo failure storms.
   - Show stopped/skipped imports separately from true task failures so manual stops are less alarming.

5. **Review and tune buyer support/refund wording.**
   - `v83.3` has conservative defaults; owner should approve or adjust commercial-use, delivery-refresh, and refund language before heavier launch traffic.
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current refund/support policy draft before editing public copy.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

6. **Approve and deploy the real price and offer strategy.**
   - Review `docs/commerce/PRICE_OFFER_STRATEGY.md`, especially the proposed `$3 / $8 / $28 / $65` camera ladder and lower AI ladder.
   - After approval, update `assets/catalog/product-pricing.json`, regenerate catalog/Worker artifacts, bump the visible version, deploy the Worker, and run one low-value live proof purchase.
   - Defer bundles, collection packs, buy-all-liked, and promo-code hooks until single-photo launch behavior is proven.

7. **Curate the first sellable storefront.**
   - Apply strong title/keyword approvals, block unsellable rows, pick featured collections, and put the strongest commercial sets first.

8. **Add conversion analytics.**
   - Track privacy-conscious browsing, basket, checkout, payment, and download events while excluding localhost Owner activity.

9. **Improve public discovery and SEO.**
   - `robots.txt` and `sitemap.xml` are in place.
   - Add fuzzy search, richer page metadata, Open Graph images, canonical URLs, structured data, and per-campaign/per-gallery metadata without Owner-only metadata.

10. **Create marketing landing pages and launch outreach.**
   - Daily social-post automation is active; the 2026-05-23 Facebook Page post is published and verified, while Instagram and Pinterest still need final publish confirmation.
   - Build first-party campaign pages for strongest collections and prepare social/Pinterest/launch destinations that escape embedded browsers before checkout.

11. **Owner decision pass for the current title/keyword queue.**
   - Open `owner-review.html?view=title-keywords` locally and review the active proposed rows, starting with batch `2026-05-24-000237-818Z`.
   - Pay special attention to the `84` rejected rows waiting for the next rework path and the `62` parked rows that need owner context.

12. **Verify Owner-private artifact separation after deploy.**
   - Confirm public GitHub Pages no longer serves title/keyword batch or approval JSON.
   - Keep `Owner.sqlite` as the durable source of truth; treat title/keyword JSON as compatibility/audit output, not public source of truth.

13. **Run the next generator pass after the current batch is resolved.**
   - Use the improved local keyword floor, larger subprocess buffer, and batch-summary preservation fix.
   - Compare keyword-target misses, `source_context`, and `needs_owner_context` counts against `2026-05-24-000237-818Z`.

14. **Escalate thin ordinary title/keyword rows to stronger context.**
   - Use vision/model passes for photos where source path and existing keywords are too thin.
   - Keep conservative titles and mark uncertainty instead of inventing landmarks.

15. **Polish Real Estate production outputs and access.**
   - Move final PDF/slideshow assembly to cloud/server-side execution using saved manifests.
   - Add optional background music for Real Estate video outputs, with client-safe defaults and an easy off switch.
   - Add Ken Burns-style pan/zoom motion for slideshow outputs so still-photo presentations feel alive without manual video editing.
   - Choose Worker/D1, Cloudflare Access, or another server-side gate for client auth.

16. **Harden hidden/discarded lifecycle.**
   - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
   - Avoid publishing partial hidden/discarded state.

17. **Add Owner state-table browsing.**
   - Browse public and Owner SQLite tables in a localhost-only UI with filters, sort, copy/export, and photo-aware jumps.

18. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
   - Attach a media domain, update `media-config.js`, and retest public and Real Estate preview loading.

19. **Parameterize gallery routes and split gallery/catalog data by collection.**
   - Reduce first-load catalog weight only after measuring current SQLite fetch/decode and gallery scan costs.

20. **Improve gallery merchandising layout.**
   - Add curated collection ordering, stronger visual entry points, and buyer-friendly browse paths.

21. **Add frontend smoke tests for buyer and client paths.**
   - Cover search/filter, detail, like, basket, checkout draft, Real Estate login, selection, PDF/slideshow draft, originals ZIP, and mobile controls.

22. **Keep physical products behind Owner review.**
   - Re-enable print/frame products only after samples, fulfillment, pricing, shipping, refunds, and support are settled.

23. **Keep repo and media cleanup deliberate.**
   - Do not use GitHub as a media vault. Keep root HTML while GitHub Pages serves from repo root.
