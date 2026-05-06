# Photos By Elie TODO

Last updated: 2026-05-07

## Current Facts

- Local visible build: `v66.49`.
- Public GitHub Pages build before this push: `v66.37`.
- Public catalog validates in external media mode with 503 photos: AI 100, France 100, Portugal 100, Spain 100, USA 100, Slovakia 2, Mexico 1.
- Git should carry code, docs, generated metadata, and tiny shared assets. Public preview JPGs should not be committed.
- Public previews should live on R2/CDN as baked, strong-watermark files only.
- RAW/DNG/NEF files stay off public and private cloud storage. If a buyer wants RAW, they contact Elie directly.
- Hidden is a blacklist/review state, not a media folder contract. Re-promote means removing the ID from the blacklist.
- Future public R2 sync inventories now skip IDs in `assets/hidden/hidden-blacklist.json`; private developed masters remain eligible unless Elie explicitly wipes them.
- Owner metadata saves update catalog/local files and queue background R2 sync, while hidden photos are kept out of public-preview re-uploads.
- `assets/reserve` remains an ignored local preview cache for importer/review compatibility, not a long-term public state.
- R2 upload journals are resumable. Cloudflare throttled parallel public/private uploads with `429 Too Many Requests`, so large R2 syncs should run one lane at a time.
- Public preview upload is running in tmux session `pbe-r2-public`, logging to `.review-logs/r2-public-upload-20260506-233645.log`.
- A Codex automation, `start-private-r2-after-public-upload`, will check hourly after its first run and start private upload only after public finishes.

## Fresh Numbered Backlog

1. **Let public R2 previews finish and verify them.**
   - [Codex] Monitor `pbe-r2-public` / `.review-logs/r2-public-upload-20260506-233645.log` until the public lane finishes.
   - [Codex] Confirm the public lane ends with zero failed uploads or rerun the same public resume command until clean.
   - [Codex] Re-check `photosbyelie-public` directly through Wrangler/API after the lane finishes.
   - [Codex] Confirm whether any old permissive-watermark public previews remain in R2.
   - [Elie] Keep using the Cloudflare dashboard as the manual visual source of truth while bucket access settles.

2. **Start private R2 masters only after public is done.**
   - [Codex] Let automation `start-private-r2-after-public-upload` wait on public and start `pbe-r2-private`.
   - [Codex] If automation cannot start private, run `python3 scripts/sync_r2_media.py --scope private --upload --workers 2 --request-min-interval 1.5`.
   - [Codex] Keep the private upload single-lane and resumable through `.review-logs/r2-upload-state.jsonl`.
   - [Codex] Verify `photosbyelie-private` after the private lane completes.

3. **Finish the safe public-media pipeline.**
   - [Codex] Ensure every public preview is generated with the stronger repeated anti-theft watermark at the reduced opacity Elie approved.
   - [Codex] Keep R2 upload scripts from uploading RAW/DNG/NEF-derived previews.
   - [Codex] Add a live R2 inventory check before declaring public media complete.
   - [Codex] Add a no-secrets setup note for Cloudflare account ID, bucket names, API token, and media base URL.

4. **Cleanly separate GitHub metadata from media hosting.**
   - [Codex] Keep `photos-data.js`, `assets/expo-manifest.json`, `media-config.js`, code, and docs tracked.
   - [Codex] Keep public preview JPGs out of Git and validate with `node scripts/validate_publish.js --external-media --summary`.
   - [Codex] Confirm GitHub Pages can render from R2/CDN public media keys after each publish.
   - [Codex] Watch GitHub upload size so pushes stay small and boring.

5. **Repair and document the importer around developed files only.**
   - [Codex] Confirm `scripts/build_lightroom_thumbnails.py` scans only JPG/JPEG/TIF/TIFF developed exports.
   - [Codex] Preserve Camera green label/rating 4+ selection and Leonardo forced-AI import.
   - [Codex] Keep RAW/DNG/NEF as owner-local source evidence only, not upload candidates.
   - [Codex] Add importer tests or at least deterministic dry-run output for skipped RAW files.

6. **Publish hidden state as a blacklist.**
   - [Done] Make H hide by updating local/public blacklist state, not moving preview files.
   - [Done] Make U undo the most recent hide by removing it from the blacklist.
   - [Done] Make Hidden page P re-promote by removing IDs from the blacklist.
   - [Done] Add an Owner-only action to permanently wipe hidden public-preview objects from R2 when Elie explicitly chooses that.
   - [Done] Ensure public pages load and apply the hidden blacklist.
   - [Done] Ensure future public media syncs skip hidden blacklist IDs instead of re-uploading hidden previews.
   - [Codex] After the current public upload is done or rerun, verify the live bucket/site state and wipe any already-uploaded hidden previews if needed.

7. **Finish owner metadata persistence and sync.**
   - [Done] Keep Return/Enter in Title or Keywords saving metadata and exiting edit focus.
   - [Done] Save metadata to the generated catalog, local preview JPEGs, and resolvable developed source files.
   - [Done] Add a background owner task to re-upload changed previews/source masters to R2.
   - [Done] Show quiet progress/status for that background metadata sync on `owner.html`.
   - [Done] Avoid re-uploading public previews for photos that are currently hidden; keep private/source metadata sync eligible.
   - [Codex] Keep any screen-scrape fallback owner-only, and avoid using it unless local files truly are missing.

8. **Retest local owner review UX.**
   - [Codex] Check gallery selection, Enter detail navigation, double-click detail navigation, H/U, and hidden re-promote on localhost.
   - [Codex] Check Unknown classification behavior and confirm same-day assignment still refreshes hints.
   - [Codex] Remove obsolete Reserve wording from visible owner UI as it appears.

9. **Continue checkout architecture only after media is stable.**
    - [Elie] Finish Stripe account setup when ready.
    - [Codex] Keep checkout in static/email-intent mode until public media, hidden blacklist, and owner sync are trustworthy.
    - [Codex] Later prototype a small Worker for Stripe webhook receipt, order lookup, signed delivery links, and one-download-per-hour throttling.

10. **Keep documentation current.**
    - [Codex] Update `README.md`, `scripts/README.md`, `SUMMARY.md`, and this file whenever the media contract changes.
    - [Codex] Convert architecture notes into a short migration SOP once R2 auth and public media URLs are settled.
    - [Codex] Keep the public/local boundary explicit in docs and validation.

## Completed In v66.49

- Added gallery titles below collection thumbnails without changing the square image framing.
- Simplified the detail-page purchase panel to `Pick a resolution` and kept public product language focused on digital assets.
- Strengthened liked/basket row backgrounds so each selected asset uses its preview as a subtle low-opacity backdrop.
