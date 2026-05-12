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
