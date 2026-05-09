# Conversation Summary

Date: 2026-05-08

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v70.9`
- Public catalog now publishes all eligible cloud-backed previews, not a capped sample: `10,123` catalog photos.
- Current catalog counts: France `320`, USA `160`, Spain `169`, Mexico `2`, AI/Leonardo `9,253`, Portugal `217`, Slovakia `2`, Unknown `0`.
- Public preview storage is flat and country-free: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Country, provenance, legacy key references, private master keys, and private render keys live in tracked metadata, especially `assets/media-sidecar.json`.
- Private delivery manifest is tracked at `assets/private-delivery-manifest.json`; the Owner R2 coverage panel currently reports `10,151` private master photo IDs for `10,123` catalog photos, `618` private JPG files per 1/3/6 MP tier, and complete `10,123` low/high public preview coverage.
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
- Payment comes before buyer accounts. Guest checkout remains the first payment path.
- Real Stripe Checkout is wired in code, but live payments are not ready until Stripe account setup, Worker secrets, webhook registration, and test-mode checkout flows are verified.
- Stripe test mode should cover successful payment, 3D Secure/authentication-required payment, and declined-card payment before live keys are considered.

## This Conversation

- We chose Stripe as the next business step instead of starting with user accounts.
- The Worker now selects real Stripe when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured, while preserving mock Stripe for local development.
- Browser checkout now redirects to hosted Stripe Checkout when the Worker returns `provider: "stripe"`.
- Public checkout/order copy was changed from mock-only language to Stripe-capable language, and the visible build moved through `v69.1`; current local docs now show `v70.9`.
- Stripe docs were checked for hosted Checkout Sessions, raw-body webhook signature verification, and test cards.
- Confirmed that Stripe offers test card numbers, including the standard successful Visa test card `4242 4242 4242 4242`.
- Current practical next step is to create/sign into Stripe on the Mac, then configure test-mode Worker secrets and webhook endpoint.
- Commit pushed for the Stripe wiring: `f0e1746 photosbyelie: wire Stripe checkout`.

## Verification

- `npm test` passed after the sweep/automation tooling changes.
- `npm run validate` passed in external media mode.
- The private delivery sync probe uploaded live private render triplets and moved the manifest count upward before the automation wrapper was added.
- Discard cleanup deleted the current discarded public preview objects from R2 and recorded the tombstones in `assets/discarded-media-manifest.json`.
- Stripe wiring verification passed with `node --test worker/checkout-worker.test.mjs` (`10/10`) and `npm run validate`.

## Fresh Backlog

1. **Set up Stripe test mode.** Create/sign into Stripe, collect the test secret key, create the `/stripe-webhook` endpoint, and record the webhook secret as a Worker secret.
2. **Run Stripe test checkout end to end.** Verify success, 3D Secure/authentication-required, and declined-card paths before any live keys.
3. **Confirm paid fulfillment.** Make sure a verified `checkout.session.completed` webhook marks the order paid, builds the ZIP from private R2, and shows the order download.
4. **Decide production order storage.** Choose whether KV is enough for launch or move queryable order records to D1 before live payments.
5. **Watch R2 coverage from Owner.** Use the coverage panel to confirm sweep output, commits, pushes, and final private render/backfill counts.
6. **Finish private delivery backfill.** Drive private JPG 1/3/6 MP coverage from the current partial coverage to full non-discarded catalog coverage.
7. **Make discard lifecycle first-class in Owner.** Owner discard should create tombstones, delete public/private R2 bytes, update manifests, and keep the item banned from future Saturn imports.
8. **Harden Owner account/auth.** Keep localhost owner login working, decide production Owner identity, and add browser coverage for locked/logout/unauthorized states.
9. **Move public preview serving off the checkout Worker bridge.** Attach an R2 custom domain or equivalent public media domain and update `media-config.js`.
10. **Design buyer accounts after guest checkout works.** Model saved orders, re-downloads, email verification, and recovery without slowing guest purchase.
11. **Harden browser smoke coverage.** Cover gallery controls, basket, Stripe checkout, order status, Owner hide/discard, and Unknown assignment.
12. **Repair architecture artifacts.** Fix the known page 4 text collision and refresh diagrams once account/payment decisions settle.
