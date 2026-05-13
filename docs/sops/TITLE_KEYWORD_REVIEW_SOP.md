# Title / Keyword Review SOP

This SOP defines the Owner title/keyword proposal workflow.

## State Flags

- `Title_Keywords_Proposed`: a proposal has already been generated for the photo. The nightly queue should skip this photo unless it has been rejected for rework.
- `Title_Keywords_Rejected`: Owner rejected the latest proposal and wants the photo prioritized for a new proposal.
- `Title_Keywords_Reviewed`: Owner approved and applied the title/keyword metadata. The nightly queue should always skip this photo.

Proposal/rejection state lives in `assets/owner-actions/title-keyword-review-queue/proposed-state.json`. Approved metadata lives in generated catalog/state files only. Do not write JPG/source embedded metadata, public previews, private masters, or private render files.

## Nightly Generation

1. Pull `main` with `git pull --ff-only origin main`.
2. Run `node scripts/generate_title_keyword_review_queue.mjs --limit 100`.
3. The generator must:
   - Work newest backward.
   - Prioritize photos marked rejected/rework before ordinary new photos.
   - Fill the batch to 100 total photos where available.
   - Skip photos with `Title_Keywords_Reviewed`.
   - Skip photos with `Title_Keywords_Proposed` unless they also have rejected/rework state.
   - Exclude blacklisted keywords from proposed keywords, without using the blacklist to filter photos.
   - Prefer preview-pixel/vision inspection when available.
   - Use catalog/source path metadata only as fallback, and mark uncertain rows `needs_owner_context`.
   - Avoid filename-style titles as improved proposals.
   - Attempt at least 10 proposed keywords per photo.
4. The generator writes proposal batches, `latest.json`, and `proposed-state.json` under `assets/owner-actions/title-keyword-review-queue/`.

Use `node scripts/generate_title_keyword_review_queue.mjs --sync-proposed-state-only` to backfill proposal state from existing `batch-*.json` files without replacing the active review batch.

## Owner Page

Keep `title-keyword-review.html` compact: one photo per row and four columns only.

Columns:

1. Preview image.
2. Old title/keywords.
3. Proposed title/keywords.
4. Decision controls.

Decision controls include side-by-side Approve and Reject checkboxes plus an optional vertical reject comment. Approve and Reject are mutually exclusive. Typing in the reject comment checks Reject and unchecks Approve. Clicking Approve does not erase the comment; it greys/read-onlys the comment until the Owner interacts with the comment again, which reactivates Reject.

Rows autosave as soon as the Owner approves, rejects, comments, or manually edits a proposed title/keyword. Editing proposed title/keywords automatically checks Approve. Save approvals at the top/bottom remains as a retry/manual batch-save control. Keep the header back-to-top control.

The page supports row selection. Single-click selects a row without opening detail. Double-click opens detail. Keyboard shortcuts apply to the selected row:

- `A`: approve.
- `R`: reject.
- `P`: propagate the selected approve/reject state to rows from the same gallery within a two-hour capture window.
- `H` / `X`: block the photo using the helper's `hide` action.

The Propagate button must remain explicit and sit below the row status. Blocked rows disappear immediately after the helper confirms success. Approved/rejected rows remain visible in the current browser session, but when the Owner leaves or reloads the page, rows already saved in `approvals-<batch>.json` should no longer be shown.

## Save Behavior

Saving approvals may contain approvals, rejections, or both.

- Approved rows apply title/keyword values to generated catalog/state files and add `Title_Keywords_Reviewed`.
- Rejected rows do not apply metadata. They update `proposed-state.json` with rejected/rework state, the rejected title/keywords, and the Owner comment.
- Reject comments should be available to the next generation attempt so the rework can avoid repeating the same weak proposal.
- Save an audit JSON under `assets/owner-actions/title-keyword-review-queue/`.
- Merge row autosaves into the audit JSON by `photo_id`; do not overwrite previous saved decisions for the same batch.

Run `npm test` and `npm run validate` before committing and pushing changed workflow, proposal, page, state, or report files.
