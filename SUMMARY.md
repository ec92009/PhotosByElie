# Conversation Summary

Date: 2026-05-07

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v66.49`
- Latest pushed commit before this summary: `a99822a photosbyelie: refresh r2 upload docs`
- Generated public catalog: 503 photos, with 100 each for AI, France, Portugal, Spain, and USA, plus 2 Slovakia and 1 Mexico.
- Publish validation is passing in external media mode: `node scripts/validate_publish.js --external-media --summary`.
- GitHub now carries code, docs, generated metadata, and tiny shared assets. Public preview JPGs are no longer meant to be committed.
- `home-v66-41.png` remains a local untracked screenshot and should not be staged unless Elie explicitly asks for it.

## Media Architecture

- Public media belongs in Cloudflare R2/CDN as baked, strong-watermark previews only.
- Private developed masters may live in private R2 later. RAW/DNG/NEF originals stay off public/private cloud storage and remain on Elie's computers and backup drives.
- Reserve is no longer a cloud/user-facing state. Locally, `assets/reserve` remains an ignored preview cache for importer, review, and handoff compatibility.
- Hidden is a blacklist/review state, not a physical folder contract. Re-promote means removing IDs from the blacklist; permanent deletion from R2 should be an explicit Owner action later.
- Current GitHub Pages pages resolve images through `media-config.js` and each photo's `media.publicPreview` key.
- Public R2 sync inventories skip IDs from `assets/hidden/hidden-blacklist.json`; private developed masters remain eligible unless Elie explicitly runs the Owner wipe/delete flow.

## R2 Upload Status

- Running public and private upload lanes in parallel caused Cloudflare `429 Too Many Requests` responses and then Wrangler OAuth/token errors.
- `scripts/sync_r2_media.py` now has a shared throttle file, longer retry/backoff behavior, and safer defaults.
- The operating rule is now: run one R2 lane at a time. Public previews first, private masters later.
- Wrangler auth was refreshed and a one-file public upload probe succeeded.
- Public preview upload is currently running in tmux session `pbe-r2-public`.
- Current public upload log: `.review-logs/r2-public-upload-20260506-233645.log`
- The public lane resumed from `.review-logs/r2-upload-state.jsonl`; its current run started with 8,372 remaining public preview objects after 11,930 already-uploaded public objects were skipped from local state.
- Last checked progress during this summary pass: public upload was still running with zero failures and had passed `2625/8372`.
- A Codex automation named `Start private R2 after public upload` was created with id `start-private-r2-after-public-upload`.
- The automation starts checking on 2026-05-07 around 03:49 CEST, then hourly. It waits while public is still running, and starts private in tmux session `pbe-r2-private` only after public finishes.

## Recent UI Work

- Gallery titles now appear below thumbnails and wrap within the available card width without changing square photo framing.
- Detail purchase copy now says `Pick a resolution` and public-facing copy is focused on digital assets.
- Liked and basket rows now use each selected photo preview as a subtle low-opacity row background.
- Physical products remain out of the buyer flow for now; fulfillment is not ready.

## Owner Workflow

- Localhost owner actions remain local-only: H/U hiding, Hidden review, Unknown classification, metadata edits, and future R2 wipe/sync actions.
- Detail-page Title and Keywords edits should save to catalog metadata, local preview JPEGs, and resolvable developed source files.
- Return/Enter in metadata fields should save and exit focus so arrow navigation can continue immediately.
- Hidden page P should remove IDs from the hidden blacklist, not move files to a Reserve state.
- Owner metadata saves now queue a background task that re-uploads changed previews/source masters to R2 and reports quiet progress on `owner.html`; hidden photos do not re-upload public preview objects while blacklisted.

## Backlog Snapshot

The living backlog is in `TODO.md`. Highest-priority work now centers on:

1. Let the public R2 preview upload finish and verify the live public bucket.
2. Let the automation start private master upload only after public finishes.
3. Confirm GitHub Pages renders cleanly from R2/CDN once public previews are available.
4. Verify hidden blacklist publication in the live public bucket/site, then use Owner wipe only for deliberate public-preview deletion.
5. Retest owner metadata persistence/background R2 resync after the current public lane quiets down.
6. Keep importer and upload rules aligned with the no-RAW-cloud policy.
