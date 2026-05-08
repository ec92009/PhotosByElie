# Conversation Summary

Date: 2026-05-08

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v67.25`
- Public catalog now publishes all eligible cloud-backed previews, not a capped sample: `10,123` catalog photos.
- Current catalog counts: France `320`, USA `160`, Spain `169`, Mexico `2`, AI/Leonardo `9,253`, Portugal `217`, Slovakia `2`, Unknown `0`.
- Public preview storage is flat and country-free: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Country, provenance, legacy key references, private master keys, and private render keys live in tracked metadata, especially `assets/media-sidecar.json`.
- Private delivery manifest is tracked at `assets/private-delivery-manifest.json`; current counts are `10,151` private master photo IDs and `624` complete private JPG 1/3/6 MP render triplets.
- Discarded-media tombstones are tracked at `assets/discarded-media-manifest.json`. Current discarded count is `18` photo IDs; those IDs are banned from re-import and their R2 objects are deleted for cost control.
- A long cloud media sweep is currently running via `scripts/run_cloud_media_sweep.zsh --push` under `.review-logs/cloud-media-sweep.lock`. The scheduled automation uses the same lock and will exit if this run is still alive.

## Media Contract

- Public previews are watermarked and public.
- Buyer deliverables are private and unwatermarked.
- Private developed sources are stored under `photosbyelie-private/masters/<photo-id>/<original-file>`.
- Private buyer JPG deliverables are stored under:
  - `renders/<photo-id>/<original-file>-jpg-6mp.jpg`
  - `renders/<photo-id>/<original-file>-jpg-3mp.jpg`
  - `renders/<photo-id>/<original-file>-jpg-1mp.jpg`
- RAW files are out of scope for public display and cloud storage. The working rule is developed sources only.
- Saturn is the steady-state source of truth for new developed photos. The catalog is a repair/backfill input only when the repo and cloud are temporarily out of sync.
- Camera imports scan `/Volumes/Saturn/Pictures/LR/Camera`.
- Leonardo/AI imports scan `/Volumes/Saturn/Pictures/LR/_All Leonardo`.
- Owner-hidden/discarded photos are tombstoned: delete their R2 bytes, keep their IDs as permanent do-not-resurrect records.

## Automation

- Automation: `photosbyelie-daily-cloud-media-sweep`
- Schedule: daily at 03:30 local automation time.
- It runs `zsh -lc './scripts/run_cloud_media_sweep.zsh --push'` so credentials from `~/.zshrc` are available.
- The wrapper uses `.review-logs/cloud-media-sweep.lock`; if a prior sweep is active, the scheduled run exits without starting a second uploader.
- The sweep:
  1. Pulls latest `main`.
  2. Deletes R2 media for discarded tombstones.
  3. Scans Saturn Camera and Leonardo developed-source folders.
  4. Imports/uploads only non-discarded candidates.
  5. Regenerates `photos-data.js`, `worker/photos-catalog.generated.mjs`, `assets/media-sidecar.json`, and private delivery manifests.
  6. Backfills missing private 1/3/6 MP render triplets.
  7. Deletes discarded R2 media again.
  8. Runs `npm test` and `npm run validate`.
  9. Commits and pushes tracked metadata/code checkpoints.

## Recent Decisions

- Reserve is no longer a product/review concept. `assets/reserve` is only an ignored local preview/import cache.
- The old Expo cap is retired. The public catalog should include all eligible cloud-backed previews unless a photo is hidden/discarded or otherwise ineligible.
- Discard is stronger than hide: discarded photos should disappear from paid storage while their tombstone remains tracked.
- Large R2 operations should be resumable, one active sweep at a time, and checkpointed through Git.
- Owner account, user accounts, and real payment are the next product discussion. Guest checkout remains the first payment path.

## Verification

- `npm test` passed after the sweep/automation tooling changes.
- `npm run validate` passed in external media mode.
- The private delivery sync probe uploaded live private render triplets and moved the manifest count upward before the automation wrapper was added.
- Discard cleanup deleted the current discarded public preview objects from R2 and recorded the tombstones in `assets/discarded-media-manifest.json`.

## Fresh Backlog

1. **Watch the active cloud media sweep.** Confirm it finishes, commits, pushes, and reports final private render/backfill counts.
2. **Make discard lifecycle first-class in Owner.** Owner discard should create tombstones, delete public/private R2 bytes, update manifests, and keep the item banned from future Saturn imports.
3. **Finish private delivery backfill.** Drive private render triplets from `624` to full non-discarded catalog coverage.
4. **Move public preview serving off the checkout Worker bridge.** Attach an R2 custom domain or equivalent public media domain and update `media-config.js`.
5. **Add user/account model.** Decide guest-only vs optional buyer accounts, then model saved orders and re-download flows.
6. **Add Owner account/auth.** Protect owner tools beyond localhost-only assumptions before production payment.
7. **Replace mock Stripe.** Wire real Stripe Checkout and webhook verification behind the existing Worker boundary.
8. **Make order records durable for production.** Choose D1 vs KV for queryable order state; keep private R2 for delivery ZIPs.
9. **Harden browser smoke coverage.** Cover gallery controls, basket, checkout, order status, Owner hide/discard, and Unknown assignment.
10. **Repair architecture artifacts.** Fix the known page 4 text collision and refresh diagrams once account/payment decisions settle.
