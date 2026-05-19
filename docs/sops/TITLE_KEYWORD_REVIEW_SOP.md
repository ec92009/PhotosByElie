# Title / Keyword Review SOP

This SOP defines the Owner title/keyword proposal workflow.

## State Flags

- `Title_Keywords_Proposed`: a proposal has already been generated for the photo. The nightly queue should skip this photo unless it has been rejected for rework.
- `Title_Keywords_Rejected`: Owner rejected the latest proposal and wants the photo prioritized for a new proposal.
- `Title_Keywords_Parked`: the current local tooling could not produce a defensible non-placeholder title, so the photo is parked outside the active review queue until better tooling or manual reset is available.
- `Title_Keywords_Reviewed`: Owner approved and applied the title/keyword metadata. The nightly queue should always skip this photo.

Proposal/rejection state lives in local `assets/owner-actions/Owner.sqlite`, which is the source of truth for title/keyword review state and the target for durable state updates. The tracked JSON files under `assets/owner-actions/title-keyword-review-queue/` are compatibility exports, audit artifacts, or temporary transport files for the current Owner page. Do not use those JSON files as authoritative state when SQLite contains the same workflow state. Approved metadata lives in generated catalog/state files only. Do not write source-file embedded metadata, public previews, private masters, or private render files.

## Nightly Generation

1. Pull `main` with `git pull --ff-only origin main`.
2. Run `node scripts/generate_title_keyword_review_queue.mjs --limit 100`.
3. The generator must:
   - Read counts, candidate eligibility, proposal/review state, rejection counts, rework priority, and parked status from `assets/owner-actions/Owner.sqlite`.
   - Write durable proposal/rejection/parked state updates to `Owner.sqlite` first; write JSON only as a derived compatibility export or audit artifact.
   - Work newest backward.
   - Prioritize photos marked rejected/rework before ordinary new photos.
   - Include all eligible rejected/rework photos first; these are a priority add-on and do not count against the ordinary-new-photo limit.
   - Then add up to 100 ordinary new photos, newest first, where available.
   - Do not sort all candidates with rework first and then take the first 100 total rows, because each rework row would incorrectly replace one ordinary new photo.
   - Skip photos with `Title_Keywords_Reviewed`.
   - Skip photos with `Title_Keywords_Parked`.
   - Skip photos with `Title_Keywords_Proposed` unless they also have rejected/rework state.
   - If a rejected/rework photo still cannot get a non-placeholder title, move it to `Title_Keywords_Parked`, clear rework priority, and keep filling the ordinary-new-photo batch.
   - If an ordinary new photo cannot get a non-placeholder title from local metadata, move it to `Title_Keywords_Parked` and continue selecting newer-to-older candidates until the ordinary-new-photo limit is reached or eligible photos run out.
   - Exclude blacklisted keywords from proposed keywords, without using the blacklist to filter photos.
   - Prefer preview-pixel/vision inspection when available.
   - Use catalog/source path metadata only as fallback, and mark uncertain rows `needs_owner_context`.
   - Avoid filename-style titles as improved proposals.
   - Attempt at least 10 proposed keywords per photo.
4. The generator updates `Owner.sqlite`, then writes proposal batches, `latest.json`, and `proposed-state.json` under `assets/owner-actions/title-keyword-review-queue/` as compatibility exports derived from SQLite state.

Use JSON backfill/sync commands only for migration or recovery. Normal nightly review work must not rebuild or score authoritative state from JSON when `Owner.sqlite` is available.

## Owner Page

Keep `owner-review.html?view=title-keywords` compact: one photo per row and four columns only.

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

The Propagate button must remain explicit and sit below the row status. Basketed rows disappear immediately after the helper confirms success. Approved/rejected rows remain visible in the current browser session, but when the Owner leaves or reloads the page, rows already saved in `approvals-<batch>.json` should no longer be shown.

## Save Behavior

Saving approvals may contain approvals, rejections, or both.

- Approved rows apply title/keyword values to generated catalog/state files and add `Title_Keywords_Reviewed`.
- Rejected rows do not apply metadata. They update `Owner.sqlite` and the `proposed-state.json` compatibility export with rejected/rework state, the rejected title/keywords, and the Owner comment.
- Reject comments should be available to the next generation attempt so the rework can avoid repeating the same weak proposal.
- Parked rows remain in `Owner.sqlite` and the `proposed-state.json` compatibility export but are neither approved nor rejected; they should not be resubmitted until better title-generation tooling or an explicit manual reset is available.
- Save an audit JSON under `assets/owner-actions/title-keyword-review-queue/`.
- Merge row autosaves into the audit JSON by `photo_id`; do not overwrite previous saved decisions for the same batch.

Run `npm test` and `npm run validate` before committing and pushing changed workflow, proposal, page, state, or report files.
