# Scripts

## Cloud slideshow music clips

`prepare_slideshow_music_clips.py` stages uniform cloud-renderer audio without
changing the authoritative source music or manifest. It defaults to the live
40-track Pixabay country pool and to a read-only dry run:

```bash
python3 scripts/prepare_slideshow_music_clips.py
```

After reviewing the plan, create separate 60-second MP3 clips with a one-second
fade-out, SHA-256 hashes, ffprobe metadata, per-clip verification sidecars, a
derived manifest, and an upload script under ignored
`tmp/slideshow-music-clips/`:

```bash
python3 scripts/prepare_slideshow_music_clips.py --execute
```

The source is looped only when it is shorter than 60 seconds, so every prepared
clip is the same length and a cloud renderer can chain clips for longer videos.
Existing verified staging clips are reused. If a source or configuration has
changed, the tool stops instead of overwriting; inspect the difference before
using `--force` to replace generated staging files. No mode uploads anything.
Run the generated `upload-commands.sh` explicitly only after reviewing its R2
keys and the prepared manifest.

Additional clean manifests with stable `id` and `src` fields can be staged in
the same pass by repeating `--manifest`, for example:

```bash
python3 scripts/prepare_slideshow_music_clips.py \
  --manifest assets/music/slideshow-guitar/pixabay/pixabay-guitar-candidates.json \
  --manifest assets/music/slideshow-guitar/public-domain/commons-spanish-guitar.json
```

Focused verification:

```bash
python3 -m unittest scripts.prepare_slideshow_music_clips_test
```

## Lightroom Thumbnail Builder

`build_lightroom_thumbnails.py` scans developed photo/video exports, keeps Lightroom green label/rating 4+ files for Camera sources, infers a country bucket, and writes watermarked preview derivatives plus a resumable local import-cache manifest. RAW/DNG/NEF files are owner-local source material only; export developed JPG/TIFF/MOV/MP4/M4V masters before importing them. The direct Apple Photos bridge can now fill the retired Saturn/Lightroom developed-export role by rendering each Photos still image, including HEIC and RAW-backed assets, as Photos' current JPG into `tmp/apple-photos-import/`, then immediately running the normal selected-folder Expo import from that temporary folder. If Photos' rendered JPG callback stalls, the bridge can convert an alternate local JPEG/HEIC/RAW image resource, including DNG, into a temp JPG fallback. Videos are copied through as video resources. The Owner iCloud download switch is on by default so Photos can fetch missing originals or renders before writing that temp folder. The Apple Photos sidecar carries the stable asset anchor, album title, creation date, and PhotoKit GPS coordinates; the importer uses those as metadata fallbacks when rendered files do not retain EXIF.

Required tools: `python3`, `exiftool`, `sips`, `ffmpeg`, `ffprobe`, and Pillow. Pillow is used to normalize rotated source photos and bake the repeating preview watermark. Install it with `python3 -m pip install --user pillow`.

Default source resolves to the first available Camera folder in this order: `/Volumes/Saturn/Pictures/LR/Camera`, `/Volumes/Saturn-1/Pictures/LR/Camera`, `~/Pictures/LR/Camera`, then `~/Pictures/LR/2024`. The importer considers only developed `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.mov`, `.mp4`, and `.m4v` files.

Default run:

```bash
python3 scripts/build_lightroom_thumbnails.py
```

Useful options:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /Volumes/Saturn-1/Pictures/LR/Camera \
  --output-root tmp/import-cache \
  --years 2024-2026 \
  --batch-size 50 \
  --gallery-max 900 \
  --detail-max 1800
```

Resume on another machine by pointing `--source-root` at that machine's developed export folder. The script scans folders and files in reverse lexical order so newer year/month/day folders are handled first, tracks media by relative path, and writes checkpoints to `tmp/import-cache/.build-state.jsonl`, so already-inspected files and already-rendered derivatives are skipped.

Use `--years 2024` for one year or `--years 2022-2024` for an inclusive range. The filter uses the first four-digit year found in each media path relative to the `Camera` folder.

For Leonardo/AI folders where files are already selected by presence rather than Lightroom rating, opt into every image and force the gallery bucket to AI:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/_All Leonardo" \
  --output-root tmp/import-cache \
  --select all \
  --force-country ai \
  --batch-size 50
```

For Apple Photos album exports, folder membership is the selection signal, but country inference should still decide the gallery bucket:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root "/Volumes/Saturn/Pictures/LR/Apple Photo Albums" \
  --output-root tmp/import-cache \
  --select all \
  --batch-size 50
```

The Owner Expo helper uses `sourceSelect: auto`: Camera paths become `--select lightroom`, while Apple Photo Albums and AI/Leonardo paths become `--select all`. AI imports should stay tombstone-driven rather than using the Camera Green/4-star gate.

For Real Estate customer handoffs, first export rendered/current Apple Photos album versions to a customer folder on the Saturn drive. Do not export RAW/DNG/NEF originals:

```bash
zsh scripts/export_re_apple_photos_albums.zsh \
  --customer Corine
```

The default destination is `/Volumes/Saturn/Pictures/RE/Corine/<Album Name>`. The wrapper calls `scripts/export_apple_photos_album.applescript`, exports current rendered Apple Photos versions rather than originals, fails if RAW/DNG/NEF files appear in the destination, and writes an ignored report under `.review-logs/corine-real-estate-export/`.

Then build the ignored client-gallery import bundle for the Real Estate UX:

```bash
python3 scripts/import_real_estate_gallery.py \
  --customer Corine
```

The importer reads `/Volumes/Saturn/Pictures/RE/Corine` by default, refuses to run if RAW/DNG/NEF-style files are present, and writes the client-gallery bundle under `tmp/real-estate-import/corine/`. The generated `manifest.json` and `app-context.js` use the same collection/photo shape as the public gallery code, include stable liked-selection and editable-title store keys, and point the future cloud PDF builder at cloud-PDF-source JPGs instead of original exports. Video exports keep their private master as the source of truth; the importer extracts unwatermarked 900/1800 JPG stills from 10% into each clip for gallery preview and PDF use. Final PDFs and slideshows are not generated or uploaded from this script; the cloud path should receive liked media IDs plus edited titles and assemble the requested output on demand.

Preview the private Real Estate UX locally after import:

```text
http://localhost:8000/real-estate.html
```

On localhost, `real-estate.html` loads `tmp/real-estate-import/corine/app-context.js` by default. Pass `?context=<same-origin-app-context.js>` to review a different ignored client bundle. The page uses a static client access gate whose default code is the generated customer username, persists selected media IDs and edited output titles with the store keys generated by the importer, can load a prior batch JSON, can copy/download the next cloud-output batch manifest, and can generate a selected-media PDF directly in the browser. Selected videos are represented in PDFs by their 10% still; slideshow manifests preserve the original video duration, use the configured still-photo duration only for photos, and carry music credit metadata for an end-card only when a selected track requires attribution.

Each cloud output generation should also write a tiny timestamped batch manifest using the `photosbyelie.realEstatePdfBatch.v1` shape declared in `cloudPdfWorkflow.batchManifest`. Store those manifests under `real-estate/pdf-batches/<gallery-key>/<YYYYMMDDTHHMMSSZ>.json`; each item includes `photoId`, `title`, `sortIndex`, `mediaType`, PDF treatment fields, and slideshow duration policy. Listing manifests by date/time lets a client open an older batch, reuse its liked media and edited titles as the starting point, then save a new batch with `sourceBatchId` pointing back to the original.

Upload the initial Real Estate media set from that manifest:

```bash
python3 scripts/upload_real_estate_media.py \
  --manifest tmp/real-estate-import/corine/manifest.json \
  --backend s3 \
  --upload
```

The upload inventory is three objects per imported media item: one private master JPG/MOV/MP4/M4V in `photosbyelie-private` under `real-estate/<gallery-key>/masters/...`, plus unwatermarked public `_900` and `_1800` JPG previews in `photosbyelie-public` under `real-estate/<gallery-key>/previews/...`. For videos, those public previews are still frames for review and PDF assembly; the source video duration is preserved only through the private master and slideshow manifest. The uploader writes an ignored resume log at `.review-logs/real-estate-r2-upload-state.jsonl`.

Outputs:

- `tmp/import-cache/<country>/*_900.jpg`: watermarked photo gallery thumbnails and video gallery posters.
- `tmp/import-cache/<country>/*_1800.jpg`: watermarked photo detail-page images.
- `tmp/import-cache/<country>/*_short_5s_720p.mp4`: watermarked video detail-page clips.
- `tmp/import-cache/manifest.json`: selected photos/videos, derivative paths, full keyword set, rating/color label when present, and web-facing display metadata.
- `tmp/import-cache/keywords.json`: keyword counts and photo references for filter UI.
- `tmp/import-cache/collections.json`: generated indexes for years, countries, regions, cities, orientations, and source formats.
- `tmp/import-cache/failures.json`: render/extraction errors that need attention.
- `tmp/import-cache/gps-metadata.json`: exact GPS coordinates keyed by the same relative media paths.
- `tmp/import-cache/.build-state.jsonl`: append-only resume checkpoint.

When `--r2-upload public` or `--r2-upload both` is enabled, confirmed-upload preview media files are removed from `tmp/import-cache` by default; the manifest, checkpoints, keyword indexes, GPS file, and diagnostics remain. Use `--keep-uploaded-tmp` only when deliberately debugging local staging files.

By default the import metadata omits owner-blacklisted keyword strings from `assets/owner-actions/Owner.sqlite`. The tracked `assets/owner-actions/keyword-blacklist.json` file is only a SQLite-derived compatibility view for the current Owner UI. This blacklist affects only generated keyword metadata and keyword indexes; it does not block, discard, skip, or rewrite any media/source file. Exact GPS coordinates are written to the separate ignored GPS file by default. Use `--redact-gps` to skip that private GPS file, or `--redact-private-keywords` only for a sanitized publishing pass.

## Public Catalog Export

`export_photos_data.py` promotes a publishable catalog subset from the local import-cache manifest into the public SQLite catalog artifacts and leaves `photos-data.js` as a small bootstrap for existing static pages. It also writes the tiny homepage manifest to `home-data.js`. In the current GitHub-code/R2-media model, use `--external-media` so Git tracks metadata and public media keys rather than preview files. RAW-origin rows are kept out of public media because they do not have uploadable developed masters yet. Waste Basket and discarded/tombstone ids are kept out of public metadata so the site never points at intentionally deleted R2 previews. Camera rows are also filtered by the same Green + 4-star eligibility policy used at import time; Apple Photo Albums and AI/Leonardo rows are not filtered by that Lightroom rule. Public R2 preview keys include photo `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`, plus video `expo/<photo-id>_900.jpg` and `expo/<photo-id>_short_5s_720p.mp4`. Country/gallery origin stays in catalog metadata and `assets/media-sidecar.json`, not in the object key.

Product and pricing data comes from `assets/catalog/product-pricing.json`. `scripts/build_public_catalog_db.py` materializes that file into the public SQLite product tables and the local-only POD supplier tables. The browser and Worker still see the existing `photosByElieResolutions`, frame, shipping, and video-tier globals, but those values are reconstructed from shared catalog data instead of hand-authored generated JS constants. POD automation preview data is exposed as `photosByEliePodAutomation`, `photosByEliePodSuppliers`, `photosByEliePodQualityTiers`, and `photosByEliePodOptions` for Owner Commerce inspection while the public storefront flag remains off.

Public catalog rebuilds refuse to overwrite a populated SQLite catalog, Worker catalog, or homepage manifest with zero media rows unless `PBE_ALLOW_EMPTY_PUBLIC_CATALOG=1` is set, or `scripts/build_public_catalog_db.py` is run with `--allow-empty`.

For normal localhost preview with Owner tools, run the small local server instead of the bare static server:

```bash
python3 scripts/local_server.py 8000
```

This still serves the same static site files, but adds localhost-only endpoints that let the Owner page update the Waste Basket blacklist, classify Unknown photos, save owner metadata edits, summarize R2 coverage, and run local R2 maintenance. GitHub Pages never gets those endpoints; the published site remains static.

Owner mutation endpoints are unlocked on localhost by the helper server without a password.

To create the macOS Dock launcher for an Owner import workstation, install the local app bundle and add it to the Dock:

```bash
zsh scripts/install_owner_dock_app.zsh --add-to-dock
```

The Dock launcher starts from a clean Owner helper state: it stops stale localhost Owner helpers and any still-running Apple Photos bridge for this repo, starts `scripts/local_server.py`, opens Safari to canonical `owner.html`, and uses the bundled Swift/PhotoKit bridge only when the cloud Owner asks for Apple Photos albums, previews, or assignment. Album discovery includes both regular Photos albums and smart albums. Because the PhotoKit scan can take a few minutes on a large library, the helper and browser keep a short-lived album-list cache; refresh the Owner album list when you need a live rescan. The bridge exports eligible local bytes into the persistent Owner intake selected by the active workflow; publishing remains a separate guarded step.

### Apple Photos Bridge Permissions

macOS Photos access is granted to the process or app bundle that touches
PhotoKit. Use the installed permission-bearing bundle:
`~/Applications/PhotosByElie Photos Bridge.app`. Backstage and the trusted
local connector launch it with `open -W -n ... --args` for index refreshes,
previews, and local video resources. Do not replace that with
`swift scripts/apple_photos_bridge.swift` from UI code, LaunchAgents, or Codex
Scheduled prompts; direct Swift uses the caller identity and can show
`Photos access needed` even when the app bundle already has Full Access.

The installed bundle is an `LSUIElement` helper: it has no user-facing window,
menu bar, or Dock icon. Its read-only `health` command reports the stable bundle
identifier and current PhotoKit authorization. Native Backstage shows this
health on Overview; operational workflows continue to invoke the signed bundle
through LaunchServices.

The local installer embeds a stable designated requirement for the bridge
bundle identifier so an ad-hoc rebuild does not change its TCC identity. Set
`PBE_CODESIGN_IDENTITY` when a Developer ID is available.

Correct scheduled entrypoint:

```bash
python3 scripts/sidecar_maintenance.py photos-index-sync
```

That command delegates PhotoKit work back through the app-bundled bridge. The
picked-only AI planning task does not touch PhotoKit directly. When the AI
review needs visual evidence, export the current picked/not-approved preview
queue through the same app-bundled bridge:

```bash
python3 scripts/sidecar_maintenance.py picked-ai-plan
python3 scripts/sidecar_maintenance.py picked-ai-preview-export
```

After changing Sidecar durable identity from Mac-local PhotoKit identifiers to
Apple cloud identifiers, verify and hydrate legacy tombstones with:

```bash
python3 scripts/migrate_sidecar_tombstones_to_cloud.py
python3 scripts/migrate_sidecar_tombstones_to_cloud.py --apply
```

The command is dry-run by default, refuses to apply when any legacy tombstone
lacks a cloud-ID mapping, checks cloud state before every small batch, and
mirrors already-protected cloud tombstones into the local Owner cache. Its
ignored audit report is written under `tmp/sidecar-tombstone-audit/`.

The preview export writes
`assets/owner-actions/sidecar-ai-metadata-previews.json` plus JPEG previews and,
when Pillow is available, `tmp/sidecar-picked-ai-previews/contact-sheet.jpg`.
Use those artifacts for vision-backed metadata review; do not launch raw Swift
or the bare app executable to fetch previews.

Reviewed preview observations can be written back as local Sidecar Review
proposals with:

```bash
python3 scripts/sidecar_maintenance.py picked-ai-vision-propose --dry-run
python3 scripts/sidecar_maintenance.py picked-ai-vision-propose
```

By default, the command reads
`assets/owner-actions/sidecar-ai-metadata-vision-proposals-current.json`; pass
`--input path/to/proposals.json` to use another file. The proposal JSON should
contain a top-level `proposals` array with `assetId`, `title`, `keywords`, and
a short evidence-grounded `note`. The command requires the preview manifest by
default, keeps scope to picked/not-approved rows, filters keywords through the
Owner blacklist, records `metadata_ai_rung=vision-description`, and does not
queue Photos write-back.

For a temporary private-LAN review session, bind to all interfaces and opt in to LAN owner endpoints:

```bash
python3 scripts/local_server.py 8000 --bind 0.0.0.0 --allow-lan-owner
```

We are walking away from the old Curation Pass workflow. Live localhost review is now the normal path; review snapshots are retained only as historical audit files.

The Expo cap is retired. For standalone exports, omit `--expo-cap` so the exporter publishes every eligible cloud-backed preview that is not basketed, discarded, RAW-only, or otherwise ineligible:

```bash
python3 scripts/export_photos_data.py
```

For the GitHub-code/R2-media publishing model, write the same public catalog and Expo manifest without copying preview media into the repo:

```bash
python3 scripts/export_photos_data.py --external-media
```

Public catalog export also applies the `Owner.sqlite` keyword blacklist to keyword metadata, so regenerating from an older import manifest will not reintroduce blacklisted keyword strings. It does not use the keyword blacklist to decide which photos are published.

Use `scripts/audit_import_eligibility.py` to report Camera rows that remain in the raw import-cache manifest but no longer satisfy the Green + 4-star policy. With `--write-delete-plan`, it writes a temporary R2 delete plan for the sweep wrapper's eligibility phase; that cleanup deliberately uses the R2 delete tool's `--no-history` mode so Camera eligibility cleanup does not become a permanent tombstone record.

After changing the generated catalog, refresh the media sidecar so each flat public key keeps its original source and historical country/gallery provenance:

```bash
node scripts/write_media_sidecar.mjs
```

For normal H/X/U/P review, no Apply step is needed: the localhost server updates review state immediately and rewrites the generated catalog/state files. H or X sends a photo to the Waste Basket by adding its undesirable master to the blocked/master blacklist, U removes the most recent block, and P on the Waste Basket page puts a basketed master back by removing it from the blacklist. The blacklist means "do not make that mistake again": future imports/renders skip those masters. Purging Waste Basket R2 copies deletes public previews, private masters, and currently generated private render triplets for basketed photos, then leaves permanent discard tombstones so the same masters do not return; a banned photo stays banned. Unknown-to-country assignments are live server actions, not browser-staged assignments: they remove the assigned photo and its same-day cohort from Unknown immediately, update catalog metadata, write `Owner.sqlite`, and export `assets/owner-actions/country-assignments.jsonl` plus `assets/owner-actions/country-assignments.json` only as handoff/audit views. If the server update fails, the Unknown page should leave the card visible and reset the country selector.

If an older review snapshot needs to be replayed, use `scripts/asset_state.py` directly:

```bash
python3 scripts/asset_state.py \
  ~/Downloads/photosbyelie-review.pbe-review \
  --rebuild-missing-manifests
```

That compatibility path applies country assignments and Waste Basket choices from the snapshot. It is not the normal Owner flow anymore.

Because the local import cache and Waste Basket review data are ignored by Git, a fresh sync may have `assets/catalog/photosbyelie.sqlite`, the `photos-data.js` bootstrap, and `assets/expo-manifest.json` but no local import-cache manifest. In that case the compatibility cleaner applies the pass directly from the site data where it can. If the derivatives live in another checkout or worktree, add it as a search root:

```bash
python3 scripts/asset_state.py \
  ~/Downloads/photosbyelie-review.pbe-review \
  --asset-source ~/Dev/photosByElie-full-assets
```

Use `--rebuild-missing-manifests` when you want to regenerate the local Lightroom and AI manifests from source archives before applying the pass. Override with `--source-root` or `--ai-source-root` when the archives are mounted somewhere else.

For a dry review preview without moving files, `export_photos_data.py` can take `--review-snapshot` or the older `--blacklist` alias. Use `--selection newest` only when you explicitly want the newest eligible rows instead of the default ordering. Use `--seed N` only with legacy capped/randomized export experiments.

The active storage contract is: Git tracks code/metadata and tiny assets; `tmp/import-cache` is the ignored disposable import/render workspace; `assets/owner-actions/reserve-data.json` remains only as localhost compatibility data; Waste Basket is the owner review surface for undesirable masters backed by blacklist/tombstone records; public preview media belongs on R2/CDN. The old raw-first staging folders are retired.

## State SQLite

`build_photo_state_db.py` creates an ignored local SQLite database at `tmp/photo-state.sqlite` so the current media universe can be inspected without opening every JSON/JS manifest by hand. It combines the public catalog, homepage manifest, import cache, Expo manifest, private delivery manifest, media sidecar, blocked/discarded tombstones, Unknown country assignments, compatibility Reserve data, and R2 upload/delete logs.

```bash
python3 scripts/build_photo_state_db.py
open -a "DB Browser for SQLite" tmp/photo-state.sqlite
```

Useful tables and views include `photos`, `photo_states`, `r2_objects`, `keywords`, `manifest_files`, `owner_country_assignment_events`, `owner_country_assignments`, `state_counts`, `collection_counts`, `attention`, `import_not_public`, and `unwanted_r2_objects`. The `unwanted_r2_objects` view is intentionally useful while known unwanted photos remain in R2 as test fixtures.

The public site still exposes the same `window.photosByElieData` browser contract. Public pages load plain `assets/catalog/photosbyelie.sqlite` directly; normal catalog rebuilds do not generate or prefer Brotli-compressed SQLite. The ignored local Owner workflow database lives at `assets/owner-actions/Owner.sqlite`; tracked Owner JSON files are compatibility views or audit records, not state.

The populated `photosbyelie.sqlite` schema keeps `media_items` dense by using short integer lookup ids for collections, cameras, lenses, media types, source origins, formats, asset types, and keyword terms. Rebuild it with `python3 scripts/build_public_catalog_db.py`; `node scripts/write_catalog_tsv.cjs` is a legacy-named compatibility command that refreshes the SQLite bootstrap and public DB. The current active public database has `5,827` `media_items` and `34,962` `media_assets`. `Owner.sqlite` has local workflow tables for settings, keyword blacklist, country assignments, title/keyword batches, queue state, proposals, and decisions. See `docs/architecture/sqlite-catalog-owner-state.md`.

Legacy `.sqlite.br` files are no longer used by normal site or Owner operations. If a retained compressed artifact needs inspection in VS Code, open it and run the task `View Brotli SQLite in SQLite Viewer`. The task uses `scripts/view_sqlite_br.cjs` to Brotli-decompress the file into ignored `tmp/vscode-sqlite-br/*.sqlite`, validates it with `sqlite3 PRAGMA integrity_check`, and opens the decoded database so the SQLite Viewer extension can display it. The same bridge can be run directly:

```bash
node scripts/view_sqlite_br.cjs assets/catalog/photosbyelie.sqlite.br
```

The normal maintenance path is a daily Codex automation named "Photos By Elie state DB refresh". For an on-demand refresh, run:

```bash
python3 scripts/build_photo_state_db.py
```

For a temporary local watcher while actively debugging state changes, run:

```bash
PBE_PHOTO_STATE_DB_INTERVAL=600 ./scripts/watch_photo_state_db.zsh
```

Stop it with `Ctrl-C`. The database lives under `tmp/`, so it is disposable and ignored by Git.

## Publish Validation

`validate_publish.js` checks the generated public catalog before publishing. It loads `home-data.js` plus the SQLite catalog/bootstrap helpers, verifies homepage counts/samples, duplicate photo IDs, collection page shells, resolution availability metadata, discarded/tombstone exclusions, and either local `*_900.jpg`/`*_1800.jpg` derivative pairs or external public media keys.

## Social API Scaffolds

The social API helpers are dry-run-first wrappers for prepared daily package manifests. They never store app secrets or access tokens in the repo; OAuth helpers save token JSON under `~/.config/photosbyelie/` with `0600` permissions.

Pinterest:

```bash
npm run social:pinterest-oauth -- --auth-url
npm run social:pinterest-api -- --manifest socials/Pinterest/YYYY-MM-DD/theme/manifest.json --board-id "$PINTEREST_BOARD_ID"
```

Facebook Page and Instagram:

```bash
npm run social:meta-oauth -- --auth-url
npm run social:meta-api -- --platform facebook --manifest socials/Facebook/YYYY-MM-DD/theme/manifest.json --page-id "$META_PAGE_ID"
npm run social:meta-api -- --platform instagram --manifest socials/Instagram/YYYY-MM-DD/theme/manifest.json
```

Threads:

```bash
npm run social:threads-oauth -- --auth-url
npm run social:threads-api -- --manifest socials/Threads/YYYY-MM-DD/theme/manifest.json --threads-user-id "$THREADS_USER_ID"
```

Live publishing requires adding `--publish` after reviewing dry-run output.

The generated product list currently includes digital file options, local-only physical print sizes, per-print framing choices, POD supplier mappings, and shipping/handling offsets. Print labels keep both inch and centimeter dimensions, but `photos-data.js` still carries the lightweight helper functions that infer the browser-locale measurement system and expose pricing helpers. Update `export_photos_data.py` when changing product ids, labels, prices, dimensions, frame options, shipping/handling amounts, POD metadata, or availability thresholds so regenerated catalog SQLite/bootstrap files keep the public checkout model intact.

Run the validator before pushing public site changes:

```bash
node scripts/validate_publish.js
```

When GitHub Pages is serving code and metadata while public previews live in R2/CDN, validate the catalog keys instead of committed local JPG files:

```bash
node scripts/validate_publish.js --external-media
```

Use `--summary` when preparing a push. The summary prints collection counts, local import-cache/blocked asset sizes, and publish-scope working-tree changes for `photos-data.js`, `assets/catalog/`, and `assets/expo-manifest.json`:

```bash
node scripts/validate_publish.js --summary
```

## Social Post Packages

`finalize_social_prepost_package.mjs` is the daily pre-post target finalizer. It reads the current `daily-social-package.json`, normalizes public preview URLs from `media-config.js`, creates or refreshes first-party campaign springboards, stages `socials/{Platform}/YYYY-MM-DD/{theme}/` upload folders with images, captions, READMEs, and manifests, derives a 3-4 image Threads package from Instagram when needed, records published URLs or manual blockers, and rebuilds `assets/campaigns/index.json`.

`generate_social_post_packages.mjs` is the older DAVID2MAX Social Asset Queue draft helper. Use `npm run social:packages:queue` when you need that legacy queue-to-brief path.

`etsy_outlet.mjs` turns a first-party campaign into an ignored local Etsy outlet package under `assets/owner-actions/etsy-listing-packages/<date>/<campaign>/`. It uses only public catalog rows, public R2 watermarked previews, and first-party campaign/photo URLs. By default it writes review payloads only for the `jpg-6mp` digital download lane; Etsy draft creation requires explicit `--create-drafts --confirm-create-drafts` plus a confirmed taxonomy id. Later POD or physical print lanes also require the appropriate shipping profile, readiness profile, production partner/material setup, and owner approval before draft creation.

```bash
npm run social:packages
npm run social:packages -- --date 2026-06-18
npm run social:packages -- --date 2026-06-18 --dry-run
```

Pinterest should be treated as a publishing target, not the canonical asset store. When a Pinterest work folder exists under `socials/Pinterest/<date>/`, build the first-party download kit instead of trying to download assets back from Pinterest's embedded browser UI:

```bash
npm run social:pinterest-downloads -- --date 2026-05-14
```

That writes `downloads.html` and `download-manifest.tsv` beside the staged Pin images, carousel candidates, source previews, and copy blocks.

The first Pinterest API publishing scaffold is dry-run by default and does not store credentials. It prepares one standard image Pin request per staged Pinterest image, using public watermarked R2 image URLs plus the first-party PhotosByElie destination:

```bash
npm run social:pinterest-api -- --manifest socials/Pinterest/2026-05-27/gibraltar-rock-and-bay-views/manifest.json
```

After a Pinterest app is approved, generate the authorization URL and exchange the returned code. Tokens are saved outside the repo and are not printed:

```bash
export PINTEREST_CLIENT_ID='...'
export PINTEREST_CLIENT_SECRET='...'
export PINTEREST_REDIRECT_URI='http://localhost/'
npm run social:pinterest-oauth -- --auth-url
npm run social:pinterest-oauth -- --exchange-code '<returned-code>'
```

After a token is available outside the repo, list boards and pass the intended board id explicitly:

```bash
npm run social:pinterest-api -- --list-boards
npm run social:pinterest-api -- --manifest socials/Pinterest/2026-05-27/gibraltar-rock-and-bay-views/manifest.json --board-id "$PINTEREST_BOARD_ID"
```

Live publishing requires `--publish`, `PINTEREST_ACCESS_TOKEN`, and a board id. See `docs/sops/PINTEREST_API_SOP.md`.

The Meta API scaffold follows the same dry-run-first pattern for Facebook Page and Instagram publishing. Facebook tokens are stored outside the repo by the OAuth helper:

```bash
export META_APP_ID='...'
export META_APP_SECRET='...'
export META_REDIRECT_URI='http://localhost/'
npm run social:meta-oauth -- --auth-url
npm run social:meta-oauth -- --exchange-code '<returned-code>'
```

After a Facebook token exists, discover the Photos By Elie Page:

```bash
npm run social:meta-api -- --list-pages
```

Dry-run Facebook and Instagram packages before any live call:

```bash
npm run social:meta-api -- --platform facebook --manifest socials/Facebook/2026-05-27/paris-arts-metiers-mechanical-details/manifest.json --page-id "$META_PAGE_ID"
npm run social:meta-api -- --platform instagram --manifest socials/Instagram/2026-05-27/setenil-rock-streets/manifest.json
```

For Instagram API with Instagram Login, generate the Instagram account token from the Meta Instagram API setup screen, save it outside the repo at `~/.config/photosbyelie/instagram-token.json`, and include the `ig_user_id` shown by Meta in that file. Live publishing requires `--publish`, a token, and the relevant Page or Instagram id. Instagram captions do not make raw URLs clickable, so campaign-driven posts should use the Instagram profile website link plus "profile link" caption copy. See `docs/sops/META_API_SOP.md`.

Useful options:

```bash
npm run social:packages:queue -- --date 2026-05-13 --limit 3
npm run social:packages:queue -- --dry-run
```

## Owner Title / Keyword Review Queue

`generate_title_keyword_review_queue.mjs` prepares the newest 100 photos missing Owner title/keyword review state for manual Owner review. It reads and writes durable queue/proposal state in `Owner.sqlite`, then writes the current review-page batch view under ignored `assets/owner-actions/title-keyword-review-queue/` for localhost review only. It uses Apple Photos album, GPS, location, and source path facts as proposal hints when available, but does not modify source-file embedded metadata.

Generate (nightly batch):

```bash
node scripts/generate_title_keyword_review_queue.mjs --limit 100
```

`assets/owner-actions/title-keyword-review-queue/proposed-state.json` is retired. Use `Owner.sqlite:title_keyword_queue`, `title_keyword_proposals`, and `title_keyword_decisions` for proposal state.

When an ordinary run selects a rung from the saved arbitrary-length `{model, effort, vision: true}` ladder, the generator groups photos deterministically by gallery/source folder (or Apple Photos album) and an anchored two-hour capture window. The default order is `gpt-5.4-mini/low → gpt-5.6-luna/max → gpt-5.6-sol/high`; every call includes bounded JPEG previews. It sends bounded chunks with defaults of 8 photos, 8 MiB of prompt plus preview input, and 64,000 conservative estimated input tokens. Override these limits only for an inspected run with `PBE_TITLE_KEYWORD_BATCH_MAX_IMAGES`, `PBE_TITLE_KEYWORD_BATCH_MAX_INPUT_BYTES`, `PBE_TITLE_KEYWORD_BATCH_MAX_INPUT_TOKENS`, or `PBE_TITLE_KEYWORD_CAPTURE_WINDOW_MS`. The model must return a structured `results` collection keyed by `photo_id`; valid rows are retained even when another row is malformed, and failed rows are retried or split in isolation. Chunk and per-photo attempt, validation, preview, model-ladder, input-bound, and provenance state is persisted in `Owner.sqlite:title_keyword_batch_chunks` and `title_keyword_batch_items`, so an interrupted batch resumes under the same batch id. Each proposal also persists its requested model, resolved model, reasoning effort, vision flag, and ladder snapshot. Backstage prefers Codex Desktop's bundled runtime, rework remains per-photo, Ollama/local models remain out of scope, and no catalog metadata is changed until separate human approval.

Each generated batch view also includes a deterministic before/after invocation plan plus observed bounded-run latency, throughput, item error rate, retry/split counts, input bytes/tokens, and the model ladder. Codex CLI does not expose per-request billing to this script, so the recorded input-token basis is intended for reconciliation with the model usage export rather than presented as a fabricated price.

Review on localhost:

- Start the local helper server: `python3 scripts/local_server.py 8000`
- Open `http://localhost:8000/owner-review.html?view=title-keywords`

Use the page to review one photo per row, edit proposed title/keywords, approve individual rows, reject rows with an optional rework comment, block rows with `H`/`X`, or use Approve all when the whole batch is acceptable. Per-row saves require the helper server and write decisions to `Owner.sqlite`; `approvals-<batch>.json` is an ignored localhost review-page/audit export derived from SQLite, not a deployable source of truth. Approved/rejected keywords are normalized case-insensitively, deduplicated, and filtered through the `Owner.sqlite` keyword blacklist before they are saved. Rejection comments are saved with a compact copy of the rejected title and keyword proposal attached so the next AI rework rung can see what the owner rejected. Applying approved rows updates generated catalog metadata/state files and adds the `Title_Keywords_Reviewed` flag so future batches skip applied photos. Rejections and parked/rework state are recorded in `Owner.sqlite`.

The approval apply path is manifest-only. It rewrites generated catalog/state files such as `assets/catalog/photosbyelie.sqlite`, the `photos-data.js` bootstrap, `home-data.js`, `assets/expo-manifest.json`, reserve/hidden state as needed, and `worker/photos-catalog.generated.mjs`; it does not rewrite source-file embedded metadata, public previews, private masters, private render files, or Brotli catalog artifacts. Run `npm test` and `npm run validate` after applying a batch and before committing.

## R2 Media Sync

`sync_r2_media.py` prepares the Cloudflare R2 upload sets for the post-GitHub media layout:

- public watermarked photo previews go to `photosbyelie-public` under `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`
- public watermarked video detail previews go to `photosbyelie-public` under `expo/<photo-id>_short_5s_720p.mp4`
- local import-cache and current catalog previews share that same public prefix because Reserve disappears from the cloud model and country/gallery origin lives in metadata
- private developed masters live in `photosbyelie-private` under `masters/<photo-id>.<original-format>`
- private photo JPG deliverables remain sellable at 6 MP, 3 MP, and 1 MP; the target keys are `renders/<photo-id>_6mp.jpg`, `renders/<photo-id>_3mp.jpg`, and `renders/<photo-id>_1mp.jpg`
- legacy private folders such as `masters/<photo-id>/<original-file>` and `renders/<photo-id>/<original-file>-jpg-6mp.jpg` are retired; checkout and routine purge paths no longer reference them
- RAW/DNG/NEF sources and their embedded previews are skipped for both public and private uploads
- IDs listed in owner discard tombstones are skipped for import/upload and should be deleted from the current public/private R2 key families by `delete_discarded_r2_media.mjs`; the tombstone stays tracked so Saturn scans do not resurrect discarded photos

For the normal daily/manual sweep, prefer the lock-guarded wrapper:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

Historical migration helper: `migrate_r2_asset_keys.mjs` copied old nested private masters/render triplets to the flat SQLite-era key convention. The migration window is closed; use it only for archaeology against an old sidecar/report, not as part of normal operations:

```bash
node scripts/migrate_r2_asset_keys.mjs --limit 10
node scripts/migrate_r2_asset_keys.mjs --copy --limit 10
node scripts/migrate_r2_asset_keys.mjs --copy --workers 12
```

The script copies:

```text
masters/<photo-id>/<original-file>
renders/<photo-id>/<original-file>-jpg-6mp.jpg
renders/<photo-id>/<original-file>-jpg-3mp.jpg
renders/<photo-id>/<original-file>-jpg-1mp.jpg
```

to:

```text
masters/<photo-id>.<original-format>
renders/<photo-id>_6mp.jpg
renders/<photo-id>_3mp.jpg
renders/<photo-id>_1mp.jpg
```

using R2's S3-compatible `CopyObject`, then verifies the destination with `HEAD`. Normal checkout/Worker delivery no longer references those old keys.

If Owner.sqlite ever records legacy-shaped R2 keys as `current` or `marked_for_delete`, clean them with the focused one-time/audit tool:

```bash
node scripts/cleanup_legacy_r2_keys.mjs
node scripts/cleanup_legacy_r2_keys.mjs --delete --workers 8
```

The cleanup script reads the local R2 object ledger, deletes only old nested private keys and old `expo/<collection>/<photo-id>...` public preview keys, and writes successful deletes back as `deleted_confirmed`.

The wrapper sources `~/.zshrc`, pulls latest `main`, preflights import dependencies/source readiness, deletes discarded media from R2, imports selected media, regenerates catalogs/sidecars, backfills missing private render triplets, validates, commits, and pushes. The preflight phase checks Pillow for the sweep Python, `exiftool`, `sips`, `ffmpeg`/`ffprobe`, R2 upload backend readiness, and readable source folders before any photo work is queued. In automation mode it still imports the fixed Camera, Apple Photos, Leonardo, and configured Real Estate Saturn sources, with banned-photo R2 cleanup before and after the import pass. In Owner UI mode, Start Expo import opens a local folder chooser and passes that folder to the wrapper as `--source-root`, so only that selected folder is scanned and the banned-photo cleanup phases stay out of the import dashboard. It uses `.review-logs/cloud-media-sweep.lock`; a scheduled automation will exit if a manual sweep is still active.

The Owner dashboard Start Expo import button starts this same wrapper through the local helper server after the owner chooses a folder.

The stricter master-chain repair checks live R2 rather than cached manifests. It lists private masters first, derives the allowed private render triplets and public previews, restores missing catalog masters from Saturn/local source roots before cleanup, regenerates missing private render triplets, removes derivative ghosts only when `--prune` is set, and rewrites the private-delivery/public-preview inventory manifests when `--repair`, `--prune`, or `--write-manifests` is used:

```bash
zsh -lc 'node scripts/repair_r2_master_chain.mjs --repair --prune'
```

Run without flags for a report-only audit. The daily automation `Photos By Elie R2 master-chain repair` runs the repair/prune pass, then tests and validates.

Refresh the Owner storage/cost estimate after a large import, backfill, or Waste Basket media cleanup:

```bash
zsh -lc 'node scripts/write_storage_estimate.mjs'
```

The estimate writes `assets/storage-estimate.json`. Current public/private bytes come from live R2 listings; already-deleted basketed previews/renders are estimated from current average object sizes, while basketed master bytes come from the Waste Basket catalog source metadata. The Owner bill card uses the same file to show consumed month-to-date storage cost, expected current-month storage bill, and next-month storage at the current rate. R2 operation usage and Worker request/CPU overages still require Cloudflare analytics before the estimate is invoice-complete.

Dry-run the currently publishable Expo previews:

```bash
python3 scripts/sync_r2_media.py --scope public
```

Dry-run the full public browsing set, including local import-cache previews:

```bash
python3 scripts/sync_r2_media.py --scope public --include-reserve
```

Dry-run private developed masters, using mounted Saturn source paths when available:

```bash
python3 scripts/sync_r2_media.py --scope private
```

Add `--upload` only after the dry-run counts look sane. The script uses `npx wrangler r2 object put`, so Wrangler must already be authorized on the machine.

Run one lane at a time unless there is a strong reason not to. Public and private uploads both call the same Cloudflare account API, so running them together can trigger `429 Too Many Requests` responses and eventually make Wrangler's OAuth token path wobble. The upload journal in `.review-logs/r2-upload-state.jsonl` records successful objects, so interrupted runs can be safely resumed without `--no-resume`.

Recommended public preview resume command:

```bash
python3 scripts/sync_r2_media.py --scope public --include-reserve --upload --clean-uploaded-tmp --workers 4 --request-min-interval 0.75
```

Recommended private master resume command, after public previews finish:

```bash
python3 scripts/sync_r2_media.py --scope private --upload --workers 2 --request-min-interval 1.5
```

Normal imports upload public previews and private developed masters only. Private buyer JPG render triplets are now an on-demand Worker cache: checkout can generate missing JPG 1 MP, 3 MP, and 6 MP files from the private master through Cloudflare Images and then store the result back under `renders/<photo-id>_<size>mp.jpg`.

Sidecar Upload Bridge starts from picked + Review-approved Apple Photos rows
that have been queued across the bridge. Plan mode reports planned private
master and public preview keys without exporting from Photos or writing R2:

Upload Bridge eligibility is stricter than local Review approval. A picked row
must also have enough metadata to publish safely: a clear public gallery/country
signal from title, keywords, filename, or location context, plus a non-generic
title. Rows with titles such as `2026`, `WhatsApp`, `DJI Album`, or blank titles
and no gallery signal are blocked from bridge queueing/upload and surfaced as
metadata-blocked in the Upload Bridge panel.

AI-generated rows (explicit `AI generated*`, `Generative AI`, or `AI artwork`
keywords) and the full `Stained*` keyword family are retired from Expo and
excluded from new Upload Bridge work. The daily sweep preserves the local
Leonardo source archive but no longer imports it to public or private R2. Use
`scripts/retire_ai_expo_assets.py --selection ai`, `--selection stained-glass`,
or `--selection stained` for the audited, batch-delete-and-revoke lifecycle;
it is dry-run unless `--commit` is provided.

That legacy keyword retirement does not veto a current native publication
request after the exact asset has independently passed fixture placement and
human Review approval. Explicit AI-generation markers remain blocked in every
path; a legitimate photographed subject such as stained glass is allowed only
through that verified native authorization gate.

Historical public Upload Bridge rows can be resumed through fixture adoption
and verified Apple Photos give-back with
`PYTHONPATH=scripts python3 scripts/fixture_r2_apple_giveback_drain.py --commit --checkpoint-every 100`.
The drain does not trust legacy status alone: it matches each retained local
upload artifact to the live immutable R2 object, persists the checksum evidence,
adopts the asset into `fixture-expo`, then writes and rereads Apple Photos before
counting the item. It is idempotent and reports verified milestones, not
attempted writes.

```bash
python3 scripts/sidecar_upload_bridge.py --limit 20
python3 scripts/sidecar_upload_bridge.py --json --output assets/owner-actions/sidecar-upload-runs/dry-run.json
```

The materialization dry run exports one queued Apple Photos asset into a local
run spool and records the attempt in `sidecar_upload_bridge_runs` plus
`sidecar_upload_bridge_run_items`. It may allow Photos/iCloud downloads for that
one bridge-approved item, but still does not write R2 or register catalog rows:

```bash
python3 scripts/sidecar_upload_bridge.py --export-one --limit 1
python3 scripts/sidecar_upload_bridge.py --export-one --json
```

Live bridge execution through the CLI processes one selected uploadable item per
invocation, then uploads the private master and watermarked public preview pair
to R2. Planned key collisions are skipped by default; pass
`--allow-r2-overwrite` only when you intentionally want to replace existing R2
objects. Successful bridge-uploaded keys are remembered in the local bridge
ledger, so retrying after a partial run skips already uploaded keys. The
Sidecar Review UI uses a faster streamed batch executor: it selects the
requested uploadable rows once, checks planned R2 coverage once, then runs two
items concurrently while each item uploads its three planned R2 keys in a small
parallel group. Verified items return to Apple Photos in batches of ten, so the
`PBE-Approved` smart album advances in visible bursts without repeating the
Photos writer startup cost for every item. The rail has an item count field
capped by the remaining R2-uploadable queue, streamed per-item progress feedback
with uploaded-item thumbnails and timings, and a Stop upload control that flushes
any completed give-back batch before stopping ahead of the next worker pair:

```bash
python3 scripts/sidecar_upload_bridge.py --execute --limit 1
python3 scripts/sidecar_upload_bridge.py --execute --limit 1 --json --output /tmp/sidecar-upload-bridge-execute.json
```

After a successful bridge upload, register missing approved rows in the public
catalog with:

```bash
python3 scripts/sidecar_maintenance.py register-uploaded-catalog --dry-run
python3 scripts/sidecar_maintenance.py register-uploaded-catalog
```

The registration command reads approved, picked Sidecar rows plus successful
Upload Bridge ledger results, upserts current R2 object ledger rows, inserts
missing `media_items`/`media_assets` rows into
`assets/catalog/photosbyelie.sqlite`, and refreshes
`worker/photos-catalog.generated.mjs`. Until registration runs, files can exist
in R2 without appearing in the public catalog.

Native Backstage publication uses the same boundary automatically: after every
checksum-verified public derivative set, the native publication pipeline records
a `public_catalog_publications` audit row and promotes the media into the local
SQLite catalog. The audit remains `local` until the deployed URL is verified.
To repair a completed native run whose R2 objects predate this handoff, use the
idempotent recovery command, then review and deploy the generated projections:

```bash
python3 scripts/native_catalog_promotion.py promote-verified --run-id <upload-run-id>
python3 scripts/native_catalog_promotion.py verify-public-catalog \
  --asset-id <asset-id> --source-version-hash <source-version-hash>
```

Bridge plans intentionally omit private JPG render triplets. Existing private
render cache cleanup should also begin as a dry run until sold-media protection
is loaded from the Worker order ledger:

```bash
python3 scripts/prune_private_render_cache.py
python3 scripts/prune_private_render_cache.py --protected-photo-ids-file assets/owner-actions/protected-sold-media-ids.json
```

For an explicit cache-warming or fallback repair run on David, which owns the developed masters, generate/upload private buyer JPG renders during import/private upload:

```bash
python3 scripts/build_lightroom_thumbnails.py \
  --source-root /path/to/developed/files \
  --r2-upload private \
  --r2-private-renders
```

For private render backfill against the current catalog and tracked private-delivery manifest:

```bash
node scripts/sync_private_deliverables.mjs --commit-every 100 --push
```

For owner-discard cleanup:

```bash
node scripts/delete_discarded_r2_media.mjs --delete
```

That command double-checks matching current public previews, private masters, and private JPG render objects in R2. It marks newly targeted keys as `marked_for_delete`, records successful idempotent delete calls back as `deleted_confirmed`, and keeps `assets/discarded-media-manifest.json` as the durable do-not-resurrect compatibility record. Routine runs trust Owner.sqlite; use `--deep-inventory` to refresh `current` R2 object state when storage volume looks suspicious. Legacy nested/private folders and country-prefixed public previews are retired; use `cleanup_legacy_r2_keys.mjs` only for an explicit one-time cleanup or audit of those old key families.

For an already-published photo, render/upload just its private JPG deliverables:

```bash
zsh -ic 'node scripts/render_private_deliverables.mjs --photo-id <photo-id>'
```

On David, `render_private_deliverables.mjs` first looks for the developed file under mounted local source roots such as `/Volumes/Saturn/Pictures/LR/Camera` and `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`, then falls back to private R2 only if the local master is not present. Add `--source-root /path/to/developed/files` or set `PBE_DELIVERY_SOURCE_ROOTS` when the developed corpus is mounted somewhere else. If S3 backend credentials are present, the private render and importer upload paths use the S3 backend automatically; you can also force it explicitly:

```bash
PBE_R2_BACKEND=s3 \
  node scripts/render_private_deliverables.mjs --photo-id <photo-id>
```

The uploader also retries transient Wrangler failures with longer backoff. If Wrangler reports `Invalid access token`, run `npx wrangler whoami` or `npx wrangler login`, then rerun the same resume command.

If Wrangler auth keeps failing, `sync_r2_media.py` can write through Cloudflare R2's S3-compatible API instead:

```bash
export R2_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."

python3 scripts/sync_r2_media.py \
  --scope public \
  --include-reserve \
  --backend s3 \
  --upload \
  --workers 2 \
  --request-min-interval 1.5
```

The S3 backend uses Python stdlib SigV4 signing and does not need Wrangler login state. Keep the same one-lane rule and start with a small `--limit 1` upload if credentials or bucket permissions were just created. Dry runs do not require credentials because they only build the local inventory.

Deletes also use the S3 backend when those credentials are present. The local Owner helper's Waste Basket purge batches R2 object deletion with S3 `DeleteObjects` by bucket, falling back to the older per-object Wrangler delete path when S3 credentials are not available.

The public bucket exposes baked-watermark previews through the custom Worker media route in `media-config.js` as `publicBaseUrl`, with CORS managed by the Worker media response and `docs/r2-public-cors.json` kept as the bucket-side reference. Public-facing localhost pages use that public media base by default so local testing pays the same network/cache cost as deployed visitors. Owner-only pages keep local staging behavior unless an explicit `?mediaBase=https://...` override is supplied. Use `?mediaBase=local` to force local preview files for a debugging session.

## Classified Unknown Public R2 Cleanup

`cleanup_classified_unknowns_public_r2.py` is a recovery tool for the narrow case where Unknown previews were already uploaded to public R2 before localhost country classification moved them into a real gallery. It reads a review log with `r2_moves`, uploads the classified target key first, then deletes the old Unknown key, with resumable state in `.review-logs/public-r2-unknowns-cleanup-state.jsonl`.

Dry-run the default review log:

```bash
python3 scripts/cleanup_classified_unknowns_public_r2.py --dry-run
```

Run it only after confirming no public/private R2 upload lane is active. The script checks for active R2 writer processes and the shared throttle lock before making changes.

## Local Ignored Cleanup

`clean_local_ignored.py` is the safe repo-housekeeping helper for ignored scratch files. It follows `docs/sops/REPO_MEDIA_CLEANUP_SOP.md`, defaults to a dry run, archives borderline artifacts under `../PhotosByElie-local-archive/`, and refuses to touch protected local state such as `assets/owner-actions/Owner.sqlite`, `.env.stripe-test.local`, `assets/hidden/`, Pixelmator edit folders, active Owner review/config folders, root GitHub Pages HTML, and active catalog artifacts.

Preview cleanup:

```bash
python3 scripts/clean_local_ignored.py
```

Apply the allowlisted cleanup:

```bash
python3 scripts/clean_local_ignored.py --apply
```

## Local Asset Sync

`sync_local_assets.py` moves ignored local review state between the David and Max checkouts. It syncs Hidden JSON state and `.review-logs` by default. The disposable import cache under `tmp/import-cache` should be rebuilt or uploaded, not handed off through Git. The tracked public metadata should normally move through Git.

For `assets/owner-actions/Owner.sqlite`, prefer the R2 snapshot workflow in `docs/sops/MAX_DAVID_SYNC_SOP.md`: create a SQLite `.backup`, gzip it, upload it to private R2, then download and restore on the destination machine after verifying SHA-256 and `PRAGMA integrity_check`. Do not commit `Owner.sqlite` or copy a live DB file directly.

David can install a LaunchAgent that polls GitHub for fresh `MAX2DAVID.md` instructions at the top of every minute:

```bash
zsh scripts/install_david_instruction_poll.zsh
```

The script can run from either computer. Pass a known peer name when that machine is mounted, or pass an explicit repo path:

```bash
python3 scripts/sync_local_assets.py max
python3 scripts/sync_local_assets.py david
python3 scripts/sync_local_assets.py /Volumes/MHD2/Users/ecohen/Dev/PhotosByElie
```

It is a dry run unless `--apply` is present:

```bash
python3 scripts/sync_local_assets.py max --apply --progress
python3 scripts/sync_local_assets.py max --direction pull --apply
```

Leave `--delete` off for additive safety. Use it only when intentionally mirroring removals from source to destination.
