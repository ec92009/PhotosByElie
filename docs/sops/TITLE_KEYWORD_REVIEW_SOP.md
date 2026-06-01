# Title / Keyword Review SOP

This SOP defines the Owner title/keyword proposal workflow.

## State Flags

- `Title_Keywords_Proposed`: a proposal has already been generated for the photo. The nightly queue should skip this photo unless it has been rejected for rework.
- `Title_Keywords_Rejected`: Owner rejected the latest proposal and wants the photo prioritized for a new proposal.
- `Title_Keywords_Parked`: the current local tooling could not produce a defensible non-placeholder title, so the photo is parked outside the active review queue until better tooling or manual reset is available.
- `Title_Keywords_Reviewed`: Owner approved and applied the title/keyword metadata. The nightly queue should always skip this photo.

Proposal/rejection state lives in local `assets/owner-actions/Owner.sqlite`, which is the source of truth for title/keyword review state and the target for durable state updates. Public approved title/keyword metadata belongs in the generated plain SQLite catalog artifact: `assets/catalog/photosbyelie.sqlite`. JSON files under `assets/owner-actions/title-keyword-review-queue/` are ignored localhost review-page views or audit artifacts only; do not commit them, deploy them, or use them as authoritative state. Approved metadata lives in generated catalog/state files only. Do not write source-file embedded metadata, public previews, private masters, private render files, or Brotli catalog artifacts.

`assets/owner-actions/title-keyword-review-queue/proposed-state.json` is retired. The active queue/proposal state is `Owner.sqlite:title_keyword_queue` plus `title_keyword_proposals` and `title_keyword_decisions`.

## Nightly Generation

1. Start from the current allowed local checkout. For ordinary manual runs where network/GitHub access is allowed, fast-forward `main` before generating; for no-remote automation prompts, do not fetch, pull, or push.
2. Run `node scripts/generate_title_keyword_review_queue.mjs --limit 100`.
3. The generator must:
   - Read counts, candidate eligibility, proposal/review state, rejection counts, rework priority, and parked status from `assets/owner-actions/Owner.sqlite`.
   - Write durable proposal/rejection/parked state updates to `Owner.sqlite`; write JSON only as a derived review-page batch view or audit artifact.
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
   - Record the actual generator/model used for every proposal. Rework should escalate to the next stronger available model/generator level; park only after the model ladder is exhausted or the Owner explicitly parks/blocks the photo.
   - The default ladder starts with local metadata rules, then Codex-backed model aliases. `PBE_TITLE_KEYWORD_MODEL_LADDER`, `PBE_TITLE_KEYWORD_GENERATOR_MODEL`, `PBE_TITLE_KEYWORD_MODEL_RETRIES`, `PBE_TITLE_KEYWORD_MODEL_TIMEOUT_MS`, and `PBE_TITLE_KEYWORD_CODEX_BIN` may tune the generator for a run.
   - If a Codex-backed model attempt fails validation or times out, keep the photo out of the active batch, export a `model_blocked` row in `latest.json`, and leave durable state in `Owner.sqlite` so the next handoff can see which model was requested and why it blocked.
   - If the original title is acceptable and the original non-blacklisted keywords already meet the keyword target, mark the row reviewed/applied in `Owner.sqlite` without sending it through Owner approval again. These no-change-reviewed rows do not consume the 100 ordinary-new-photo quota.
   - If the only meaningful difference is removing blacklisted keywords, keep the row reviewable as a blacklist-only cleanup proposal and make the removed original keywords visible in the Owner review UI.
4. The generator updates `Owner.sqlite`, then writes proposal batches and `latest.json` under ignored `assets/owner-actions/title-keyword-review-queue/` as localhost review-page views derived from SQLite state.

Use JSON backfill/sync commands only for migration or recovery. Normal nightly review work must not rebuild or score authoritative state from JSON when `Owner.sqlite` is available.

## Owner Page

Keep `owner-review.html?view=title-keywords` compact: one photo per row and four columns only.

Columns:

1. Preview image.
2. Old title/keywords.
3. Proposed title/keywords.
4. Decision controls.

Decision controls include an Approve checkbox plus visible horizontal, mutually exclusive reject-reason checkboxes: incorrect, too generic, placeholder, use keywords, add details, use shoot, and other. Choosing any reject reason checks Reject internally, unchecks Approve, fills the reject note, leaves the note editable, and clears the other reject reasons. Existing previous reject notes must load unchanged for the Owner to edit or expand upon. Typing in the reject comment checks Reject and unchecks Approve. Clicking Approve does not erase the comment; it greys/read-onlys the comment until the Owner interacts with the comment again, which reactivates Reject.

Rows autosave as soon as the Owner approves, rejects, comments, or manually edits a proposed title/keyword. Editing proposed title/keywords automatically checks Approve. Save approvals at the top/bottom remains as a retry/manual batch-save control. Keep the header back-to-top control.

For blacklist-only cleanup rows, the current/original keyword field should visually mark removed blacklisted terms so the Owner can see that the proposed change is only keyword cleanup.

Video rows must show the standard centered play-triangle overlay on the preview thumbnail so they are visually distinguishable during review.

The page supports row selection. Single-click selects a row without opening detail. Double-click opens detail. Keyboard shortcuts apply to the selected row:

- `A`: approve.
- `R`: reject using the default Incorrect reason.
- `P`: propagate the selected approve/reject state to rows from the same gallery within a two-hour capture window. For rejections, the reject note is propagated with the reject decision.
- `H` / `X`: block the photo using the same helper `hide` action as the visible Block button.

The Propagate and Block buttons must remain explicit and sit below the row status. Basketed rows disappear immediately after the helper confirms success. Approved/rejected rows remain visible in the current browser session, but when the Owner leaves or reloads the page, rows already saved in `approvals-<batch>.json` should no longer be shown.

## Save Behavior

Saving approvals may contain approvals, rejections, or both.

- Approved rows apply title/keyword values to generated catalog/state files and add `Title_Keywords_Reviewed`.
- Rejected rows do not apply metadata. They update `Owner.sqlite` with rejected/rework or parked state, the rejected title/keywords, and the Owner comment.
- Reject comments should be available to the next generation attempt so the rework can avoid repeating the same weak proposal.
- Parked rows remain in `Owner.sqlite` but are neither approved nor rejected; they should not be resubmitted until better title-generation tooling or an explicit manual reset is available.
- Save an ignored/local audit JSON under `assets/owner-actions/title-keyword-review-queue/` when the helper/review page needs it.
- Merge row autosaves into the audit JSON by `photo_id`; do not overwrite previous saved decisions for the same batch.

Run `npm test` and `npm run validate` before committing and pushing changed workflow, proposal, page, state, or report files.
