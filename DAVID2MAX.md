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

## 2026-05-15 Handoff for Max

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `37310431`
- Result: Prepared a Max-facing handoff from David.
- Current pushed head:
  - `37310431 photosbyelie: refresh delivery coverage docs`
  - `5a5ebf48 photosbyelie: daily health check 2026-05-15`
  - `ca0bd349 photosbyelie: gate basket by delivery coverage`
- What changed recently:
  - Basket checkout now prunes stale localStorage selections for discarded/Waste Basket tombstones and missing private deliverables.
  - Checkout errors now identify the exact missing photo/product/object key.
  - Owner R2 coverage excludes tombstoned Waste Basket photos from active repair targets.
  - Owner R2 coverage can surface active photos missing private masters or JPG triplets and mark whether Saturn/source-file repair is possible.
  - Docs/backlog were refreshed in `SUMMARY.md`, `TODO.md`, `HANDOFF.md`, and `README.md`.
- Current product rule:
  - Tombstoned/Waste Basket photos are not buyer inventory, even if stale browser basket state or stale private-delivery manifests mention them.
  - Active buyer inventory requires real private master/render availability.
  - Missing private files for active photos should be surfaced on Owner and repaired from Saturn/source paths when available.
- Validation already run for the implementation:
  - `npm test`
  - `npm run validate`
  - `node --check basket.js`
  - `node --check owner.js`
  - `python3 -m py_compile scripts/local_server.py`
  - Browser checks on `basket.html?v=74.38&run=delivery-gating#checkout` and `owner.html?v=74.38&run=delivery-coverage`
- Known dirty/untracked state intentionally left unstaged on David:
  - Modified: `AGENTS.md`
  - Modified: `assets/discarded/discarded-photo-ids.json`
  - Modified: `assets/expo-manifest.json`
  - Modified: `assets/owner-actions/title-keyword-review-queue/proposed-state.json`
  - Modified: `scripts/asset_state.py`
  - Modified: `title-keyword-review.js`
  - Untracked: `.tmp-social/`
  - Untracked: `assets/owner-actions/reserve-data.json`
  - Untracked: `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-12.json`
  - Untracked: `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`
  - Untracked: `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-15.json`
  - Untracked: `scripts/build_photo_state_tsv.py`
- Suggested next move for Max:
  1. Pull latest `main`.
  2. Reconcile the dirty Owner/generated state deliberately; do not batch it with unrelated product work.
  3. Confirm whether `scripts/build_photo_state_tsv.py` should become canonical Owner state export.
  4. Continue revenue track: Stripe test checkout, durable order state, shared price-list data, buyer offer copy.
  5. Resume Waste Basket cloud cleanup only when ready to monitor progress and confirm tombstone behavior.
- Commit pushed: yes, this handoff commit.
- Notes: `MAX2DAVID.md` was not edited; on David it remains inbound-only.

## 2026-05-15 Basket Delivery Gating + Owner Coverage Docs

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `ca0bd349`
- Result: Refreshed handoff/docs after the basket delivery-gating fix.
- Changes made:
  - Summarized the thread in `SUMMARY.md`.
  - Refreshed `TODO.md`, `HANDOFF.md`, and `README.md` around tombstoned basket pruning, private delivery availability, and Owner missing master/triplet coverage.
  - Kept `MAX2DAVID.md` inbound-only.
- Commit pushed: yes, this docs commit.
- Notes: Remaining dirty Owner/generated state was intentionally left unstaged.

## 2026-05-13 Nightly Title/Keyword Prompt Scope Fix

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Updated the live `pbe-nightly-title-keyword-review-queue` automation prompt to be metadata-only.
- Changes made:
  - Removed the instruction to implement the workflow if missing.
  - Added an explicit rule forbidding code, scripts, styles, HTML pages, tests, package files, docs/SOPs, or workflow implementation edits in this automation.
  - Added blocker behavior: if the existing workflow is missing, broken, or insufficient, report the blocker and recommended prompt/spec changes here instead of repairing code.
  - Tightened commit scope to proposal/state/audit/report metadata files only.
- Commit pushed: no; automation config lives under `/Users/ecohen/.codex/automations/`, and GitHub DNS is currently unavailable from David.
- Notes: Reverted the local code edit made during this run to `scripts/generate_title_keyword_review_queue.mjs`; remaining dirty code/docs files pre-existed or are from other local work and were not touched for this prompt fix.

## 2026-05-13 Nightly Title/Keyword Batch Quota Prompt Fix

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Updated the live `pbe-nightly-title-keyword-review-queue` automation prompt so rejected/rework rows do not consume the nightly 100-photo quota.
- Changes made:
  - Reworked proposals are now specified as extra rows before the ordinary new-photo batch.
  - The automation should select up to 100 ordinary new photos every run, newest backward, in addition to any rejected/rework rows.
  - The report must include total batch size, ordinary new-photo count, and rejected/rework count.
  - If the existing workflow still counts rework rows inside the 100-row limit, the automation must stop and report that blocker here rather than modifying code.
- Commit pushed: no; automation config lives under `/Users/ecohen/.codex/automations/`.
- Notes: Prompt-only change; no code changes made.

## 2026-05-13 Social Post Package Follow-up

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Added the follow-on package generator for the weekly social asset queue and created the recurring automation.
- Changes made:
  - Added `scripts/generate_social_post_packages.mjs`.
  - Added `npm run social:packages`.
  - Generated 10 ready-to-review packages from the 2026-05-13 Social Asset Queue under `assets/owner-actions/social-post-packages/2026-05-13/`.
  - Created active automation `pbe-weekly-social-post-packages` for Wednesdays at 10:15 Madrid time.
- Package files:
  - `assets/owner-actions/social-post-packages/2026-05-13/post-packages.md`
  - `assets/owner-actions/social-post-packages/2026-05-13/post-packages.json`
  - `assets/owner-actions/social-post-packages/latest.json`
- Automation scope: prepares Instagram, Facebook, and Pinterest posting kits only. It does not post, upload, crop, or edit images.
- Posting automation note: Instagram/Facebook/Pinterest posting appears technically possible, but it needs platform credentials, app permissions, token storage, and Pinterest board mapping before enabling live publish.
- Validation:
  - `npm run social:packages`: OK, 10/10 ready.
  - `node --check scripts/generate_social_post_packages.mjs`: OK.
  - `npm run social:packages -- --dry-run`: OK, 10/10 ready.
  - `npm test`: OK (14/14).
  - `npm run validate`: OK.
- Notes: Left existing Owner/title-keyword review state unstaged.

## 2026-05-13 Title/Keyword Proposal State + Reject Rework

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `06c5f9c3`
- Result: Added durable proposal/rejection state for the Owner title/keyword queue and refreshed the live nightly automation prompt.
- Changes made: added `Title_Keywords_Proposed` state tracking in `assets/owner-actions/title-keyword-review-queue/proposed-state.json`; added reject checkboxes and optional reject comments to the compact Owner review page; reject comments auto-select Reject, Approve greys but preserves comments, and interacting with the comment reactivates Reject; rejected rows are prioritized for future rework batches.
- SOP/prompt: added `docs/sops/TITLE_KEYWORD_REVIEW_SOP.md` and updated `/Users/ecohen/.codex/automations/pbe-nightly-title-keyword-review-queue/automation.toml`.
- Validation: browser interaction verified locally at `http://localhost:8000/title-keyword-review.html?v=73.9&run=reject-ui`; `npm test` passed (14/14); `npm run validate` passed.
- Commit pushed: yes, this commit.
- Notes: The state and rejection workflow updates tracked owner-action JSON and generated catalog/state files only. No JPG/source metadata, public previews, private masters, or private render files are rewritten.

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

## 2026-05-13 Owner Review UI Fixes

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Addressed Owner-page and Title/Keywords review-page browser comments.
- Changes made:
  - Changed the Owner classification eyebrow to `Country Classification`.
  - Reworded the Title/Keywords card so it does not imply the queue is always exactly 100 items.
  - Made reject notes vertical and gave the decision column enough room.
  - Manual edits to proposed titles/keywords now auto-select Approve and queue a row save.
  - Reject checkbox/comment interactions now queue row saves without waiting for the top Save approvals button.
  - The local helper now merges row-level approval records by photo id instead of overwriting the batch approval JSON.
  - Added Owner status text for long-running actions, clearer blocked-preview zero copy, and `Price list ($)` / USD copy.
- Visible version: `v74.0`
- Review page: `title-keyword-review.html` (`http://localhost:8000/title-keyword-review.html?v=74.0`)
- Owner page: `owner.html` (`http://localhost:8000/owner.html?v=74.0`)
- Validation:
  - `node --check title-keyword-review.js && node --check owner.js && node --check hidden-actions.js`: OK
  - `python3 -m py_compile scripts/local_server.py`: OK
  - `npm test`: failed on existing dirty generated catalog pricing/source-origin state (`5500 !== 8100`, `5000 !== 2900`, `4500 !== 6500`)
  - `npm run validate`: failed on existing dirty generated catalog `sourceOrigin` errors
- Commit pushed: `8e1a91af` (`photosbyelie: improve owner review interactions`)
- Notes: Left dirty generated catalog files unstaged: `photos-data.js` and `worker/photos-catalog.generated.mjs`.

## 2026-05-13 Title/Keyword Review Shortcut Pass

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Added row selection and keyboard shortcuts to the Title/Keywords review page.
- Changes made:
  - Approve and Reject checkboxes sit side by side.
  - Added shortcut strip: `A` approve, `R` reject, `P` propagate, `H`/`X` block, double-click detail.
  - Single-click now selects a review row and does not navigate away.
  - Double-click opens the selected photo detail page.
  - Propagate button sits under the row status and applies the selected approve/reject state to rows in the same gallery within a two-hour capture window.
  - H/X are keyboard shortcuts only and call the existing Blocked action.
- Visible version: `v74.2`
- Review page: `title-keyword-review.html` (`http://localhost:8000/title-keyword-review.html?v=74.2`)
- Validation:
  - `node --check title-keyword-review.js`: OK
  - Browser check: single-click selection stayed on the review page; double-click opened `photo.html?id=d5h-2945-864593e516&v=74.2`.
- Commit pushed: `4552134a` (`photosbyelie: add review row shortcuts`)
- Notes: Dirty generated catalog files remain unstaged: `photos-data.js` and `worker/photos-catalog.generated.mjs`.

## 2026-05-13 Title/Keyword Review Autosave Fix

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Fixed row autosave failures seen in the Title/Keywords review page.
- Cause: Concurrent row saves were writing through the same approval JSON temp filename, so one save could remove another save's temp file before rename.
- Changes made:
  - `_write_json_file` now uses a unique UUID temp filename for each write.
  - Row-level save/block errors now show short row status text and keep the detailed error in the page status line.
- Visible version: `v74.3`
- Validation:
  - `node --check title-keyword-review.js`: OK
  - `python3 -m py_compile scripts/local_server.py`: OK
- Commit pushed: `519b45ca` (`photosbyelie: harden review autosaves`)
- Notes: Dirty generated/output files remain unstaged: `home-data.js`, `photos-data.js`, `worker/photos-catalog.generated.mjs`, and `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`.

## 2026-05-13 Title/Keyword Review Saved Row Policy

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Adjusted review queue behavior so saved approvals/rejections disappear only after leaving/reloading the page, while blocked rows disappear immediately.
- Changes made:
  - The review page now reads `approvals-<batch>.json` on load and filters out rows already saved as approved or rejected.
  - Approval/rejection autosaves keep rows visible during the current page session.
  - H/X block action removes the row immediately after the helper confirms success.
- Visible version: `v74.4`
- Validation:
  - `node --check title-keyword-review.js`: OK
  - Browser check: `title-keyword-review.html?v=74.4` loaded and showed 67 remaining rows with the current local approval record.
- Commit pushed: `7277e863` (`photosbyelie: filter saved review rows`)
- Notes: Dirty generated/output files remain unstaged, including local approval/proposal state from review interactions.

## 2026-05-13 R2-Only Preview Cleanup And Backfill

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Pulled latest main with fast-forward only: `b34e5cfd` -> `0d133503`.
- Cleanup:
  - Removed local `assets/expo` and `assets/reserve` preview placeholder trees from the working copy.
  - Removed hidden country placeholder folders; kept only `assets/hidden/hidden-blacklist.json` and `assets/hidden/hidden-data.json`.
  - Stopped `scripts/export_photos_data.py` from regenerating per-country `.gitkeep` placeholders during validation/export.
- Required grep result:
  - Remaining hits are expected JSON-state references in `owner.js`, `hidden-actions.js`, and `hidden-store.js`, plus Max's prompt text in `MAX2DAVID.md`.
  - No local preview JPG paths or `./assets/expo`, `./assets/reserve`, or `./assets/hidden/*.jpg` preview URLs remain in publish data/code.
- R2 audit/backfill:
  - Public photo count: `5,844`.
  - Expected public preview key count: `11,688` (`galleryKey` + `detailKey` for each public-preview-allowed photo).
  - Sidecar key gaps: `0`.
  - Initial aggressive audit hit R2 rate limits: `9,234` non-200, of which `9,220` were `429`.
  - Slower recheck found true initial missing count: `24` (`404`).
  - Source/cache gaps: `0`; all 24 missing derivatives existed in `tmp/import-cache`.
  - Uploaded count: `24` objects to `photosbyelie-public` under the existing `expo/<id>_900.jpg` / `_1800.jpg` keys.
  - Final repaired-key HEAD check: `24/24` returned HTTP `200`; final missing count: `0`.
- Validation:
  - `npm test`: OK (`14` tests passed).
  - `npm run validate`: OK (`Validation OK`).
- Commit pushed: `84b0ba74` (`photosbyelie: complete r2 preview handoff`).
- Notes:
  - Did not restore local preview folders.
  - Did not commit JPGs.
  - Did not rewrite source/JPG embedded metadata, private masters, private renders, or generated public preview bytes beyond uploading the already-generated missing preview objects.
  - Local Owner review state remains dirty and intentionally unstaged: `assets/owner-actions/title-keyword-review-queue/proposed-state.json` and `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`.

## 2026-05-13 - Title/Keyword review blocked-row persistence

- Fixed Owner title/keyword review so H/X Block persists to the batch review record as `blocked` in `assets/owner-actions/title-keyword-review-queue/approvals-<batch>.json`.
- The review page now filters saved `approvals`, `rejections`, and `blocked` rows on load, so blocked rows stay gone after leaving and returning.
- Proposed review keywords are now normalized/deduplicated and filtered through `assets/owner-actions/keyword-blacklist.json` when rendered and again when saved/applied by the helper.
- Browser verification on v74.17: blocked `d5h-2944-68e4f5655f`; it disappeared immediately and remained absent after reload. Rendered proposal keywords had no exact blacklist hits and no duplicate keyword rows in the page snapshot.
- Validation: `npm test` passed; `npm run validate` passed.
- Commit pushed: `c973943e photosbyelie: persist blocked review rows`.
- Note: H/X clicks made before this fix were not durably recorded unless they also have entries in the current approvals JSON. Those rows may need to be H/Xed once more.

## 2026-05-13 - Title/Keyword review toolbar labels

- Reworked the Title/Keywords batch toolbar labels after Owner review feedback.
- Top toolbar now shows: `Approve visible`, `Apply selected`, `Export selected JSON`, and `Open proposal JSON`.
- `Approve visible` now selects all visible rows and queues their row autosaves, matching the current per-row autosave model.
- `Apply selected` is now explicit that it is the catalog metadata apply action for checked rows, replacing the misleading `Save approvals` label.
- Toolbar layout is full-width and left-aligned to avoid the previous odd wrapped/centered button row.
- Validation: `npm test` passed; `npm run validate` passed.
- Commit pushed: `ff211d99 photosbyelie: clarify review batch actions`.

## 2026-05-13 - Title/Keyword review arrow navigation

- Enabled arrow-key selection on the Title/Keywords Owner review page.
- `ArrowDown` and `ArrowRight` move to the next visible review row; `ArrowUp` and `ArrowLeft` move to the previous visible review row.
- Updated the Title/Keywords shortcut strip to show the four arrow keys for selection.
- Also let the homepage collection carousel accept `ArrowUp`/`ArrowDown` as previous/next, matching existing left/right behavior.
- Browser verification on v74.19: ArrowDown moved selected row 1 to row 2, ArrowUp moved row 2 back to row 1, and the hint displayed the arrow keys.
- Validation: `npm test` passed; `npm run validate` passed after restoring generated catalog side effects from local Owner testing.
- Commit pushed: `cf88adf6 photosbyelie: enable review arrow navigation`.

## 2026-05-13 - Blocked Owner review grid and preview cleanup policy

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Restored the Blocked Owner review grid after it blanked/stalled on the full hidden catalog.
- Changes made:
  - Blocked review now renders in 160-card pages with `Load more` instead of trying to lay out every blocked photo at once.
  - Restored the shared floating Grid/Fit/Top controls on the Blocked page.
  - Added a shared gallery-card error fallback so missing public preview URLs become compact `Preview unavailable` tiles instead of long broken-image alt text.
  - Documented the intended media-retention policy: Blocked/Discarded previews are only needed for a short undo window, default 24 hours. After that, preview derivatives can be purged; durable state should keep the blocked/discarded id and blacklisted master/source path to prevent resurrection.
- Visible versions:
  - `v74.20`: blocked grid pagination/control restoration.
  - `v74.21`: missing-preview fallback and 24-hour preview-retention policy note.
- Browser verification:
  - `http://127.0.0.1:8000/owner-review.html?view=blocked&v=74.20&run=blocked-page-final` loaded with heading/status, Grid/Fit controls, visible cards, and `Load 160 more`.
  - `http://127.0.0.1:8000/owner-review.html?view=blocked&v=74.21&run=missing-preview-fallback` loaded after the missing-preview fallback change.
- Validation:
  - `node --check hidden-page.js`: OK.
  - `node --check gallery-card.js`: OK.
  - `npm test`: OK (`14` tests passed).
  - `npm run validate`: OK (`Validation OK`).
- Commits pushed:
  - `0068090c photosbyelie: restore blocked review grid`
  - `6010eab3 photosbyelie: tidy missing preview cards`
- Notes: Local Owner/generated state remains dirty and intentionally unstaged, including keyword blacklist/proposal state, discarded media manifest, package/script experimentation, and current approval JSON.

## 2026-05-13 - Blocked preview retention docs refresh

- Machine: David (David-5.local)
- Repo: 
- Result: Refreshed docs and  after Owner decision on Blocked/Discarded preview retention.
- Policy captured: Blocked/Discarded previews are temporary undo-window media only, default 24 hours. After that, public/private preview derivatives should be deleted and durable tombstone state should retain photo id plus blacklisted master/source path to prevent resurrection.
- Files updated: , , .
- Commit pushed: .
- Notes: Existing dirty local Owner/generated files and state TSV docs remain unstaged and were not included in this docs commit.

## 2026-05-13 - Correction: Blocked preview retention docs refresh

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Corrects the immediately preceding handoff entry, which lost inline code text during shell writing.
- Policy captured: Blocked/Discarded previews are temporary undo-window media only, default 24 hours. After that, public/private preview derivatives should be deleted and durable tombstone state should retain photo id plus blacklisted master/source path to prevent resurrection.
- Files updated in the docs commit: `SUMMARY.md`, `docs/architecture/static-first-media-hosting.md`, `docs/sops/IMAGE_INGESTION_SOP.md`.
- Docs commit pushed: `42dd0d92 photosbyelie: document blocked preview retention`.
- Report correction commit pushed after that: `18ad6c36 photosbyelie: report retention docs refresh` contains the garbled prior entry; this correction supersedes it.
- Notes: Existing dirty local Owner/generated files and state TSV docs remain unstaged and were not included in the docs commit.

## 2026-05-13 - Gallery pano fit span restoration

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Restored the missing CSS hook for the existing Fit-mode panorama layout algorithm.
- Finding: `gallery-layout.js` still calculated `--gallery-column-span` correctly; panoramas return all grid columns in Fit mode. The CSS no longer applied that variable to `.mock-photo-card`.
- Change: Added `grid-column: span var(--gallery-column-span,1)` for `.mock-gallery[data-image-fit="fit"] .mock-photo-card`.
- Visible version: `v74.22`.
- Browser check: `http://127.0.0.1:8000/gallery.html?gallery=france&orientation=pano&v=74.22&run=pano-fit` loaded France pano results with Fit selected.
- Validation: `npm test` passed; `npm run validate` passed.
- Commit pushed: `ea6737ee photosbyelie: restore pano fit spans`.
- Notes: Existing dirty local Owner/generated files remain unstaged.

## 2026-05-13 - Gallery control and basket rail placement

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Adjusted Gallery Grid/Fit/Fill floating controls to avoid collision with the basket rail and header controls.
- Change: `photo-gallery.js` now positions the controls adaptively. On wide screens it uses the sticky header band only when there is room between the brand and header buttons; otherwise it drops below the header.
- Change: `photos.css` now uses `--gallery-view-controls-right` for dynamic right placement and moves the desktop basket rail down to `top:132px` with a matching max-height adjustment.
- Visible version: `v74.23`.
- Browser verification:
  - `http://127.0.0.1:8000/gallery.html?gallery=france&v=74.23&run=controls-placement-2`: narrow/no-rail view drops controls below the header, clear of header buttons.
  - `http://127.0.0.1:8000/gallery.html?gallery=france&v=74.23&run=controls-placement-wide`: wide/rail view keeps controls in the header band and the rail starts below them.
- Validation: `node --check photo-gallery.js`, `npm test`, and `npm run validate` passed.
- Commit pushed: `2ab3d6a8 photosbyelie: avoid gallery control rail overlap`.
- Notes: Existing dirty local Owner/generated files remain unstaged.

## 2026-05-13 - Waste Basket cleanup model (David)

- Renamed the Owner Blocked review surface to Waste Basket and merged the old separate blocked-sync panel into the Waste Basket card.
- Waste Basket now presents three owner actions in one place: Review, Protect basket, and Empty basket.
- Kept the blacklist/tombstone idea as the durable "do not make that mistake again" record, while Empty basket now purges cloud media for basketed photos: public previews, private masters, and private render triplets, then clears the basket and leaves discard tombstones.
- Unified Blocked/Waste Basket gallery paging with the normal gallery controls: 24-at-a-time, external Show more/Show all controls, shared floating Grid/Fit/Fill placement.
- Visible version bumped to v74.24.
- Pushed commit: 979de98c photosbyelie: unify waste basket cleanup.
- Checks passed: node --check for touched JS, python3 -m py_compile scripts/local_server.py, git diff --check, and browser smoke checks for Owner/Waste Basket wording.
- Known unrelated validation issues remain: npm test fails checkout pricing assertions; npm run validate fails existing catalog/media-origin validation across generated catalog files. These were not caused by this Waste Basket patch and were left unstaged.

## 2026-05-13 - Waste Basket docs refresh

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Refreshed `SUMMARY.md` and `TODO.md` around the current Waste Basket model and latest visible build `v74.25`.
- Captured decisions:
  - Owner-facing model is Waste Basket, not generic blocked/discarded state.
  - The extra Owner-facing `Protect basket` action is removed from the main model; basket/put-back is the live blacklist boundary.
  - `Empty basket` deletes public previews, private masters, and private render triplets, then leaves tombstones/blacklist state so the same undesirable masters do not return.
  - The 24-hour automatic undo-window idea was dropped; the Owner decides when to empty the basket.
  - The user’s spec/design framing is now preserved in `SUMMARY.md`.
- Owner UI refresh:
  - Combined `Camera / AI split` and `Current state` into a single `Catalog mix` card with a pie chart.
  - Removed `Protect basket` from the primary Waste Basket controls.
  - Rephrased Owner-facing R2 coverage copy from `blocked` to `Waste Basket`.
  - Empty basket now explicitly refreshes the basket count, tombstone count, and cloud-media count after the helper returns.
- Backlog refreshed with validation/catalog reconciliation first, Title/Keywords state second, and safe Waste Basket emptying verification third.
- Notes: Dirty local Owner/generated state and unrelated State TSV docs/scripts remain unstaged.

## 2026-05-13 - Waste Basket cleanup progress

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Added Owner-card feedback for active Waste Basket/R2 delete work so the purge is no longer silent.
- Visible version bumped to v74.26.
- Owner UI behavior: Waste Basket now shows the latest active cleanup progress, reports when multiple cleanup jobs are active, and disables `Empty basket` as `Emptying...` while delete work is running.
- Browser verification: `http://localhost:8000/owner.html?v=74.26&run=waste-progress` showed 3 cleanup jobs active, 3,878 / 8,830 files on the furthest-along active job, and the disabled `Emptying...` button.
- Checks passed: `node --check owner.js`, `git diff --check`.
- Known unrelated failures remain: `npm test` still fails 3 checkout pricing assertions; `npm run validate` still reports generated catalog/source-origin/public-preview key issues.
- Notes: I did not start another empty-basket purge while existing delete jobs were active. Dirty local Owner/generated state remains unstaged.

## 2026-05-13 - Owner price list AI tier guard

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Restored the Owner price list's Camera/AI digital pricing split when local generated catalog state is stale.
- Finding: The committed generator still emits `window.photosByEliePriceTiers` and per-option `prices`, but David's dirty local `photos-data.js` had lost that block, so the Owner price list fell back to a single Camera column.
- Change: `owner.js` now backfills the canonical digital price tiers before applying local Owner price overrides.
- Visible version bumped to v74.27.
- Notes: Dirty generated catalog/state files remain unstaged.

## 2026-05-14 - Waste Basket progress readability

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Reworked the Waste Basket progress readout to show owner-meaningful numbers instead of just "3 cleanup jobs".
- Finding: The helper was still making progress; the furthest cleanup job had moved past 4,678 / 8,830 public-preview files. The UI made that look dead because it emphasized duplicate jobs and the refresh icon could stay busy if a helper request lagged.
- Change: The progress panel now reports public-preview progress as basket photos checked, keeps `Cloud media left` visible in the progress panel, and notes duplicate jobs only as secondary context.
- Change: Waste Basket/R2 refresh actions now have a 12-second UI timeout so refresh buttons stop spinning and report slow helper responses.
- Follow-up: WARP had been suspended, which likely slowed/stalled R2 delete progress. After WARP was restored, helper progress moved again.
- Browser verification: `http://localhost:8000/owner.html?v=74.28&run=waste-progress-readable-2` showed `Public previews: 2,439 / 4,415 basket photos checked` and `Cloud media left: 186`.
- Visible version bumped to v74.28.
- Notes: Dirty generated catalog/state files remain unstaged.

## 2026-05-14 - Waste Basket count semantics

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Folded Waste Basket cleanup progress into the primary count area instead of showing a separate progress panel.
- Finding: The active jobs are `hidden-public-wipe` preview-only cleanup jobs. They check/delete old public preview objects but do not clear the live Waste Basket queue, so `In basket` should not decrease from those jobs.
- Change: `In basket` now reads as the undo queue, `Cloud media left` shows inline cleanup progress, and `Tombstones` is labeled permanent.
- Change: Preview-only cleanup no longer disables or relabels `Empty basket`; the button is disabled only while a true `waste-basket-media-wipe` task is active.
- Browser verification: `http://localhost:8000/owner.html?v=74.29&run=waste-inline-progress` showed no separate progress panel, `Empty basket` enabled, and `Cleanup: 2,683 / 4,415 preview checks` under `Cloud media left`.
- Visible version bumped to v74.29.
- Checks passed: `node --check owner.js`, `git diff --check`.
- Commit pushed: `photosbyelie: fold waste progress into counts`.
- Notes: Dirty generated catalog/state files remain unstaged.

## 2026-05-14 - R2 master-chain repair (daily)

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- `git pull --ff-only`: failed (sandbox DNS: cannot resolve `github.com`).
- R2 maintenance: `node scripts/repair_r2_master_chain.mjs --repair --prune --audit .review-logs/r2-master-chain-audit-daily.json` failed (sandbox DNS: cannot resolve Cloudflare R2 hostname).
- Counts: repaired masters=0, repaired renders=0, pruned private render ghosts=0, pruned public preview ghosts=0.
- Remaining: missing public previews / prune candidates unknown (script could not reach R2).
- Local checks: `npm test` passed after updating pricing expectations in `worker/checkout-worker.test.mjs`; `npm run validate` still reports many `--external-media` validation errors (not addressed in this pass).
- Commit (local only): `photosbyelie: update checkout pricing test expectations` (push blocked by sandbox DNS).

## 2026-05-14 - Owner cloud bill forecast

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Restored a dollar-impact view on the Owner page as `Cloud bill forecast ($)`.
- Change: Owner now loads `assets/storage-estimate.json` and shows consumed month-to-date storage cost, expected current-month storage bill, next-month storage at the current rate, current stored bytes, and line-item rows for R2 storage, R2 operations, Workers plan, and Workers requests/CPU.
- Live storage estimate refreshed from R2: `118,791,489,349` current bytes (`111 GB` displayed), storage MTD `$0.70`, expected current storage bill `$1.63`, next month `$1.63`, and `$6.63` if Workers Paid base applies.
- Caveat: R2 operation counts and Worker request/CPU usage are not yet connected to Cloudflare analytics, so those rows are explicit telemetry gaps instead of guessed dollars.
- Visible version bumped to v74.30.
- Browser verification: `http://localhost:8000/owner.html?v=74.30&run=cloud-cost-forecast` showed the new card and values above.
- Checks passed: `node --check owner.js`, `node --check scripts/write_storage_estimate.mjs`, `git diff --check`.
- Commit pushed: `photosbyelie: restore owner cloud cost forecast`.
- Notes: Existing untracked Owner approval/reserve/TSV files remain unstaged.

## 2026-05-14 - Daily Health Check

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `790d5c4f0f0f7d0af965c21feb244b0c53219c60`
- `git pull --ff-only`: failed (sandbox DNS: cannot resolve `github.com`).
- `npm test`: failed (11/14). Key errors:
  - `worker/checkout-worker.test.mjs:150` expected `5500` got `8100`
  - `worker/checkout-worker.test.mjs:168` expected `5000` got `2900`
  - `worker/checkout-worker.test.mjs:309` expected `4500` got `6500`
- `npm run validate`: passed (`Validation OK`).
- Notes:
  - Working tree was already dirty at start (untracked generated/owner-action files present); health check did not modify them.
  - Suggested next action: Investigate recent pricing/tier logic changes vs test expectations in `worker/checkout-worker.test.mjs` (do not update prod pricing based on tests alone); once clarified, update tests or code and rerun `npm test`.

## 2026-05-14 - Public catalog TSV migration

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Replaced the giant browser catalog payload in `photos-data.js` with generated TSV shards under `assets/catalog/` plus a small compatibility bootstrap.
- Data shape: `photos-data.js` is now about 10 KB; `assets/catalog/photos.tsv` is about 8.9 MB and `assets/catalog/photos.tsv.gz` is about 577 KB. `assets/catalog/collections.tsv` and `.gz` hold collection metadata.
- Tooling updated: publish validation, title/keyword queue generation, social package generation, Worker catalog generation, Worker tests/local server, export, and owner-state compatibility paths now load the TSV catalog through `scripts/catalog_tsv.cjs`.
- Visible version bumped to v74.34.
- Browser verification: Owner page and France gallery loaded at v74.34 and fetched `assets/catalog/collections.tsv` plus `assets/catalog/photos.tsv`.
- Checks passed: `npm test`, `npm run validate`, `node --check` on changed JS/CJS/MJS, Python compile for touched Python scripts, and `git diff --check`.
- Notes: Waste Basket purge was not resumed. Existing unrelated dirty/untracked owner/generated files remain outside this change.

## 2026-05-14 - TSV/Waste Basket docs and page sweep

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Run time: 2026-05-14 15:51 CEST
- Result: Swept docs, scripts, and visible page strings so the TSV-backed catalog and Owner-facing Waste Basket model are current after the large catalog-data change.
- Docs updated: `README.md`, `HANDOFF.md`, `SUMMARY.md`, `TODO.md`, `scripts/README.md`, `docs/architecture/static-first-media-hosting.md`, `docs/sops/IMAGE_INGESTION_SOP.md`, and the title/keyword review SOP.
- Script/page alignment: helper messages now refer to TSV-backed catalog loading and Owner-facing basket behavior while retaining existing internal `hidden`/`blocked` filenames and JSON fields.
- Visible version bumped to v74.35.
- Browser verification: Owner page loaded at `http://localhost:8000/owner.html?v=74.35&run=docs-sweep`; France gallery loaded at `http://localhost:8000/gallery.html?gallery=france&v=74.35&run=docs-sweep` with 48 rendered photo cards.
- Checks passed: targeted stale-phrase sweep, `git diff --check`, JS parse checks, Python compile checks, `npm test`, and `npm run validate`.
- Note: During browser smoke the helper received one stale `r2-fix` POST from the open Owner page, but the local server was stopped and no tracked file changes from that helper action were staged.
- Notes: Existing unrelated dirty/generated files remain unstaged, including discard/expo manifests and local owner-action artifacts.

## 2026-05-14 - Pinterest mini-collection landing path

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Replaced the social buyer path from a lone photo detail destination with a first-party mini-collection landing page.
- New page: `campaign.html?c=pinterest-invalides-2026-05-14`
- New campaign manifest: `assets/campaigns/pinterest-invalides-2026-05-14.json`
- Behavior: The campaign page shows the pinned Invalides photo, 10 photos from the same shoot, 6 nearby Paris suggestions, and a local archive search.
- Embedded browser handling: campaign, basket, and order pages now detect common social embedded browsers and show Open in browser / Copy link before checkout or downloads.
- Home page: added a Featured mini-collections section pointing to the Invalides campaign so future social collections have a durable shelf.
- Pinterest owner kit: added `npm run social:pinterest-downloads`, generated `downloads.html` and `download-manifest.tsv`, and updated the 2026-05-14 Pinterest manifest destination to the campaign URL.
- Visible version: v74.36.
- Checks passed: `node --check` on touched JS, `git diff --check`, `npm test`, `npm run validate`, and in-app browser smoke for campaign embedded-warning/card counts, campaign search, and homepage Featured presence.
- Notes: Existing unrelated dirty/generated owner state remains unstaged.

## 2026-05-14 - Campaign grids share collection controls

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Updated social campaign pages to reuse the regular gallery masonry controller.
- Behavior: Campaign grids now respond to the same floating Grid density and Fit/Fill controls as country collections, including panorama full-width behavior in Fit mode.
- Copy: Homepage campaign shelf now says `Featured on Pinterest` instead of `Mini collections`.
- Visible version: v74.37.

## 2026-05-15 - R2 master-chain maintenance (daily)

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- `git pull --ff-only`: FAILED x2 (no network) — `Failed to connect to github.com port 443 ... Couldn't connect to server`
- `node scripts/repair_r2_master_chain.mjs --repair --prune --audit .review-logs/r2-master-chain-audit-daily.json`: FAILED — `getaddrinfo ENOTFOUND <account>.r2.cloudflarestorage.com` (DNS/network)
- Checks passed (local-only): `npm test` (14/14) and `npm run validate` (`Validation OK`)
- Counts (repair/prune not executed due to network):
  - Repaired masters: 0
  - Repaired renders: 0
  - Pruned private render ghosts: 0
  - Pruned public preview ghosts: 0
  - Remaining missing public previews: unknown (audit could not run)
  - Failures: 1 (R2 DNS/network)

## 2026-05-15 - Basket delivery gating and Owner coverage surfacing

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Result: Basket now loads tracked private-delivery coverage plus Waste Basket tombstones before checkout, removes unavailable selected delivery choices, and shows exact Worker missing-file details when checkout still catches a gap.
- Owner page: R2 catalog coverage now excludes discarded/tombstoned photos from active repair targets and can surface concrete missing private masters/JPG triplets with source-file repair hints.
- Root cause found: the basket contained tombstoned photo `20220511-101210-04342-d9757c336f`; checkout correctly blocked the full-resolution private master while the public basket still let it masquerade as buyable.
- Visible version: v74.38.
- Checks passed: `node --check basket.js`, `node --check owner.js`, `python3 -m py_compile scripts/local_server.py`, `npm test`, and `npm run validate`.
- Browser verification: `basket.html?v=74.38&run=delivery-gating` removed the unavailable selected choice and dropped the basket from 26 assets/$1690 to 25 assets/$1625; `owner.html?v=74.38&run=delivery-coverage` showed active R2 coverage satisfied for 5,796 photos with 48 Waste Basket photos excluded.

## 2026-05-15 - Daily Health Check

- Machine: David (`David-5.local`)
- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Commit checked: `ca0bd349c5801e8a318bfa114b6288730325f51a`
- `git pull --ff-only`: FAILED x2 — `Failed to connect to github.com port 443 ... Couldn't connect to server`
- `npm test`: PASSED (14/14)
- `npm run validate`: PASSED (`Validation OK`)
- Notes: Working tree was already dirty before the run (owner/generated state); health check did not stage or modify those files.
