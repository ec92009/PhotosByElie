# Conversation Summary

Date: 2026-05-16

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Current visible build: `v76.18`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local preview: `http://localhost:8000/`
- Public catalog currently still runs through TSV compatibility files, but the accepted direction is a committed SQLite catalog at `assets/catalog/photosbyelie.sqlite`.
- Owner-only workflow state should move into a local ignored SQLite database at `assets/owner-actions/Owner.sqlite`.
- `Owner.sqlite` is ignored by Git; public catalog SQLite is intended to be tracked.
- Public preview media and private delivery media live in Cloudflare R2, not in Git.

## SQLite Decision

We designed and populated two databases:

- `photosbyelie.sqlite`: public/deployable catalog truth.
- `Owner.sqlite`: local/private Owner workflow truth.

The public catalog has six core tables:

```text
collections
cameras
lenses
media_items
keywords
media_assets
```

The local Owner database has seven workflow tables:

```text
owner_settings
keyword_blacklist
country_assignments
title_keyword_batches
title_keyword_queue
title_keyword_proposals
title_keyword_decisions
```

The split is intentional. The public catalog answers "what is the site/catalog now?" Owner.sqlite answers "what is pending, rejected, parked, proposed, or locally reviewed?"

## Populated Size Snapshot

Main catalog database:

```text
raw SQLite:        18.28 MiB
gzip -9:            1.75 MiB
brotli -11:         0.84 MiB
current TSV gzip:   0.55 MiB
```

Owner database:

```text
Owner JSON set:    3.46 MiB
Owner.sqlite:      1.74 MiB
```

Main-page first-load estimate:

```text
current main page with TSV:      about 1.59 MiB
main page with SQLite catalog:   about 2.07 MiB
delta:                           about +495 KiB compressed
```

This was accepted as more than good enough. Later pages should reopen the catalog from browser cache rather than download it again.

## Data Findings

- Catalog import produced 5,844 `media_items`, all currently photos.
- The catalog keyword table has 85,560 rows and accounts for most of the SQLite catalog size.
- Owner import produced 662 title/keyword queue rows, 500 proposal rows, and 398 decision rows.
- 162 Owner queue rows refer to batch ids whose proposal details are no longer present in the current batch JSON files. This confirms the existing alternate-source-of-truth weakness.
- Older proposal batches contain empty proposed titles. Owner.sqlite was relaxed enough to preserve that historical bad state instead of pretending it never happened.

## Asset Model

The accepted future asset types are:

```text
still_900
still_1800
short_5s_720p
jpeg_1mp
jpeg_3mp
jpeg_6mp
full
```

Derived R2 keys:

```text
still_900       -> expo/<media_id>_900.jpg
still_1800      -> expo/<media_id>_1800.jpg
short_5s_720p   -> expo/<media_id>_short_5s_720p.mp4
jpeg_1mp        -> renders/<media_id>_1mp.jpg
jpeg_3mp        -> renders/<media_id>_3mp.jpg
jpeg_6mp        -> renders/<media_id>_6mp.jpg
full            -> masters/<media_id>.<original_format>
```

For photos:

- gallery uses `still_900`;
- detail uses `still_1800`;
- buyer delivery can use 1 MP JPG, 3 MP JPG, 6 MP JPG, or full.

For videos:

- gallery uses `still_900`, generated at 10% into the source;
- detail uses `short_5s_720p`, a 5-second watermarked 720p clip;
- buyer delivery is the original/full asset only.

The private photo render triplets (`jpg-1mp`, `jpg-3mp`, `jpg-6mp`) are still sellable deliverables. Current R2 keys are nested under `renders/<media_id>/<original-file>-jpg-{1,3,6}mp.jpg`; the target convention is the flatter `renders/<media_id>_{1,3,6}mp.jpg`. Keep old keys until checkout/delivery uses the new keys and a migration audit passes.

## R2 Migration

R2 has no atomic rename. The safe move is:

```text
CopyObject old_key -> new_key
HEAD/verify new_key
record success
delete old_key only after code and manifests no longer need it
```

Phase 1 should copy private masters from:

```text
masters/<media_id>/<original_file>
```

to:

```text
masters/<media_id>.<original_format>
```

and keep old keys temporarily. Public preview assets stay first-class at `expo/<media_id>_900.jpg` for photo/video gallery previews, `expo/<media_id>_1800.jpg` for photo detail previews, and `expo/<media_id>_short_5s_720p.mp4` for video detail previews. Copy private photo render triplets to `renders/<media_id>_{1,3,6}mp.jpg` and keep the old nested keys temporarily.

## Current Commit Scope

The intended commit for this thread should include:

- refreshed docs;
- `SUMMARY.md`;
- `.gitignore` rule for local Owner.sqlite;
- populated public `assets/catalog/photosbyelie.sqlite`;
- R2 migration tooling if added.

It should not include ignored `assets/owner-actions/Owner.sqlite`.

## Verification

After populating the databases:

```text
PRAGMA integrity_check: ok
foreign_key_check: 0 violations
npm test: pass
npm run validate: pass
```

## Next Work

1. Make SQLite generation repeatable instead of one-off.
2. Teach the public site to load `photosbyelie.sqlite` or generated output from it.
3. Move Owner title/keyword review and country assignment workflows onto `Owner.sqlite`.
4. Turn TSV and Owner JSON into compatibility exports, then retire them.
5. Copy/verify R2 private masters into the new flat `masters/<media_id>.<original_format>` keys.
6. Update Worker checkout/delivery to use four photo flavors and full-original-only video delivery.
7. Audit and delete old nested render-triplet keys only after the runtime no longer references them.
