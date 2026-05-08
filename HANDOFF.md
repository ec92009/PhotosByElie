# PhotosByElie Handoff

Use this when moving work between Max, David, or the laptop.

## Current Handoff: 2026-05-07 Night

- GitHub sync point: `df582dc photosbyelie: backlog repo layout cleanup`.
- Local `main` is clean and aligned with `origin/main` at this commit.
- Current visible build in `VERSION`: `v67.6`.
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local owner preview: `python3 scripts/local_server.py 8000`
- Public catalog validates in external media mode with 503 photos: AI 100, France 100, Portugal 100, Spain 100, USA 100, Slovakia 2, Mexico 1.
- Git carries code, docs, generated metadata, worker prototype, architecture artifacts, and tiny shared assets. Public preview JPGs remain out of Git.

## First Commands On The Laptop

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
node scripts/validate_publish.js --external-media --summary
python3 scripts/local_server.py 8000
```

Then open:

```text
http://localhost:8000/
http://localhost:8000/owner.html
```

If the laptop checkout path is lower-case instead, use:

```bash
cd /Users/ecohen/Dev/photosByElie
```

## Current Priority

1. Verify public R2 previews directly in the live bucket/CDN.
2. Resume or verify private R2 master upload; the latest private S3 log shows one failure.
3. Wire the static basket UI to the mock Worker checkout flow.
4. Keep checkout USD-only and guest-first.
5. Fix the page 4 text collision in the architecture PDF when the infographic deck matters again.

## R2 / Media State

- Public R2 upload originally failed through Wrangler because of OAuth/token errors.
- `scripts/sync_r2_media.py` now supports `--backend s3` as a fallback to Wrangler.
- Public S3 recovery logs:
  - `.review-logs/r2-public-s3-upload-20260507-203343.log`
  - `.review-logs/r2-public-s3-live-missing-fix-20260507-210437.log`
- The live-missing fix log reports:
  - live public objects before fix: 19,090
  - active public inventory: 20,274
  - missing objects re-uploaded: 1,213
  - failed count: 0
- Private S3 upload log:
  - `.review-logs/r2-private-s3-upload-20260507-143913.log`
  - final progress line shows `3890/3890 failed=1`.
- No tmux R2 upload sessions were running on the desktop at handoff time.
- `.review-logs/` is ignored by Git, so these logs may need machine-to-machine sync if you need exact local state on the laptop.

Useful S3 backend environment:

```bash
export R2_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
```

Safe dry-run/probe pattern:

```bash
python3 scripts/sync_r2_media.py --scope public --limit 1 --backend s3 --json
python3 scripts/sync_r2_media.py --scope private --limit 1 --backend s3 --json
```

Resume private only after confirming no other R2 writer is active:

```bash
python3 scripts/sync_r2_media.py \
  --scope private \
  --backend s3 \
  --upload \
  --workers 2 \
  --request-min-interval 1.5
```

If classified Unknown objects already exist under old public keys, use the tracked recovery tool only after confirming no upload lane is active:

```bash
python3 scripts/cleanup_classified_unknowns_public_r2.py --dry-run
```

## Checkout / Worker State

- Worker prototype lives in `worker/`.
- Stripe is mocked for now.
- Worker owns order ID, buyer email, USD total, basket snapshot, status, delivery ZIP metadata, and mock signed download tokens.
- Stripe track remains payment-only: Checkout Session, payment UI, receipt, and paid webhook.
- Routes currently implemented:
  - `GET /health`
  - `POST /checkout/guest`
  - `POST /checkout/account`
  - `POST /stripe-webhook`
  - `POST /mock-stripe/pay`
  - `GET /orders/:orderId?email=...`
  - `GET /download/:token`

Run Worker checks:

```bash
node --test worker/checkout-worker.test.mjs
node --check worker/checkout-worker.mjs
node --check worker/mock-stripe.mjs
node --check worker/memory-store.mjs
node --check worker/checkout-worker.test.mjs
```

Next Worker development item:

- Add the basket-bottom checkout choice UI.
- Collect buyer email.
- Call `/checkout/guest` with current basket.
- Show returned mock Stripe URL and order number.

## Architecture Artifacts

- `docs/architecture/infographics/photosbyelie-architecture-infographics.pdf` is now an 8-page PDF.
- New page 8 is `08-guest-checkout-msc.png`, an MSC-style checkout/fulfillment sequence chart.
- Known defect: page 4, Cloudflare R2 Storage, still has a text collision in the left card.

## Current Asset States

- `assets/expo/<country>/`: tiny tracked placeholders / publish metadata era leftovers; public JPGs should live in R2/CDN.
- `assets/reserve/<country>/`: ignored local preview cache for importer/review compatibility.
- `assets/hidden/<country>/`: ignored local Hidden review state.
- `assets/owner-actions/country-assignments.jsonl`: tracked append-only Unknown-to-country move log.
- `assets/owner-actions/country-assignments.json`: tracked latest-state index by photo ID.
- `assets/hidden/hidden-blacklist.json`: ignored local blacklist source; public sync skips hidden IDs.

## Unknown Country Moves

Unknown assignment is live, not staged in browser storage.

When a photo is assigned to a country from `unknown.html`, the local server should:

1. Move the chosen photo and same-day Unknown cohort out of Unknown.
2. Put the JPEG pairs under `assets/reserve/<country>/`.
3. Rewrite local reserve/catalog state and public generated metadata as needed.
4. Record every move in `assets/owner-actions/country-assignments.jsonl`.
5. Update the latest-state index in `assets/owner-actions/country-assignments.json`.

Do not rely on browser localStorage for country assignments.

## Local Asset Sync

Preferred handoff:

1. Pull tracked files through Git.
2. Sync ignored local vault assets separately only if needed:

```bash
python3 scripts/sync_local_assets.py david --apply --progress
python3 scripts/sync_local_assets.py max --apply --progress
```

Use the peer name for the mounted machine, or pass the peer repo path directly.

Leave `--delete` off unless intentionally mirroring removals.

## Cautions

- Do not commit exact GPS metadata unless explicitly intended.
- Do not commit `assets/reserve/**` or `assets/hidden/**`; they are local vault states.
- Do not commit `.review-logs/**`; sync logs manually only when needed.
- Do not re-run public/private R2 uploads concurrently.
- Use `--backend s3` if Wrangler auth wobbles again.
- Repo layout cleanup is on the backburner; keep root HTML files for now while GitHub Pages serves from repo root.
