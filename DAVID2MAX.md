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
- Commit pushed: pending (GitHub remote was unreachable from this environment); local commit: `cfcf4ee3`
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
