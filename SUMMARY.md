# Conversation Summary

Date: 2026-05-10

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v71.17`
- Analyzed catalog contains `10,133` photos; public Expo publishes `5,792` eligible cloud-backed previews after blocked exclusions, not a capped sample.
- Current Expo catalog counts: France `324`, USA `158`, Spain `169`, Mexico `2`, AI/Leonardo `4,920`, Portugal `217`, Slovakia `2`, Unknown `0`.
- Public preview storage is flat and country-free: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Country, provenance, legacy key references, private master keys, and private render keys live in tracked metadata, especially `assets/media-sidecar.json`.
- Owner Current state is intentionally simple: `10,133` analyzed, `4,341` blocked, and `5,792` Expo photos. The earlier extra `18` stale local blocked records were removed from the local ignored Owner state.
- Private delivery manifest is tracked at `assets/private-delivery-manifest.json`; the Owner R2 coverage panel now reports active-catalog coverage against the `5,792` Expo photos and excludes blocked photos from the repair target.
- `assets/discarded-media-manifest.json` is the tracked generated cleanup record. It is currently being touched by the active cloud sweep, so do not hand-edit or stage it mid-run.
- A lock-guarded cloud media sweep is active from Owner Fix it (`scripts/run_cloud_media_sweep.zsh --push`); use the Owner progress panel or `.review-logs/cloud-media-sweep-resume-20260510-112138.log` to monitor it rather than starting a second uploader.

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
- Owner-blocked/discarded photos are tombstoned: delete their R2 bytes, keep their IDs as permanent do-not-resurrect records.
- Uploaded masters, private render triplets, and public previews are treated as immutable media objects after upload. Normal Owner metadata/country edits mutate manifests/catalogs only; future Lightroom-style XMP sidecar saves should be an explicit Owner maintenance button.

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
- The old Expo cap is retired. The public catalog should include all eligible cloud-backed previews unless a photo is blocked/discarded or otherwise ineligible.
- Discard is stronger than block: discarded photos should disappear from paid storage while their tombstone remains tracked.
- Large R2 operations should be resumable, one active sweep at a time, and checkpointed through Git.
- Payment comes before buyer accounts. Guest checkout remains the first payment path.
- Real Stripe Checkout is wired in code, but live payments are not ready until Stripe account setup, Worker secrets, webhook registration, and test-mode checkout flows are verified.
- Stripe test mode should cover successful payment, 3D Secure/authentication-required payment, and declined-card payment before live keys are considered.

## This Conversation

- We chose Stripe as the next business step instead of starting with user accounts.
- The Worker now selects real Stripe when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured, while preserving mock Stripe for local development.
- Browser checkout now redirects to hosted Stripe Checkout when the Worker returns `provider: "stripe"`.
- Public checkout/order copy was changed from mock-only language to Stripe-capable language, and the visible build moved through `v69.1`; current local docs now show `v71.17`.
- Stripe docs were checked for hosted Checkout Sessions, raw-body webhook signature verification, and test cards.
- Confirmed that Stripe offers test card numbers, including the standard successful Visa test card `4242 4242 4242 4242`.
- Current practical next step is to create/sign into Stripe on the Mac, then configure test-mode Worker secrets and webhook endpoint.
- Commit pushed for the Stripe wiring: `f0e1746 photosbyelie: wire Stripe checkout`.
- The Owner dashboard was tightened while the private backfill sweep ran: Sign out moved to the header, the Owner hero was reduced to a compact heading, Blocked and Blocked sync were grouped together, dark-mode header buttons were made more visible, and the R2 sweep card now uses stacked progress bars.
- The active sweep progress bar now uses active-catalog coverage instead of adding live log progress to checkpointed manifest missing counts. The earlier `13,615`-style denominator was a moving target caused by double-counting across two live signals.
- Started the pre-launch translation promise while avoiding media-pipeline changes: public-facing pages now share an English/French/Spanish translation layer for navigation, homepage copy, gallery filters/statuses, detail actions, basket/liked flows, and order-status copy. Owner-only tooling remains English-only for now.
- Owner language stays English-only; pressing the language button in Owner gives a small beep instead of pretending to switch languages.
- Owner password protection was removed for localhost use; the local helper server is the gate for mutation endpoints.
- Hidden language was renamed to Blocked throughout the Owner flow, and the `X` key is accepted as the curation shortcut to block a photo.
- The Owner counts panel was simplified after cleaning stale records: Analyzed / Blocked / Expo, with Expo styled green.
- The Owner page now refreshes several panels in place, including Current state, R2 catalog coverage, and R2 background work.
- During cloud upload, Owner can preview the last uploaded photo directly from the file already being uploaded, without re-downloading it.
- Local duplicate cleanup for AI/upscaled files was explored; when near-duplicate source/upscale sets appear, keep the upscaled image and remove the lower-resolution original from the sellable set.
- Owner metadata and country edits are now manifest-only. Uploaded masters, private render triplets, and public previews should not be rewritten after upload; optional Lightroom-style XMP sidecar writing belongs behind an explicit Owner button.

## Verification

- `npm test` passed after the sweep/automation tooling changes.
- `npm run validate` passed in external media mode.
- The private delivery sync probe uploaded live private render triplets and moved the manifest count upward before the automation wrapper was added.
- Discard cleanup deleted the current discarded public preview objects from R2 and recorded the tombstones in `assets/discarded-media-manifest.json`.
- Stripe wiring verification passed with `node --test worker/checkout-worker.test.mjs` (`10/10`) and `npm run validate`.
- Translation verification passed through browser smoke checks on home, France gallery, basket, liked, and order pages with no console/page errors.

## Fresh Backlog

1. **Verify every zippable deliverable is in private R2.** Drive private master and JPG 1/3/6 MP delivery coverage to complete active-catalog coverage, then spot-check ZIP build inputs.
2. **Continue Owner curation/blocking.** Review remaining visible photos and block anything that should not be sold before payment testing starts.
3. **Add gallery search.** Search public galleries and Owner review surfaces by title and keywords first, with filename/country/description as secondary signals.
4. **Add collection-wide keyword removal.** Let Owner remove one keyword from an entire collection with before/after counts and a confirmation preview.
5. **Make discard lifecycle first-class in Owner.** Add a clear discard action that deletes public/private R2 bytes while keeping durable tombstones.
6. **Add Owner price-list maintenance.** Move product prices into an Owner-maintained list that publishes cleanly to the Worker/public basket.
7. **Add optional Owner XMP sidecar save.** Add a deliberate maintenance button for writing Lightroom-style sidecars beside masters from manifest metadata.
8. **Set up Stripe test mode.** Configure test secrets, webhook endpoint, and Worker environment.
9. **Run Stripe test checkout end to end.** Cover success, 3D Secure, declined payment, webhook paid transition, ZIP build, and download.
10. **Make order records production-durable.** Decide D1 vs KV and store queryable order state.
11. **Harden Owner identity path.** Keep localhost helper behavior clear and decide production Owner identity.
12. **Move public preview serving off the checkout Worker bridge.** Attach an R2 custom domain or equivalent media endpoint.
13. **Design buyer accounts after guest checkout works.** Model saved orders, re-downloads, email verification, and recovery.
14. **Split homepage data from the full catalog.** Serve a small homepage manifest instead of all `5,792` Expo photo records.
15. **Split gallery/catalog data by collection.** Load only the current collection catalog on gallery pages.
16. **Harden browser smoke coverage.** Cover public flows, language toggles, Owner block/discard, Unknown assignment, and large-catalog performance.
17. **Extend Owner dashboard.** Surface latest sweep result and a guided ingest/classify/block/validate/publish flow.
18. **Keep publish validation as the gate.** Strengthen manifest parity, exclusion, and payload-size checks.
19. **Repair and refresh architecture artifacts.** Update source-of-truth diagrams after media/payment decisions settle.
20. **Backburner: repo layout cleanup.** Revisit folder structure after media/payment paths stabilize.
