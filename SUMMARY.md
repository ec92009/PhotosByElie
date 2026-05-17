# Conversation Summary

Date: 2026-05-16

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Current visible build: `v78.2`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local preview: `http://localhost:8000/`
- Public catalog attempts `assets/catalog/photosbyelie.sqlite.br` first when it is served as decoded SQLite by the host/CDN or browser raw Brotli decoding is available, with plain SQLite as the guaranteed fallback.
- Product/pricing data starts in `assets/catalog/product-pricing.json` as generator input and is materialized into public SQLite product tables at runtime.
- Owner-only workflow state now writes to the local ignored SQLite target at `assets/owner-actions/Owner.sqlite`, with JSON compatibility exports where the current UI still needs them.
- Public preview media and private delivery media live in Cloudflare R2, not Git.
- R2 private delivery has moved to the flat SQLite-era key convention for the active runtime:
  - masters target `masters/<media_id>.<format>`
  - photo render targets `renders/<media_id>_6mp.jpg`, `_3mp.jpg`, and `_1mp.jpg`
  - old nested master/render keys are still retained and Worker delivery can fall back to them during the cleanup window.
- Latest live R2 inventory after migration: `5,801 / 5,827` catalog photos have private masters and `5,799 / 5,827` have complete private render triplets. Remaining audit gaps are `26` masters, `6` target render keys, and `10` public previews.
- Recent pushed commits before the SQLite runtime migration:
  - `95c5a07f photosbyelie: keep commerce header controls fixed`
  - `ef744dde photosbyelie: remove discarded previews from catalog`
  - `bd40b229 photosbyelie: compact public catalog sqlite`
  - `0ff44c75 photosbyelie: apply owner review fixes`
  - `21387907 photosbyelie: remove stale photo-only media assumptions`
  - `b657fff3 photosbyelie: add video-aware album import`

## Source Of Truth Direction

We identified a major weakness in the current storage/retrieval approach: several JSON, generated JS, and manifest files can all appear authoritative at once.

Accepted direction:

- `photosbyelie.sqlite`: public/deployable catalog truth.
- `Owner.sqlite`: local/private Owner workflow truth.
- JSON compatibility exports remain until the browser, Worker, and Owner tools move fully to database-backed paths.

The public catalog keeps `media_id` as the stable text identity because it drives URLs and R2 key conventions. Controlled values use short integer lookup ids. `media_items.keyword_ids` stores a comma-separated list of keyword integers.

Current public SQLite tables:

```text
collections
cameras
lenses
media_types
source_origins
formats
asset_types
keyword_terms
media_items
media_assets
price_tiers
products
product_prices
frame_options
frame_prices
shipping_handling_prices
video_price_tiers
```

Current public SQLite counts:

```text
collections:     8
cameras:         12
lenses:          18
media_types:     2
source_origins:  2
formats:         6
asset_types:     7
keyword_terms:   3,112
media_items:     5,827
media_assets:    34,962
price_tiers:     2
products:        8
product_prices:  8
frame_options:   3
frame_prices:    8
shipping_prices: 4
video_tiers:     5
```

Current public collection counts:

```text
France:    289
USA:       151
Spain:     223
Mexico:    2
AI:        4,920
Italy:     24
Portugal:  216
Slovakia:  2
Total:     5,827
```

## Owner State Direction

The first SQLite migration pass is now in place:

- `catalog-sqlite.js` decodes the public SQLite catalog in the browser and reconstructs the existing `window.photosByElieData` contract.
- `photos-data.js` loads Brotli-compressed SQLite asynchronously first and falls back to plain SQLite if needed.
- `scripts/write_catalog_tsv.cjs` is now only a legacy-named compatibility wrapper; it refreshes the SQLite bootstrap, `assets/catalog/photosbyelie.sqlite`, and `assets/catalog/photosbyelie.sqlite.br` together.
- `scripts/build_public_catalog_db.py` validates duplicate media ids, keyword ids, required asset rows, foreign keys, and SQLite integrity.
- `scripts/owner_state_db.py` now targets `assets/owner-actions/Owner.sqlite` and imports/writes keyword blacklist, country assignments, title/keyword batches, queue rows, proposals, and decisions.
- Title/keyword queue generation syncs `Owner.sqlite` after writing compatibility JSON.

Current Owner title/keyword score from local DB:

```text
accepted/applied:    120
submitted-unchecked: 210
rejected/rework:     323
parked:              0
blocked:             9
```

The local Owner DB is for private workflows that should not travel with the public site:

```text
owner_settings
keyword_blacklist
country_assignments
title_keyword_batches
title_keyword_queue
title_keyword_proposals
title_keyword_decisions
```

Owner title/keyword review needs explicit states for approved, rejected, pending/proposed, and parked. Parked is for rejected photos where current tooling cannot produce an acceptable title; parked rows should not block new proposal batches.

Approved title/keyword rows now apply approved metadata into generated catalog state and mark `Title_Keywords_Reviewed`. Rejected rows retain rework state. Empty approved titles are rejected rather than silently skipped.

## Media And Asset Model

Accepted asset types:

```text
still_900
still_1800
short_5s_720p
jpeg_1mp
jpeg_3mp
jpeg_6mp
full
```

Target R2 key conventions:

```text
still_900       -> expo/<media_id>_900.jpg
still_1800      -> expo/<media_id>_1800.jpg
short_5s_720p   -> expo/<media_id>_short_5s_720p.mp4
jpeg_1mp        -> renders/<media_id>_1mp.jpg
jpeg_3mp        -> renders/<media_id>_3mp.jpg
jpeg_6mp        -> renders/<media_id>_6mp.jpg
full            -> masters/<media_id>.<format extension>
```

For photos:

- gallery uses `still_900`;
- detail uses `still_1800`;
- buyer delivery can use 1 MP JPG, 3 MP JPG, 6 MP JPG, or full.

For videos:

- gallery uses `still_900`, generated around 10% into the source;
- detail uses `short_5s_720p`, a 5-second watermarked 720p clip;
- buyer delivery is the original/full asset only.

Videos are now first-class in the import model. The Cordoba Apple Photos album work established the video path. Face albums remain off limits.

## Product Pricing

Photo products, print/frame pricing, shipping/handling, and video tiers are no longer hand-authored in generated JS constants. `assets/catalog/product-pricing.json` feeds `scripts/build_public_catalog_db.py`, which materializes the public SQLite product tables. `catalog-sqlite.js` and Worker catalog generation both reconstruct the existing public globals from that shared price catalog. Videos use `video-original` buyer delivery at flat `$20` for now, with length-tier rows preserved for future pricing.

## R2 And Tombstone Rules

R2 has no atomic rename. Safe moves are copy, verify, record, then delete old keys only after code/manifests no longer need them.

Waste Basket/discarded photos are permanent tombstones unless explicitly put back before purge. A banned photo stays banned.

The public preview incident showed the consequence of alternate truth sources: 17 tombstoned photos were still in the public catalog after their R2 preview files had been deleted. The fix removed those 17 rows from public catalog state and added validation so discarded/tombstoned ids cannot leak into public catalog or `assets/expo-manifest.json` again.

## Public Site Fixes

- Public site is now `v78.2`.
- The USA gallery missing-preview issue is fixed by removing tombstoned catalog rows rather than re-uploading banned media.
- Liked and Basket pages now use the same fixed-header behavior as gallery/detail pages.
- Header action buttons for liked, basket, checkout, language, and theme stay frozen during mobile scroll.
- The Liked/Basket total band is fixed below the measured header height instead of relying on a hard-coded mobile offset.

## Verification

Recent verification:

```text
PRAGMA integrity_check: ok
catalog rows: 5,827
R2 complete-pair misses: 0
npm run validate: pass
npm test: pass, 16 tests
```

GitHub Pages was checked after deploy:

```text
VERSION: 77.1
liked.html body: class="commerce-page" data-fixed-header
basket.html body: class="commerce-page" data-fixed-header
photos.css: commerce fixed-header rules live
```

## Current Backlog Themes

The highest-value work is now:

1. Prove Stripe checkout in test mode.
2. Make checkout/order storage production-durable.
3. Keep physical products behind Owner review.
4. Curate the first sellable storefront.
5. Add buyer-facing offer clarity.
6. Replace temporary `r2.dev` preview URL with a custom media domain.
7. Keep curation focused on sellable catalog quality and launch readiness.
