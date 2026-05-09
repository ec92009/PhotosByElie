# Photos By Elie TODO

Last updated: 2026-05-09

## Current Facts

- Local visible build: `v70.5`.
- Public catalog validates in external media mode with `10,123` photos: France `320`, USA `160`, Spain `169`, Mexico `2`, AI/Leonardo `9,253`, Portugal `217`, Slovakia `2`.
- The Expo cap is retired. Publish all eligible cloud-backed previews unless hidden/discarded or explicitly ineligible.
- Public previews are watermarked and public under flat R2 keys: `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`.
- Buyer deliverables are private and unwatermarked: full developed sources under `masters/...`, JPG 1/3/6 MP files under `renders/...`.
- RAW files are not for the public site or cloud storage. Developed sources only.
- Saturn is the upstream source for new developed photos:
  - Camera: `/Volumes/Saturn/Pictures/LR/Camera`
  - Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- Reserve is only an ignored local import/preview cache. It is not a long-term review state.
- Hidden/discarded photos are tombstoned. Their R2 media should be deleted for cost control, while the tombstone stays tracked so Saturn imports do not resurrect them.
- Daily automation `photosbyelie-daily-cloud-media-sweep` runs through `zsh -lc` to source `~/.zshrc` credentials and uses `.review-logs/cloud-media-sweep.lock` to prevent concurrent sweeps.
- Local Owner mutation endpoints now require an authenticated owner session. `scripts/local_server.py` reads `PHOTOSBYELIE_OWNER_PASSWORD` or `PBE_OWNER_PASSWORD`, or prints a one-time code for the current server run.
- Current R2 coverage panel shows `10,151` private master IDs for `10,123` catalog photos, `618` private JPG 1/3/6 MP files per tier, and complete `10,123` low/high public preview coverage. The cloud media sweep should close the private render gap and refresh any stale extra-master inventory.
- Checkout remains guest-first and USD-only. Real Stripe is wired behind Worker configuration, but live payments are blocked until Stripe account setup, Worker secrets, webhook registration, and test-mode checkout verification are complete.

## Numbered Backlog

1. **Set up Stripe test mode.**
   - Create/sign into the Stripe account from the Mac.
   - Configure Worker secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - Add the Stripe webhook endpoint for `/stripe-webhook`.
   - Keep live keys out until test mode proves the full flow.

2. **Run Stripe test checkout end to end.**
   - Test successful payment.
   - Test 3D Secure/authentication-required payment.
   - Test declined-card payment.
   - Confirm Stripe receipt/payment state stays separate from PhotosByElie delivery links.

3. **Confirm paid fulfillment.**
   - Confirm a verified `checkout.session.completed` webhook marks the order paid.
   - Confirm the Worker builds the ZIP from private R2.
   - Confirm the order page shows the download when delivery is ready.
   - Confirm failed delivery is visible and recoverable.

4. **Make order records production-durable.**
   - Choose D1 vs KV for production order state, with D1 likely for queryable order records.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, ZIP key, and download timing.
   - Keep private R2 as delivery ZIP storage.
   - Rate-limit download links.

5. **Watch the active cloud media sweep.**
   - Confirm the manual run finishes without colliding with the scheduled 03:30 automation.
   - Confirm it commits/pushes final manifest changes.
   - Record final counts for new Saturn candidates, uploaded public previews, private masters, private render triplets, skipped discarded photos, and failures.

6. **Finish private delivery backfill.**
   - Drive `assets/private-delivery-manifest.json` to full non-discarded catalog coverage.
   - Keep Camera and Leonardo in the same backfill path.
   - Ensure missing local sources are reported cleanly.
   - Confirm every checkout-eligible photo has private full/JPG 6/JPG 3/JPG 1 MP delivery objects.

7. **Make discard lifecycle first-class in Owner.**
   - Add an explicit Owner discard action separate from temporary hide/review.
   - Create durable tombstones for discarded IDs.
   - Delete matching public previews, private masters, and private render JPGs from R2.
   - Keep tombstones in import/export validation so discarded photos cannot return from Saturn.
   - Show discard/delete counts in Owner so bulk quality/duplicate cleanup feels trustworthy.

8. **Harden owner account/auth.**
   - Keep the new localhost owner session as the current protection for local catalog/R2 actions.
   - Decide whether production Owner should use Cloudflare Access, a Worker-backed login, or another identity layer.
   - Add clear confirmation around future discard/R2 delete actions.
   - Add browser smoke coverage for locked, login, logout, and unauthorized mutation states.

9. **Move public media off the checkout Worker bridge.**
   - Attach an R2 custom domain or equivalent public media endpoint.
   - Update `media-config.js`.
   - Retest GitHub Pages gallery/detail/basket media loading.
   - Keep the Worker focused on checkout/order/delivery, not public thumbnail serving.

10. **Design buyer accounts.**
   - Decide whether buyer accounts are optional convenience after guest checkout.
   - Model saved order lookup, re-downloads, email verification, and basic account recovery.
   - Keep guest checkout low-friction.

11. **Harden browser smoke coverage.**
   - Cover gallery grid/fill/fit controls, sorting, filters, detail navigation, likes, basket, checkout, order status, and ZIP download path.
   - Cover Owner hide/discard, Unknown assignment, metadata save feedback, and failed-action recovery.
   - Keep public and localhost-only behaviors separate in tests.

12. **Extend Owner dashboard.**
   - Keep dense counts for catalog, private delivery coverage, discarded tombstones, hidden queue, unknown queue, and active sweep status.
   - Surface the latest automation/sweep result.
   - Make destructive actions legible before they run.

13. **Keep publish validation as the gate.**
   - Validate hidden/discarded exclusions.
   - Validate public preview to private delivery parity.
   - Validate sidecar/private-delivery/discarded-media manifests.
   - Keep `npm run validate` mandatory before publish.

14. **Repair and refresh architecture artifacts.**
   - Fix the known page 4 text collision in the architecture PDF.
   - Refresh diagrams after account/auth/payment decisions settle.

15. **Backburner: repo layout cleanup.**
   - Keep root HTML files while GitHub Pages serves from repo root.
   - Revisit `site/`, `public/`, `js/`, or `css/` structure after media/payment paths stabilize.

## Completed Recently

- Retired the Expo cap and promoted the full cloud-backed catalog.
- Flattened public R2 preview keys.
- Added `assets/media-sidecar.json` provenance for public/private key mapping.
- Added `assets/private-delivery-manifest.json`.
- Added `assets/discarded-media-manifest.json`.
- Added private delivery backfill tooling.
- Added discarded-media R2 cleanup tooling.
- Added daily cloud media sweep automation with lock-guarded wrapper.
- Started a manual cloud media sweep with the same wrapper used by automation.
- Added localhost Owner login/session gating for catalog, metadata, Hidden, Unknown, R2 progress, and R2 action endpoints.
- Added Owner R2 coverage counts with a repair button that starts the lock-guarded cloud media sweep.
- Wired real Stripe Checkout and webhook verification behind Worker configuration.
