# Conversation Summary

Date: 2026-05-06

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current local visible build: `v66.49`
- Current public GitHub Pages build before this push: `v66.37`
- Generated public catalog: 503 photos, with 100 each for AI, France, Portugal, Spain, and USA, plus 2 Slovakia and 1 Mexico.
- Publish validation is passing in external media mode: `node scripts/validate_publish.js --external-media --summary`.
- Tracked `assets/expo` preview JPGs have been removed from the GitHub payload; public pages now validate against R2/CDN media keys instead of local committed preview files.
- Ignored local preview cache: `assets/reserve`, about 20,318 preview JPGs and 5.9 GB.
- Hidden is now a blacklist/review state, not a physical media state: 14 hidden IDs and 28 public preview keys are recorded in `assets/hidden/hidden-blacklist.json`.

## Architecture Direction

- GitHub should carry code, HTML/CSS/JS, metadata, generated catalogs, docs, and small shared assets.
- Public media should live outside GitHub as baked, aggressive watermarked previews only.
- Private developed masters may live in private object storage later, but RAW/DNG/NEF originals stay off cloud media and remain on Elie's computers and backup drives.
- Reserve disappears from the long-term public/cloud model. Locally, `assets/reserve` remains a compatibility preview cache used by the importer, review tools, and handoff scripts.
- Hidden photos are hidden through a blacklist that the public site and media tooling respect. The Hidden owner page should re-promote by removing IDs from the blacklist or permanently remove the related cloud objects when Elie chooses to wipe them.
- Owner-only capabilities remain localhost-only: H/U hiding, Unknown classification, metadata edits, hidden review, upload/accounting tools, and any future R2 wipe actions.

## Media And Upload Work

- Cloudflare R2 buckets exist for the account: `photosbyelie-public` and `photosbyelie-private`.
- The first public upload attempt did run: local journals show 1,615 successful public preview uploads to `photosbyelie-public`.
- Cleanup also ran: local journals show 2,453 successful public preview delete operations against `photosbyelie-public`.
- No private master uploads are recorded in the local R2 journals.
- Live R2 state still needs a direct dashboard/API/Wrangler check when Cloudflare credentials are available in the shell.
- The weak/permissive watermark preview path was stopped. Public preview generation is being revised around the stronger repeated "do not use" watermark, with opacity tuned down from the first too-heavy test.
- Import/upload should skip previews derived from RAW/DNG/NEF sources. DNGs are useful owner-local source material, but they are not public previews or private masters for this plan.

## App And Owner Workflow

- Localhost detail pages let Owner edit Title and Keywords. Return/Enter saves metadata and exits edit focus so left/right navigation can continue immediately.
- Metadata saves now target the catalog and available local preview/source files; pushing those metadata changes back to R2 should become a background owner task with progress visible on the Owner page.
- Gallery/detail data now includes public media keys so GitHub Pages can render from a public media base URL instead of committed image files.
- Public and localhost pages still share the static app, but localhost uses `scripts/local_server.py` for owner-only endpoints.
- Hidden review now treats P as re-promote from the blacklist, not "return to Reserve."
- Buyer-facing detail copy is being simplified toward digital assets and resolution selection. Physical products should stay disabled or owner-toggleable until fulfillment is real.
- Liked and basket views are being polished to use each selected asset preview as a subtle low-opacity row background.

## Import Direction

- The active importer should scan developed JPG/JPEG/TIF/TIFF exports only.
- Camera imports still use Lightroom green label/rating 4+ selection.
- Leonardo/AI imports are selected by folder membership and forced to the AI country/group.
- The importer creates local preview-cache derivatives and catalog metadata, not a GitHub media payload.
- A later upload pass should send only safe baked-watermark public previews and, separately, private developed masters for non-RAW sources.

## Backlog Snapshot

The living backlog is in `TODO.md`. Highest-priority work now centers on:

1. Verify live R2 state and credentials.
2. Finish the safe public-media pipeline.
3. Reconcile importer rules with the developed-only source policy.
4. Wire hidden blacklist publishing and optional permanent R2 wipe actions.
5. Finish owner metadata persistence and background R2 resync.
6. Polish buyer-facing detail, liked, and basket pages.
7. Keep GitHub Pages deployable with code and metadata only.
