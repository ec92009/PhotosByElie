# Photos By Elie TODO

Last updated: 2026-05-06

## Current Facts

- Local visible build: `v66.49`.
- Public GitHub Pages build before this push: `v66.37`.
- Public catalog validates in external media mode with 503 photos: AI 100, France 100, Portugal 100, Spain 100, USA 100, Slovakia 2, Mexico 1.
- Git should carry code, docs, generated metadata, and tiny shared assets. Public preview JPGs should not be committed.
- Public previews should live on R2/CDN as baked, strong-watermark files only.
- RAW/DNG/NEF files stay off public and private cloud storage. If a buyer wants RAW, they contact Elie directly.
- Hidden is a blacklist/review state, not a media folder contract. Re-promote means removing the ID from the blacklist.
- `assets/reserve` remains an ignored local preview cache for importer/review compatibility, not a long-term public state.
- R2 upload journals are resumable. Cloudflare throttled parallel public/private uploads with `429 Too Many Requests`, so large R2 syncs should run one lane at a time.

## Fresh Numbered Backlog

1. **Verify live R2 state and access.**
   - [Codex] Re-check `photosbyelie-public` and `photosbyelie-private` directly through Wrangler/API once Cloudflare credentials are available in the shell.
   - [Codex] Confirm whether any old permissive-watermark public previews remain in R2.
   - [Elie] Keep using the Cloudflare dashboard as the manual source of truth until the local token path is stable.
   - [Codex] Add a no-secrets `.env.example` or setup note for Cloudflare account ID, bucket names, API token, and media base URL.

2. **Finish the safe public-media pipeline.**
   - [Codex] Ensure every public preview is generated with the stronger repeated anti-theft watermark at the reduced opacity Elie approved.
   - [Codex] Keep R2 upload scripts from uploading RAW/DNG/NEF-derived previews.
   - [Codex] Upload only the intended public preview set after a dry-run count and sample review.
   - [Codex] Run public previews before private masters so the visible website improves first and Cloudflare rate limits stay calm.
   - [Codex] Keep local journals for uploads/deletes, but add a live R2 inventory check before declaring success.

3. **Cleanly separate GitHub metadata from media hosting.**
   - [Codex] Keep `photos-data.js`, `assets/expo-manifest.json`, `media-config.js`, code, and docs tracked.
   - [Codex] Keep public preview JPGs out of Git and validate with `node scripts/validate_publish.js --external-media --summary`.
   - [Codex] Confirm GitHub Pages can render from R2/CDN public media keys after each publish.
   - [Codex] Watch GitHub upload size so pushes stay small and boring.

4. **Repair and document the importer around developed files only.**
   - [Codex] Confirm `scripts/build_lightroom_thumbnails.py` scans only JPG/JPEG/TIF/TIFF developed exports.
   - [Codex] Preserve Camera green label/rating 4+ selection and Leonardo forced-AI import.
   - [Codex] Keep RAW/DNG/NEF as owner-local source evidence only, not upload candidates.
   - [Codex] Add importer tests or at least deterministic dry-run output for skipped RAW files.

5. **Publish hidden state as a blacklist.**
   - [Codex] Make H hide by updating local/public blacklist state, not moving preview files.
   - [Codex] Make U undo the most recent hide by removing it from the blacklist.
   - [Codex] Make Hidden page P re-promote by removing IDs from the blacklist.
   - [Codex] Add an Owner-only action to permanently wipe hidden objects from R2 when Elie explicitly chooses that.
   - [Codex] Ensure public pages and public media sync both respect the hidden blacklist.

6. **Finish owner metadata persistence and sync.**
   - [Codex] Keep Return/Enter in Title or Keywords saving metadata and exiting edit focus.
   - [Codex] Save metadata to the generated catalog, local preview JPEGs, and resolvable developed source files.
   - [Codex] Add a background owner task to re-upload changed previews/source masters to R2.
   - [Codex] Show quiet progress/status for that background metadata sync on `owner.html`.
   - [Codex] Keep any screen-scrape fallback owner-only, and avoid using it unless local files truly are missing.

7. **Retest local owner review UX.**
   - [Codex] Check gallery selection, Enter detail navigation, double-click detail navigation, H/U, and hidden re-promote on localhost.
   - [Codex] Check Unknown classification behavior and confirm same-day assignment still refreshes hints.
   - [Codex] Remove obsolete Reserve wording from visible owner UI as it appears.

8. **Continue checkout architecture only after media is stable.**
    - [Elie] Finish Stripe account setup when ready.
    - [Codex] Keep checkout in static/email-intent mode until public media, hidden blacklist, and owner sync are trustworthy.
    - [Codex] Later prototype a small Worker for Stripe webhook receipt, order lookup, signed delivery links, and one-download-per-hour throttling.

9. **Keep documentation current.**
    - [Codex] Update `README.md`, `scripts/README.md`, `SUMMARY.md`, and this file whenever the media contract changes.
    - [Codex] Convert architecture notes into a short migration SOP once R2 auth and public media URLs are settled.
    - [Codex] Keep the public/local boundary explicit in docs and validation.

## Completed In v66.49

- Added gallery titles below collection thumbnails without changing the square image framing.
- Simplified the detail-page purchase panel to `Pick a resolution` and kept public product language focused on digital assets.
- Strengthened liked/basket row backgrounds so each selected asset uses its preview as a subtle low-opacity backdrop.
