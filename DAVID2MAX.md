# David to Max Automation Results

David should append automation results here. Keep newest entries near the top, below this note.

## Entry Format

```text
## YYYY-MM-DD Automation Name

- Machine:
- Repo:
- Commit checked:
- Result:
- Changes made:
- Commit pushed:
- Notes:
```

## 2026-05-13 Nightly Title/Keyword Review Queue

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `55ff85ef` (`git pull --ff-only origin main` was attempted first but DNS could not resolve `github.com`)
- Result: Generated the next nightly Owner title/keyword review batch from the newest 100 photos without `Title_Keywords_Reviewed`.
- Batch size: 100
- Newest photo/date: 2026-04-26T17:05:17
- Oldest photo/date: 2023-07-31T10:20:48
- Proposal file: `assets/owner-actions/title-keyword-review-queue/batch-2026-05-13.json`
- Review page: `title-keyword-review.html` (`http://localhost:8000/title-keyword-review.html` when served from the repo root)
- Skipped or needs_owner_context photos: 0 already reviewed; 0 `needs_owner_context`.
- Commit pushed: yes (`83270383`, pushed to `origin/main`).
- Validation: `npm test` passed (14/14); `npm run validate` passed.
- Notes: Local preview images are absent under `assets/expo`, and public R2 preview fetches failed DNS resolution, so no preview-pixel/vision pass was available in this run. Proposals used catalog/source-path/EXIF fallback only. Audit: every proposal has at least 10 keywords (minimum 11), proposed keywords have 0 blacklist hits, and 9 existing blacklisted `containing` keywords were excluded from proposals. The existing compact four-column Owner review page with bottom Save approvals and header back-to-top controls was preserved. No proposals were auto-applied, and no JPG/source metadata, public previews, private masters, or private render files were rewritten.

## 2026-05-12 Nightly Title/Keyword Review Queue

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `1be22c5d`
- Batch size: 100
- Newest photo/date: 2026-04-26T17:05:17
- Oldest photo/date: 2023-07-31T10:20:48
- Proposal file: `assets/owner-actions/title-keyword-review-queue/batch-2026-05-12.json`
- Review page: `title-keyword-review.html` (`http://localhost:8000/title-keyword-review.html`)
- Skipped or needs_owner_context photos: 0 already reviewed; 0 `needs_owner_context`.
- Commit pushed: yes (`2459d8ef`, pushed to `origin/main`).
- Notes: `git pull --ff-only origin main` failed before the run with DNS error `Could not resolve host: github.com`, but the later push succeeded. Local preview JPEGs were absent under `assets/expo`, and public preview fetches were unavailable during generation, so no preview-pixel/vision pass was available; proposals used catalog/source-path/EXIF fallback only. Tightened the generator so proposed keywords reject blacklisted terms by token/phrase, existing blacklisted keywords are excluded from proposals, and every photo in this batch now has at least 10 proposed keywords. Audit: 100/100 proposals met the 10-keyword target, 0 proposed keyword blacklist hits, and 9 current `containing` keywords were removed from proposed metadata. Existing compact four-column Owner review page was preserved. No proposals were auto-applied, and no JPG/source/private render/public preview files were rewritten.

## 2026-05-12 Nightly Title/Keyword Review Queue

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `27b185d1`
- Batch size: 100
- Newest photo/date: 2026-04-26T17:05:17
- Oldest photo/date: 2023-07-31T10:20:48
- Proposal file: `assets/owner-actions/title-keyword-review-queue/batch-2026-05-12.json`
- Review page: `title-keyword-review.html` (`http://localhost:8000/title-keyword-review.html`)
- Skipped or needs_owner_context photos: 0 already reviewed; 0 `needs_owner_context`.
- Commit pushed: yes (`bdfec685`, pushed to `origin/main`).
- Notes: `git pull --ff-only` and preview-pixel/vision inspection were blocked by DNS/network failure resolving `github.com`; local preview JPEGs were not present under `assets/expo`. Used catalog/source-path fallback only, did not apply proposals, and did not rewrite JPG/source/private render/public preview files. Tightened generator behavior so filename stems such as `IMG` are not treated as myth names and filename-style placeholders are not kept as improved proposals.

## 2026-05-12 Nightly Title/Keyword Review Queue Manual Run

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `ff738e25`
- Result: Manually ran the nightly title/keyword review queue and visually inspected the approval page in the browser.
- Batch size: 100
- Newest photo/date: 2026-04-26T17:05:17
- Oldest photo/date: 2023-07-31T10:20:48
- Proposal file: `assets/owner-actions/title-keyword-review-queue/batch-2026-05-12.json`
- Review page: `title-keyword-review.html` (`http://localhost:8000/title-keyword-review.html?v=73.4&run=manual-2026-05-12`)
- Photos skipped: 0 already reviewed; 24 marked `needs_owner_context`
- Visual inspection: first-screen previews render, lower AI previews render after lazy loading, header back-to-top and bottom Save approvals controls are present.
- Changes made: tightened the generator so long prompt-like AI titles propose compact titles such as `Pandora in Mucha Style` and `Artemis in Mucha Style` instead of repeating old prompt text.
- Commit pushed: yes, this commit
- Notes: Preserved pre-existing local dirty work in a temporary stash before the run and did not rewrite JPG/source metadata or apply any proposals.

## 2026-05-12 Nightly Automation Behavior Check

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `df4f978d`
- Result: Reviewed the live `pbe-nightly-title-keyword-review-queue` automation behavior and tightened its local automation prompt.
- Changes made:
  - Updated `/Users/ecohen/.codex/automations/pbe-nightly-title-keyword-review-queue/automation.toml` so David reads `MAX2DAVID.md` as inbound-only and writes reports/recommendations to `DAVID2MAX.md`.
  - Added explicit behavior to keep the compact four-column approval page, prefer vision-capable image inspection when available, avoid filename-style “improvements,” mark uncertain items `needs_owner_context`, and never rewrite image/source files.
- Commit pushed: yes, this commit
- Notes: The automation config lives outside the repo in `$CODEX_HOME`; this report is the tracked repo-side record.

## 2026-05-12 David Handoff Direction Fix

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `65e40a01`
- Result: Confirmed this host is David, so outbound notes for the other computer belong in `DAVID2MAX.md`.
- Changes made:
  - Added sticky hostname-based handoff direction rules to `AGENTS.md` and `HANDOFF.md`.
  - Restored `MAX2DAVID.md` to inbound-only content by removing David-side prompt edits previously made from this machine.
- Commit pushed: yes, this commit
- Notes: On David, `MAX2DAVID.md` is read-only inbound from Max; prompt/spec recommendations should be written here in `DAVID2MAX.md` unless the user explicitly asks otherwise.

## 2026-05-12 Nightly Title/Keyword Review Queue

- Machine: David
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `d4c0f396`
- Result: Implemented the Title/Keywords Owner review queue and generated the next nightly batch (newest 100 unreviewed photos).
- Changes made:
  - Added owner review page: `title-keyword-review.html` (localhost-only).
  - Added batch generator: `scripts/generate_title_keyword_review_queue.mjs`.
  - Added local helper endpoint to save approvals: `save-title-keyword-review-approvals` (writes under `assets/owner-actions/title-keyword-review-queue/`).
  - Generated proposals: `assets/owner-actions/title-keyword-review-queue/batch-2026-05-12.json` (and refreshed `assets/owner-actions/title-keyword-review-queue/latest.json`).
  - Bumped visible version + cache-bust strings to `v73.1`.
- Batch size: 100
- Newest photo/date: 2026-04-26T17:05:17
- Oldest photo/date: 2023-07-31T10:20:48
- Proposal file: `assets/owner-actions/title-keyword-review-queue/batch-2026-05-12.json`
- Review page: `title-keyword-review.html` (open via `http://localhost:8000/title-keyword-review.html` when running `python3 scripts/local_server.py 8000`)
- Photos skipped: none (0 already-reviewed, 0 insufficient-metadata skips)
- Commit pushed: no (push failed: could not resolve `github.com`); local commits: `cfcf4ee3`, `5c8e6fc9`
- Notes: `git pull --ff-only origin main` failed (DNS to GitHub); proceeded with local `main`.

## Open Results

_No David automation results recorded yet._

## 2026-05-13 R2 master-chain maintenance (daily)

- Repo sync: `git pull --ff-only` failed (DNS/network: could not resolve `github.com`).
- R2 maintenance: failed before audit (DNS/network: could not resolve `*.r2.cloudflarestorage.com`).
- Tests: `npm test` OK (14/14); `npm run validate` OK.
- Counts (unavailable due to R2 connectivity):
  - Repaired masters: n/a
  - Repaired renders: n/a
  - Pruned private render ghosts: n/a
  - Pruned public preview ghosts: n/a
  - Remaining missing public previews / failures: n/a

## 2026-05-12 MAX2DAVID Automation Setup

- Machine: David
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `84ecc860`
- Result: Pulled `main`, read `MAX2DAVID.md` and `HANDOFF.md`, and created the requested recurring automations.
- Changes made:
  - Created daily repo health check at 09:00 Madrid time.
  - Created weekly social candidate, caption draft, asset queue, gap review, and performance-log jobs.
  - Created monthly social theme calendar, Reddit community watchlist, and keyword noise review jobs.
  - Created nightly 02:00 title/keyword Owner review queue automation.
- Commit pushed: yes, this setup note is part of the setup commit.
- Notes: Automations append results back to `DAVID2MAX.md`, run from `/Users/ecohen/Dev/PhotosByElie`, pull `main` first, avoid rewriting image/JPG/source metadata, validate before committing tracked changes, and push successful report/code commits to `main`.

## 2026-05-13 PBE Daily Health Check

- Repo sync: `git pull --ff-only` failed (DNS/network: could not resolve `github.com`).
- Commit checked: `499a522aef0cd17bd3c73337abac83adea04a472` (local `main`).
- Tests: `npm test` OK (14/14).
- Validate: `npm run validate` OK.
- Working tree: not clean (many modified tracked files and some untracked; likely from prior local work).
- Notes: Next action is to restore GitHub connectivity (or run from a networked environment) so the check can validate against latest `origin/main`, and to decide whether to commit/stash/discard the existing local changes before the next pull.

## 2026-05-13 PBE Weekly Social Asset Queue

- Machine: David
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Repo sync: `git pull --ff-only` failed (DNS/network: could not resolve `github.com`).
- Commit checked: `1a5de5cd9caf39051020590f5e6b77a7725d72ab` (local `main`).
- Notes: Stashed pre-existing local changes before generating this queue to keep the report isolated.
- Queue (10 public-catalog photos):
  - Photo id: `20220506-154558-03388-a887904b4b` | Collection: `france` | Title: `Eglise des Invalides, Paris` | Suggested format: `Story/Reel (9:16)` | Why: strong vertical architectural subject; minimal side-crop to 9:16 should preserve the main dome/lines.
  - Photo id: `20220505-153639-03083-3ded4343e5` | Collection: `france` | Title: `Coupole des Galeries Lafayette` | Suggested format: `Story/Reel (9:16)` | Why: symmetrical dome/ceiling compositions typically tolerate top/bottom emphasis; 9:16 framing can keep the center while trimming edges.
  - Photo id: `20180224-1446-00097-f9e2a1929a` | Collection: `usa` | Title: `Oceanside Harbor Village` | Suggested format: `Portrait (4:5)` | Why: already close to portrait; 4:5 crop should keep the main subject while removing extra side space.
  - Photo id: `20180511-1120-00362-26e0c5732b` | Collection: `france` | Title: `Notre Dame de Paris, Quai de Seine` | Suggested format: `Portrait (4:5)` | Why: architecture/riverbank scenes usually have a clear vertical focal area; 4:5 keeps feed-friendly framing without needing aggressive cropping.
  - Photo id: `20180511-1205-00368-3481c74f91` | Collection: `france` | Title: `Art, Institut du Monde Arabe, Paris, France` | Suggested format: `Square (1:1)` | Why: near-square original; square crop should be minimal and preserve the graphic/architectural read.
  - Photo id: `20180304-1733-00110-843be79aa4` | Collection: `usa` | Title: `Solana Beach Sunset` | Suggested format: `Square (1:1)` | Why: horizon/sunset compositions tend to work well in square with a centered subject; minimal crop needed from near-square ratio.
  - Photo id: `20160710-1444-38838-pano-5f0de8bfbe` | Collection: `spain` | Title: `Figueras Dali Museum` | Suggested format: `Carousel (square)` | Why: slightly wide; can be split into 1–3 square slides (detail + context) without losing the overall scene.
  - Photo id: `20180510-1519-00298-793ef096f2` | Collection: `france` | Title: `Le Moulin De La Galette, Montmartre, Paris, France` | Suggested format: `Portrait (4:5)` | Why: moderately tall framing should adapt well to 4:5; crop can emphasize the primary landmark/signage while trimming peripheral street context.
  - Photo id: `20180217-182800-00091-490eb3867d` | Collection: `usa` | Title: `Sunset from Double Peak. San Marcos, Carlsbad, and Catalina Island` | Suggested format: `Carousel (panorama slices)` | Why: very wide pano; ideal for multi-slide swipe reveal (left→right) to preserve the full panorama.
  - Photo id: `20220505-0400-00135-pano-f4e52ebf11` | Collection: `france` | Title: `Chateau de Versailles, Galeries des Glaces` | Suggested format: `Carousel (panorama slices)` | Why: wide interior pano; works well as 2–4 vertical slices to highlight repeating patterns and depth.
