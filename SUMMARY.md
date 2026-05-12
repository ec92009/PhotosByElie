# Conversation Summary

Date: 2026-05-11

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v72.2`
- Business direction has shifted from building infrastructure to making the site sell: payments, delivery trust, offer clarity, pricing, curation, analytics, SEO, landing pages, and launch outreach now lead the backlog.
- Public Expo catalog currently has `5,844` publishable photos: France `296`, USA `161`, Spain `223`, Mexico `2`, AI/Leonardo `4,920`, Italy `24`, Portugal `216`, Slovakia `2`.
- Blocked catalog state currently has `4,384` blocked photos. Discarded tombstones are currently empty.
- Public previews are watermarked and live in Cloudflare R2 under flat keys such as `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Public browsing now loads previews directly from the public R2 `r2.dev` endpoint: `https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev`.
- The checkout Worker is no longer in the public preview hot path; it should stay focused on checkout, order state, payment webhooks, ZIP creation, and delivery.

## Media And Import Contract

- Buyer deliverables are private and unwatermarked: developed masters under `masters/...`, JPG 1/3/6 MP renders under `renders/...`.
- Uploaded masters, private render triplets, and public previews are treated as immutable after upload. Owner title, keyword, and country edits update manifests/catalogs only.
- Normal exception: blocked/discarded cleanup may delete media while keeping tombstones.
- RAW/DNG/NEF files are not public-site or cloud-storage inputs; developed JPG/TIFF sources are the working input.
- Saturn is the upstream source for developed imports:
  - Camera: `/Volumes/Saturn/Pictures/LR/Camera`
  - Apple Photos album exports: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
  - Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- Apple Photos album imports use folder membership as the selection signal. Country can be inferred from album/folder names, but new countries should eventually flow through Unknown and Owner assignment.
- `tmp/import-cache` is the disposable import/render workspace. Confirmed-upload preview JPGs can be removed from local tmp after R2 upload.
- `assets/reserve` remains only as localhost compatibility data; it is not a product or long-term review state.
- A local SQLite inspection database can be built at `tmp/photo-state.sqlite` with `python3 scripts/build_photo_state_db.py`.

## Checkout And Revenue Track

- Checkout remains guest-first and USD-only.
- Real Stripe Checkout is wired in code, but live payment is blocked until Stripe account setup, Worker secrets, webhook registration, and test-mode verification are complete.
- The next serious revenue milestone is proving Stripe in test mode end to end: success, 3D Secure/authentication-required, declined card, verified webhook, private R2 ZIP build, order page download, and failure states.
- Delivery ZIPs are flat: files sit at the archive root beside `ORDER.txt`, with no per-photo subfolders.
- Physical print/frame products are off by default for buyers. Owner still has a deliberate localhost toggle for local review, but digital checkout should be proven first.
- Published default prices now distinguish camera-photo downloads from lower AI-origin downloads, and the Worker validates against first-class `sourceOrigin` rather than only the collection slug. A dedicated price-list data file is still a high-priority cleanup item.
- The offer still needs buyer-facing packaging: licensing language, resolution explanations, Full resolution meaning, AI-origin clarity, delivery expectations, refund/contact copy, bundles, and launch pricing.

## Product/UX Decisions Made

- Owner password protection was removed for localhost use; the local helper server is the gate for mutation endpoints.
- Owner tools remain English-only. Opening Owner forces English; pressing the Owner language button beeps instead of fake-switching languages.
- Hidden terminology was replaced by Blocked in the Owner/product language, though some file names remain historical.
- `X` and `H` are accepted as block shortcuts; `D` is the stronger discard action.
- Public pages have English/French/Spanish translation support.
- Gallery search exists by title/keyword.
- Gallery filters and detail metadata now expose camera vs AI origin, and the Owner dashboard has a Camera / AI split card for active catalog counts.
- Homepage first render uses tiny `home-data.js`, then downloads the full catalog in the background.
- Gallery density shortcuts exist: `g` makes thumbnails larger/less dense, `G` makes the grid denser.
- `Z` toggles fit/fill.
- Gallery pages have the `L` like shortcut.
- Basket and Liked pages share a more consistent row layout, bulk resolution toggles, and digital-only default product behavior.
- Owner title/keyword edits are manifest-only and should inform Worker deliverables through regenerated catalogs, not by rewriting JPEG metadata.
- `assets/owner-actions/keyword-blacklist.json` is the durable metadata-only keyword blacklist. Import/export generation should strip those keyword strings from catalog metadata and keyword indexes, while never using that list to filter photos or rewrite JPG/source metadata.
- The collection list now includes Italy from the Pisa import. Future country support should become open-ended rather than hard-coded.

## Automation And Operations

- Daily automation `photosbyelie-daily-cloud-media-sweep` runs the lock-guarded cloud media sweep through `zsh -lc` so shell credentials are available.
- The sweep wrapper uses `.review-logs/cloud-media-sweep.lock` to avoid concurrent uploaders.
- The R2 public bucket CORS policy is tracked in `docs/r2-public-cors.json`.
- Public media should eventually move from temporary `r2.dev` to a custom media domain such as `media.photosbyelie.com`.
- Local preview should use `python3 scripts/local_server.py 8000` for Owner/helper endpoints.

## Fresh Backlog

1. **Prove Stripe checkout in test mode.** Configure Stripe secrets/webhook, test success, 3D Secure, declined card, verified webhook, ZIP build, download, and failure states.
2. **Make checkout and delivery production-durable.** Choose D1 vs KV, store durable order state, rate-limit downloads, and make order/delivery copy trustworthy.
3. **Package the buyer offer clearly.** Clarify licensing, resolution labels, Full resolution, AI-origin handling, delivery expectations, refunds, and contact.
4. **Publish a real price and offer strategy.** Move generated-code price defaults into a dedicated price-list data file shared by public basket and Worker; add launch pricing, bundles, collection packs, and future promo hooks.
5. **Curate the first sellable storefront.** Pick strongest collections/images, block weak or unsuitable photos, and make the public catalog feel intentional.
6. **Add conversion analytics.** Track privacy-conscious funnel events from view to ZIP download and report top viewed/liked/sold photos.
7. **Improve public discovery and SEO.** Add page titles, descriptions, Open Graph, canonical URLs, sitemap, structured data, and search-friendly image metadata.
8. **Create marketing landing pages.** Build focused buyer pages for travel/editorial licensing, wall art, AI imagery, country sets, and the Photos By Elie brand.
9. **Prepare launch and sales outreach.** Draft launch email, buyer outreach note, social checklist, standout image set, and contact path.
10. **Replace temporary `r2.dev` media URL with a custom media domain.** Attach the domain, update `media-config.js`, and retest public media.
11. **Split gallery/catalog data by collection.** Load only the current collection catalog so galleries start faster.
12. **Improve gallery merchandising layout.** Use a deterministic Pinterest-style masonry layout for variable-height images.
13. **Add buyer account or order recovery only if needed.** Prefer email order lookup before full accounts.
14. **Decide when physical goods return.** Keep prints/frames off until digital checkout, fulfillment, shipping, support, and refunds are clear.
15. **Replace keyword removal with Owner keyword cleanup modal.** Move keyword cleanup to Owner page with counts, checkboxes, Done, Delete checked, and confirmation.
16. **Make country collections open-ended.** Let Unknown assignment create new country collections via `Other...` instead of relying on a fixed list.
17. **Add gallery multi-select Owner metadata edits.** Support Shift/Cmd selection, batch title behavior, and keyword adds across selected photos.
18. **Extend Owner operations dashboard.** Add Blocked sync/cleanup counters, refresh controls, latest sweep result, and guided ingest/classify/block/validate/publish flow.
19. **Harden owner identity and publish validation.** Clarify helper/auth naming, decide production Owner identity, and strengthen validation gates.
20. **Keep long-horizon media and repo cleanup on the backburner.** XMP sidecar save, videos, repo layout cleanup, and architecture artifacts wait until revenue path is steadier.

## Verification Snapshot

- Latest pushed commit before this docs refresh: `0c36738b photosbyelie: serve previews directly from R2`.
- Direct R2 preview loading was verified with CORS from localhost/GitHub Pages origins.
- `npm test` and `npm run validate` passed after the direct-R2 media switch.
- This summary refresh is documentation-only; no visible build bump is required.
