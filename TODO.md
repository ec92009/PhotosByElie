# Photos By Elie TODO

Last updated: 2026-05-07

## Current Facts

- Local visible build: `v67.1`.
- Public catalog validates in external media mode with 503 photos: AI 100, France 100, Portugal 100, Spain 100, USA 100, Slovakia 2, Mexico 1.
- Git should carry code, docs, generated metadata, and tiny shared assets. Public preview JPGs should not be committed.
- Public previews should live on R2/CDN as baked, strong-watermark files only.
- RAW/DNG/NEF files stay off public and private cloud storage. If a buyer wants RAW, they contact Elie directly.
- Hidden is a blacklist/review state, not a media folder contract. Re-promote means removing the ID from the blacklist.
- Future public R2 sync inventories skip IDs in `assets/hidden/hidden-blacklist.json`; private developed masters remain eligible unless Elie explicitly wipes them.
- `assets/reserve` remains an ignored local preview cache for importer/review compatibility, not a long-term public state.
- R2 upload journals are resumable. Cloudflare throttled parallel public/private uploads with `429 Too Many Requests`, so large R2 syncs should run one lane at a time.
- Checkout architecture now has a Worker-track prototype in `worker/`, using mock Stripe and in-memory storage.
- Checkout v1 is USD-only and guest-first; accounts are optional convenience, not required payment friction.
- The architecture PDF now includes an MSC-style checkout/fulfillment page, but page 4 still has a known text-overlap defect.

## Fresh Numbered Backlog

1. **Finish public R2 previews and verify the live bucket.**
   - [Codex] Monitor `pbe-r2-public` / `.review-logs/r2-public-upload-20260506-233645.log` until the public lane finishes.
   - [Codex] Confirm the public lane ends with zero failed uploads or rerun the same public resume command until clean.
   - [Codex] Re-check `photosbyelie-public` directly through Wrangler/API after the lane finishes.
   - [Codex] Confirm whether any old permissive-watermark public previews remain in R2.
   - [Codex] Verify hidden-blacklist IDs are absent from the live public preview set or wipe them through an explicit Owner action.
   - [Codex] If classified Unknown objects already exist under old public keys, use `scripts/cleanup_classified_unknowns_public_r2.py` only after confirming no R2 upload lane is active.
   - [Codex] If Wrangler auth wobbles again, use `scripts/sync_r2_media.py --backend s3` with explicit R2 S3 credentials and a tiny `--limit 1` probe first.

2. **Start private R2 masters only after public is done.**
   - [Codex] Let automation `start-private-r2-after-public-upload` wait on public and start `pbe-r2-private`.
   - [Codex] If automation cannot start private, run `python3 scripts/sync_r2_media.py --scope private --upload --workers 2 --request-min-interval 1.5`.
   - [Codex] Keep the private upload single-lane and resumable through `.review-logs/r2-upload-state.jsonl`.
   - [Codex] Verify `photosbyelie-private` after the private lane completes.

3. **Wire the static basket to the Worker mock checkout flow.**
   - [Codex] Add bottom-of-basket checkout choice UI: `Pay as guest` and `Create account / sign in`.
   - [Codex] Keep guest checkout primary and account checkout secondary.
   - [Codex] Collect buyer email before mock checkout.
   - [Codex] Call `/checkout/guest` with the current basket and show the returned mock Stripe URL/order number.
   - [Codex] Add a small USD-only note: prices are in USD; buyer bank/card may convert locally.

4. **Make Worker storage durable.**
   - [Codex] Choose D1 vs KV for order records; current likely direction is D1 for queryable order state.
   - [Codex] Keep private R2 as the delivery ZIP location.
   - [Codex] Store order ID, buyer email, checkout session ID, payment intent ID, status, basket snapshot, expected/paid amount, ZIP key, and download timing.
   - [Codex] Keep download links rate-limited, starting with roughly one ZIP download per order per hour.

5. **Replace mock Stripe with real Stripe when account setup is ready.**
   - [Elie] Finish Stripe business, identity, tax, and bank onboarding.
   - [Codex] Add real Checkout Session creation behind the existing Stripe client interface.
   - [Codex] Add real webhook signature verification.
   - [Codex] Pass `client_reference_id`, `metadata.order_id`, buyer email, USD amount, and static receipt text with the order-portal URL.
   - [Codex] Keep Stripe receipts separate from PhotosByElie delivery emails/download links.

6. **Implement real delivery ZIP creation.**
   - [Codex] Replace mock delivery with R2/private master reads and ZIP creation.
   - [Codex] Decide whether ZIP creation runs synchronously in the Worker or through a queued/background flow for large orders.
   - [Codex] Preserve the current local `scripts/create_digital_delivery.py` as manual fallback until automated delivery is proven.
   - [Codex] Ensure the Worker never tries to deliver RAW/DNG/NEF originals.

7. **Add order lookup and delivery UX.**
   - [Codex] Add `/orders` buyer-facing page or static shell.
   - [Codex] Let guest buyers retrieve orders with order number plus email verification.
   - [Codex] Let account buyers see saved orders later, after guest checkout works.
   - [Codex] Show states: pending payment, preparing, ready, downloaded/rate-limited, failed/refunded.

8. **Keep checkout pricing conservative.**
   - [Codex] Keep all buyer-facing prices and Stripe amounts in USD for v1.
   - [Codex] Reject/ignore client-provided currency in the Worker.
   - [Codex] Recalculate prices server-side from the catalog before creating checkout.
   - [Codex] On webhook, require Stripe amount/currency to match the stored order before delivery.

9. **Repair and finalize architecture artifacts.**
   - [Codex] Fix the page 4 text collision in `photosbyelie-architecture-infographics.pdf`.
   - [Codex] Keep the new MSC page as page 8 and regenerate the PDF.
   - [Codex] Consider adding a second MSC later for real delivery ZIP creation if Worker/queue/R2 details change.

10. **Retest local owner and media workflows.**
    - [Codex] Check gallery selection, Enter detail navigation, double-click detail navigation, H/U, and hidden re-promote on localhost.
    - [Codex] Check Unknown classification behavior and confirm same-day assignment still refreshes hints.
    - [Codex] Retest owner metadata persistence/background R2 resync after the current public lane quiets down.
    - [Codex] Remove obsolete Reserve wording from visible owner UI as it appears.

11. **Keep documentation current.**
    - [Codex] Update `README.md`, `worker/README.md`, `scripts/README.md`, `SUMMARY.md`, and this file whenever the checkout or media contract changes.
    - [Codex] Convert architecture notes into a short migration SOP once R2 auth, Worker deployment, and public media URLs are settled.
    - [Codex] Keep the public/local/Worker boundaries explicit in docs and validation.

## Completed In This Session

- Added an MSC-style checkout/fulfillment infographic page.
- Rebuilt the architecture PDF as an 8-page deck.
- Added a mockable Worker checkout prototype with guest/account routes, mock Stripe, webhook handling, order lookup, delivery metadata, and download token rate limiting.
- Added Worker tests and documentation.
