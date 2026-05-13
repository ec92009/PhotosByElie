# Conversation Summary

Date: 2026-05-13

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v74.18`
- Local Owner mutations require the helper server: `python3 scripts/local_server.py 8000`.
- Handoff direction is hostname-based: Max reads `DAVID2MAX.md` and writes `MAX2DAVID.md`; David reads `MAX2DAVID.md` and writes `DAVID2MAX.md`.
- Public previews now resolve from R2/CDN keys only; do not restore local `assets/expo` or `assets/reserve` preview folders.
- Public previews, private masters, private render JPGs, and source/JPG embedded metadata remain immutable after upload. Owner title/keyword work updates generated catalog/manifest files and owner-action JSON only.
- There is dirty local Owner-generated state from live review interactions. Do not revert or stage it casually:
  - `assets/owner-actions/title-keyword-review-queue/proposed-state.json`
  - `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`
- Repo-wide `npm test` and `npm run validate` are currently passing after the R2 cleanup/backfill pass.

## Recent Conversation

- Built out the Title/Keywords Owner approval queue from a static proposal page into a working localhost review workflow.
- The nightly proposal generator writes tracked JSON under `assets/owner-actions/title-keyword-review-queue/`, skips `Title_Keywords_Reviewed`, avoids using the keyword blacklist to skip photos, and only uses the blacklist to remove useless proposed keywords.
- The review page remains compact: one photo per row with four conceptual columns: preview, current title/keywords, proposed title/keywords, and decision controls.
- Decision controls now include side-by-side Approve/Reject checkboxes, a vertical reject note, per-row status, and an explicit Propagate button under the status.
- Editing proposed title/keywords automatically checks Approve and queues a row save.
- Typing or interacting with the reject note checks Reject and unchecks Approve. Clicking Approve does not erase an existing comment; it greys/read-onlys the comment until the Owner interacts with it again.
- Rows autosave individually. The top/bottom Save approvals buttons remain as retries/manual batch saves.
- Row autosaves write/merge `approvals-<batch>.json` by `photo_id`; the helper now uses unique temp filenames to avoid concurrent autosave races.
- Approved rows apply title/keyword values to generated catalog/state files and add `Title_Keywords_Reviewed`.
- Rejected rows update `proposed-state.json` with rejection/rework priority and keep the Owner comment for the next proposal attempt.
- Saved approvals/rejections stay visible during the current page session. When the Owner leaves or reloads the approval page, the page reads `approvals-<batch>.json` and hides already-saved approved/rejected rows.
- H/X on the review page are keyboard shortcuts for Block/Blocked, not discard. Blocked rows disappear immediately after the helper confirms success, and the helper now writes blocked rows into the batch approval record so reloads keep them filtered out.
- Proposed review keywords are normalized case-insensitively, deduplicated, and filtered against `assets/owner-actions/keyword-blacklist.json` both when rendered on the page and when saved/applied by the helper.
- Single-click selects a review row without navigation. Double-click opens the photo detail page.
- Keyboard shortcuts on the review page:
  - `A`: approve selected row
  - `R`: reject selected row
  - `P`: propagate selected row's approve/reject state to same-gallery rows within a two-hour capture window
  - `H` / `X`: block selected row
  - double-click: detail
- Title/Keywords batch toolbar now uses explicit labels: `Approve visible` selects and autosaves visible rows, `Apply selected` performs the catalog metadata apply for checked approvals/rejections, `Export selected JSON` downloads the selected rows, and `Open proposal JSON` opens the raw proposal file.
- Owner page comments were addressed:
  - Classification eyebrow now says `Country Classification`.
  - Title/Keywords card no longer implies the queue is always exactly 100 rows.
  - Owner busy/status text is clearer for long-running actions.
  - Blocked sync explains why `0` previews still public is good.
  - Price list copy explicitly says dollars / USD.
- The current review page URL is `http://localhost:8000/owner-review.html?view=title-keywords&v=74.18`.
- Max's latest GitHub handoff was completed on David: R2-only preview cleanup plus R2 public-preview audit/backfill.
- R2 audit/backfill result: `5,844` public photos, `11,688` expected preview keys, `24` true initial missing keys, `24` uploaded from `tmp/import-cache`, `0` final missing after repaired-key HEAD verification.
- Cleanup result: `assets/expo` and `assets/reserve` are absent; `assets/hidden` keeps only `hidden-blacklist.json` and `hidden-data.json`.
- `scripts/export_photos_data.py` no longer regenerates per-country `.gitkeep` placeholder folders.

## Important Safeguards

- Do not rewrite JPG/source embedded metadata, public previews, private masters, or private render files during title/keyword cleanup.
- Do not use `assets/owner-actions/keyword-blacklist.json` to filter photos. Use it only to prevent proposed/generated keywords from containing blacklisted terms.
- Do not auto-apply generated proposals. Only Owner review actions should apply catalog metadata.
- Keep approval/rejection/proposal records in tracked owner-action JSON, not image files.
- Treat `hide` as the internal helper action name for owner-facing Blocked/Block. Treat `discard` as the separate stronger removal/tombstone/media-cleanup path.
- Run `npm test` and `npm run validate` before committing generated metadata or behavior changes once the local dirty catalog state is reconciled.
- R2 cleanup/backfill verification passed `npm test` and `npm run validate` on 2026-05-13.

## Fresh Numbered Backlog

1. Reconcile the dirty Owner-generated title/keyword review state.
2. Regenerate and validate the next Title/Keywords queue after reconciled approvals/rejections.
3. Add a true vision-capable proposal pass for title/keyword generation.
4. Add an Owner review batch summary panel.
5. Add a slow, resumable full R2 HEAD audit script so future audits avoid `429` noise.
6. Move public media from `r2.dev` to a custom media domain.
7. Prove Stripe checkout in test mode.
8. Make checkout and delivery production-durable.
9. Package the buyer offer clearly.
10. Move prices into a dedicated published price list.
11. Curate the first sellable storefront.
12. Add conversion analytics.
13. Improve public discovery and SEO.
14. Build marketing landing pages.
15. Split gallery/catalog data by collection.
16. Refine gallery merchandising layout.
17. Replace keyword cleanup with a modal workflow.
18. Make country collections open-ended.
19. Extend Owner operations dashboard.
20. Harden Owner identity and publish validation.

## Verification Snapshot

- Latest completed handoff commit: `84b0ba74 photosbyelie: complete r2 preview handoff`.
- Browser check for `v74.4` showed the review page loading successfully and filtering saved rows from the current local approval record.
- `node --check title-keyword-review.js` passed for the saved-row policy change.
- R2 cleanup/backfill checks:
  - Required grep: only hidden JSON-state references and prompt text remain.
  - Final repaired-key HEAD check: `24/24` HTTP `200`.
  - `npm test`: OK.
  - `npm run validate`: OK.
