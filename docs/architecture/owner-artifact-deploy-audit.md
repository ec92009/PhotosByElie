# Owner Artifact Deploy Audit

Date: 2026-06-13

## Scope

This audit checked the deployed GitHub Pages/custom-domain surface for Owner-private title/keyword review artifacts and obvious secret exposure.

Owner workflow source-of-truth rules remain:

- `assets/owner-actions/Owner.sqlite` is the ignored durable local Owner state database.
- `assets/catalog/photosbyelie.sqlite` is the public deployable catalog database.
- JSON under `assets/owner-actions/title-keyword-review-queue/` is derived localhost review-page or audit output only; it is compatibility data, not durable public catalog state.

## Findings

- `https://photos-by-elie.com/assets/owner-actions/title-keyword-review-queue/latest.json` returned HTTP 200 and contained title/keyword review queue JSON.
- `https://photos-by-elie.com/assets/owner-actions/title-keyword-review-queue/batch-2026-05-24-000237-818Z.json` returned HTTP 200 and contained title/keyword review queue JSON.
- `https://photos-by-elie.com/assets/owner-actions/Owner.sqlite` returned HTTP 404.
- `https://photos-by-elie.com/assets/owner-actions/Owner.sqlite-wal` returned HTTP 404.
- `https://photos-by-elie.com/assets/owner-actions/real-estate-clients.local.json` returned HTTP 404.
- `https://photos-by-elie.com/.env`, `https://photos-by-elie.com/.env.stripe-test.local`, and `https://photos-by-elie.com/worker/.dev.vars` returned HTTP 404.
- Root HTML, the exposed review JSON probes, and the checked sensitive-file paths did not match obvious Stripe, webhook, API-token, cloud-key, GitHub-token, Slack-token, or private-key patterns.

## Remediation

The two tracked title/keyword review JSON files were removed from the Git index while leaving local ignored copies on disk for localhost Owner workflows:

- `assets/owner-actions/title-keyword-review-queue/latest.json`
- `assets/owner-actions/title-keyword-review-queue/batch-2026-05-24-000237-818Z.json`

The existing `.gitignore` rule keeps future title/keyword review queue JSON out of Git:

```gitignore
assets/owner-actions/title-keyword-review-queue/*.json
assets/owner-actions/title-keyword-review-queue/proposed-state.json
```

## Verification

After this remediation is pushed and GitHub Pages completes deployment, the expected result is HTTP 404 for both title/keyword review queue JSON URLs above. Localhost Owner review can still use the ignored JSON fallback or the helper endpoint, with `Owner.sqlite` as durable state.
