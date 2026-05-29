# Photos By Elie Backlog

Last updated: 2026-05-29

## Current Facts

- Current visible build: `v90.6`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: use the Dock launcher or the active helper port near 8000, currently `http://localhost:8000/owner.html?v=90.6`.
- Public slideshow music app: `https://ec92009.github.io/PhotosByElie/slideshow-music.html?v=90.6`.
- Current catalog scale: `6,672` public media rows in `assets/catalog/photosbyelie.sqlite`: AI/Leonardo `4,921`, France `315`, Italy `33`, Mexico `2`, Portugal `216`, Slovakia `2`, Spain `1,024`, USA `159`.
- The catalog baseline audit is complete. Compared with the earlier `6,016`-row checkpoint at `736fe76b`, the current catalog is `+656` rows overall: AI/Leonardo is unchanged at `4,921`; France is `+192`; Spain is `+466`; Italy is `33` instead of `35` because two Italy rows were recently blocked; USA, Portugal, Mexico, and Slovakia are unchanged. The Italy `0` state was caused by missing Italy path/GPS hints, which left Florence, San Gimignano, and Pisa rows as `unknown` and therefore excluded from public export.
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
- `v86.3` adds ten original single-guitar slideshow cues at 80-90 bpm, using simpler consonant arpeggios for forty-one total music app choices.
- `v86.4` saves those ten single-guitar cues as the Real Estate slideshow music pool, picks one at random for each slideshow manifest, keeps generated music at 0 dB, lowers source video audio by 20 dB, and adds local proof-video generation with randomized Ken Burns motion.
- `v86.5` makes the Real Estate client landing page a produced-product shelf first, with Create new product plus View, Download, and Edit controls for PDF/video deliverables, and keeps output generation offering both view-now and download-file choices.
- `v86.6` improves Real Estate contrast/opacity, adds immediate output progress with ETA hints, and stores browser-generated PDF/video products on the client shelf for repeat view/download/edit flows.
- `v86.7` makes Real Estate PDF preview phone-safe by opening rendered pages in an HTML proof instead of a raw PDF blob, and saves the shelf product as soon as output generation starts.
- `v86.8` makes Real Estate slideshow sound recovery explicit on mobile, softens Ken Burns crop, and replays shelf PDFs directly from the saved product manifest.
- `v86.10` restores the ten older Pisa phone-export Italy rows under their original `2024 Pisa/Pisa, 12 May 2025` IDs, uploading public previews, private masters, and private JPG triplets; current Italy active count is `33` because two recently blocked Italy rows are excluded.
- `v88.2` makes the Real Estate client page a saved-product shelf first, persists current selections through the cloud deliverables/R2 shelf, uses editable YYMMDD-type sequence names, removes visible selection-file buttons, splits Stills/Videos/Albums/Selections in the hero stats, and puts editing into a separate detail flow with Back to shelf plus the five review steps.
- `v89.11` removes the metadata grid and selection table from the Real Estate browser video preview, leaving only the slideshow and controls, and makes preview music fade smoothly across the final slide before playback stops.
- `v89.12` anchors Real Estate browser video titles to the bottom of the actual photo, inside the watermarked image layer, instead of placing them on the blurred backdrop.
- `v89.13` centers those Real Estate browser video titles inside the watermarked photo, removes Previous/Next from the playback controls, and hardens the final-slide music fade before stopping.
- `v89.14` keeps HTML for Real Estate video preview only; download flows now produce true PDF files plus a browser-recorded video file, using MP4 where supported and WebM otherwise, with the same behavior on phone and desktop.
- `v89.15` splits Real Estate PDF and video downloads into separate controls again, starts preparing the browser-recorded video as soon as a selection/settings state is ready, and makes vertical video export use a phone-safe 9:16 MP4 path with fallback recording attempts.
- `v89.16` adds all 29 CC0 Wikimedia Commons Spanish-guitar clips to the public slideshow music gallery with MP3/source/license links and prepares Real Estate video export manifests/recording for a required music-credit end-card.
- `v89.17` removes CC0 slideshow music clips under 30 seconds, normalizes the remaining 20 CC0 clips, simplifies the music gallery to stars/play/position/delete, plays previews at 100%, and makes moving a position slider switch to that track.
- `v89.18` adds sixteen normalized Pixabay guitar candidates to the top of the public music gallery for iPhone auditioning and stores author/source/license/credit metadata for future video credits.
- `v89.19` expands the public music gallery to forty normalized Pixabay country candidates: Spain, Portugal, France, and USA, with phone-friendly country filters and stored author/source/license/credit metadata for future video credits.
- `v89.20` makes Real Estate video output use the country-tagged Pixabay music pool instead of the old original cue pool, routes public music playback through the Worker media route, and adds an Output-page music-country selector with Auto from project inference.
- `v89.21` moves the public slideshow music audition gallery onto the same Worker/R2 media route for Pixabay candidates while keeping localhost development on local MP3 files.
- `v89.22` makes the Worker media route support byte-range responses for public R2 music, fixing silent iPhone/Safari playback in the slideshow audition gallery and the shared Real Estate music path.
- `v90.0` fixes the remaining slideshow music audition silence by removing the unnecessary Web Audio gain graph and marking Worker-hosted audio elements as anonymous CORS media.
- `v90.1` releases the Real Estate video download UI as soon as the native share sheet opens, instead of waiting for the user to dismiss the OS panel.
- `v90.2` retries Real Estate video frame images through local blob URLs and 900px preview fallbacks when direct public R2 image loading fails during browser video recording.
- `v90.3` stores Real Estate help dismissal at the section level, while honoring older per-gallery dismissals, so the modal appears only on the first visit.
- `v90.4` saves the active Real Estate selection before starting PDF/video previews or downloads, and adds a visible Close preview button to the browser video preview.
- `v90.5` returns browser video previews to the Output step when close has to navigate, and removes the sticky bottom controls/footer from the mobile Output screen.
- `v90.6` keeps iPhone/Safari video export from sticking at the last recorded slide by finalizing recorder data with a stop-event watchdog.
- Price and offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price change has been made from that draft yet.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is `v90.6`; this file remains the numbered backlog source of truth.
- New import/re-export rule requested by Owner: the durable import anchor should be the full source pathname plus the source modified date. If only the modified date changes for the same source path, the new render should overwrite the older stored forms instead of creating a duplicate media row.
- Italy audit detail: the 25 first restored rows came from `2025 Florence`, `2025 San Gimignano`, and `2025 Pisa`. The 10 Italy rows from the older phone-export folder `Pisa, 12 May 2025` were restored in `v86.10` using their original `2024 Pisa/Pisa, 12 May 2025` relative paths and IDs. The broader same-path overwrite/de-dupe work remains open because arbitrary selected-root imports can still derive duplicate IDs.
- Current source-path tombstone audit found `0` manifest dodgers and `0` current R2 dodgers from `4,699` discarded IDs and `301` recovered discarded source paths. Current Camera eligibility audit found `10` ineligible raw import-cache rows and `0` current R2 objects after cleanup.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest, with 5-10 watermarked public images for Facebook/Instagram and exactly 5 for Pinterest because Pinterest accepts only 5 photos at a time. It now should prepare first-party springboard/campaign targets before posting, stage drag-ready `socials/{Platform}/YYYY-MM-DD/{theme-slug}/` upload trees, and publish only when existing authentication allows it.
- The 2026-05-25 package is prepared from public R2 previews only: Facebook `Albi River and Brick Cathedral` has 8 images, Instagram `Madrid Chapels and Courtyards` has 10 images, Pinterest `Northern Portugal Green Horizons` has exactly 5 images, and a 4-image Threads Madrid variant is staged. Threads onboarding was completed through the Instagram login and the first Threads test post was manually posted from Chrome, but no platform URL was captured.
- Today's social packages use broad gallery URLs because no focused public campaign pages were created in that run. The next public-site/social pass should create conservative first-party springboards before posting, then apply the versioning SOP and validation before using those URLs publicly.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, browser checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Move Real Estate PDF/video assembly fully cloud-side.**
   - Use the saved selection manifest as the job input and keep David/local browser out of the production path.
   - Return view and download URLs for PDF/video products, with originals/source-video audio still ducked under the generated guitar bed.
   - Persist job status and failure reasons so the shelf can show pending, ready, or needs-attention states.

2. **Run a full Real Estate client rehearsal.**
   - Pick one client/property set, import/publish/upload it, save a selection, generate PDF and video, reopen from the shelf on mobile, rename it, and delete a throwaway artifact.
   - Verify titles reach final PDF/video output, vertical photos are framed gently, downloads use browser-safe links, and Back to shelf works.

3. **Add shelf polish for Real Estate saved products.**
   - Add grouped shelf rows if one selection produces both PDF and video, without losing direct view/download/delete affordances in the detail page.
   - Consider a small status chip for selection/PDF/video and an explicit "saved in cloud" signal after R2 writes succeed.
   - Keep the first page focused on the shelf plus Create new selection.

4. **Create first-party social springboards and a latest-social shelf.**
   - Build focused campaign pages or homepage cards for the current social-package themes, including the 2026-05-27 packages.
   - Use only public catalog data and watermarked public previews.
   - Apply visible-site versioning, validation, commit, and push before using URLs in posts.

5. **Turn daily social automation into a full pre-post target builder.**
   - Before posting, choose or create the best first-party URL, then stage platform upload folders with images, captions, README, and manifest.
   - Keep Pinterest exactly five images; keep Facebook/Instagram at 5-10; derive Threads 3-4 image variants from Instagram when useful.
   - Record published URLs or explicit manual blockers in each package.

6. **Finish source re-export de-duplication and cleanup.**
   - Use full source pathname plus modified date as the import anchor.
   - Same-path newer exports should overwrite previous generated masters, public previews, and private JPG triplets instead of creating duplicates.
   - Audit duplicate candidates and prepare a reversible cleanup before deleting anything.

7. **Add import source history management.**
   - Let Owner remove missing or stale remembered folders, pin favorites, and inspect last-used path/time before starting a run.
   - Include a one-time review of legacy entries saved before `v83.24`.
   - Keep `Owner.sqlite` authoritative; do not add another JSON state source.

8. **Preflight import dependencies before photo work starts.**
   - Check Pillow, `exiftool`, `ffmpeg`/`ffprobe`, R2 upload configuration, and source readability before queuing photos.
   - Surface one actionable Owner status instead of per-photo failure storms.

9. **Review buyer support, refund, and license wording.**
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current policy draft.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

10. **Approve and deploy the real price and offer strategy.**
   - Review the proposed camera and AI price ladders.
   - After approval, update pricing, regenerate catalog/Worker artifacts, bump the visible version, deploy the Worker, and run one low-value live proof purchase.

11. **Curate the first sellable storefront.**
   - Apply strong title/keyword approvals, block unsellable rows, pick featured collections, and put the strongest commercial/travel/editorial sets first.

12. **Add conversion analytics.**
   - Track privacy-conscious browsing, basket, checkout, payment, and download events while excluding localhost Owner activity.

13. **Improve public discovery and SEO.**
   - Add fuzzy search, richer metadata, Open Graph images, canonical URLs, structured data, and per-campaign/per-gallery metadata without Owner-only details.

14. **Owner decision pass for the current title/keyword queue.**
   - Open `owner-review.html?view=title-keywords` locally and review the active proposed rows, starting with batch `2026-05-24-000237-818Z`.
   - Resolve rejected and parked rows before the next large generator pass.

15. **Verify Owner-private artifact separation after deploy.**
   - Confirm GitHub Pages does not serve private Owner review JSON or secrets.
   - Keep `Owner.sqlite` as durable state and treat review JSON as compatibility/audit output.

16. **Run the next title/keyword generator pass after review.**
   - Use the improved keyword floor, larger subprocess buffer, and batch-summary preservation.
   - Compare misses and context-needed counts against `2026-05-24-000237-818Z`.

17. **Harden hidden/discarded lifecycle.**
   - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
   - Avoid publishing partial hidden/discarded state.

18. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
   - Attach a media domain, update `media-config.js`, and retest public and Real Estate preview loading.

19. **Keep repo and media cleanup deliberate.**
   - Do not use GitHub as a media vault. Keep root HTML while GitHub Pages serves from repo root.
