# Conversation Summary

Date: 2026-05-13

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v74.5`
- Local Owner mutations require the helper server: `python3 scripts/local_server.py 8000`.
- Handoff direction is hostname-based: Max reads `DAVID2MAX.md` and writes `MAX2DAVID.md`; David reads `MAX2DAVID.md` and writes `DAVID2MAX.md`.
- Public previews, private masters, private render JPGs, and source/JPG embedded metadata remain immutable after upload. Owner title/keyword work updates generated catalog/manifest files and owner-action JSON only.
- There is dirty local Owner-generated state from live review interactions. Do not revert or stage it casually:
  - `assets/owner-actions/title-keyword-review-queue/proposed-state.json`
  - `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`
  - `home-data.js`
  - `photos-data.js`
  - `worker/photos-catalog.generated.mjs`
- Repo-wide `npm test` / `npm run validate` are currently expected to fail until the dirty generated catalog state is reconciled, because it has `sourceOrigin`/pricing inconsistencies.

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
- H/X on the review page are keyboard shortcuts for Block/Blocked, not discard. Blocked rows disappear immediately after the helper confirms success.
- Single-click selects a review row without navigation. Double-click opens the photo detail page.
- Keyboard shortcuts on the review page:
  - `A`: approve selected row
  - `R`: reject selected row
  - `P`: propagate selected row's approve/reject state to same-gallery rows within a two-hour capture window
  - `H` / `X`: block selected row
  - double-click: detail
- Owner page comments were addressed:
  - Classification eyebrow now says `Country Classification`.
  - Title/Keywords card no longer implies the queue is always exactly 100 rows.
  - Owner busy/status text is clearer for long-running actions.
  - Blocked sync explains why `0` previews still public is good.
  - Price list copy explicitly says dollars / USD.
- The current review page URL is `http://localhost:8000/title-keyword-review.html?v=74.5`.

## Important Safeguards

- Do not rewrite JPG/source embedded metadata, public previews, private masters, or private render files during title/keyword cleanup.
- Do not use `assets/owner-actions/keyword-blacklist.json` to filter photos. Use it only to prevent proposed/generated keywords from containing blacklisted terms.
- Do not auto-apply generated proposals. Only Owner review actions should apply catalog metadata.
- Keep approval/rejection/proposal records in tracked owner-action JSON, not image files.
- Treat `hide` as the internal helper action name for owner-facing Blocked/Block. Treat `discard` as the separate stronger removal/tombstone/media-cleanup path.
- Run `npm test` and `npm run validate` before committing generated metadata or behavior changes once the local dirty catalog state is reconciled.

## Fresh Numbered Backlog

1. Reconcile the dirty Owner-generated review state.
2. Regenerate and validate the next Title/Keywords queue after reconciled approvals.
3. Add a true vision-capable proposal pass for title/keyword generation.
4. Add an Owner review batch summary panel.
5. Prove Stripe checkout in test mode.
6. Make checkout and delivery production-durable.
7. Package the buyer offer clearly.
8. Move prices into a dedicated published price list.
9. Curate the first sellable storefront.
10. Add conversion analytics.
11. Improve public discovery and SEO.
12. Build marketing landing pages.
13. Prepare launch and sales outreach.
14. Move public media from `r2.dev` to a custom media domain.
15. Parameterize gallery routes and split catalog data by collection.
16. Refine gallery merchandising layout.
17. Replace keyword cleanup with a modal workflow.
18. Make country collections open-ended.
19. Extend Owner operations dashboard.
20. Harden Owner identity and publish validation.

## Verification Snapshot

- Latest behavior commit before this docs refresh: `7277e863 photosbyelie: filter saved review rows`.
- Latest report commit before this docs refresh: `64a6b7f0 photosbyelie: report saved review row policy`.
- Browser check for `v74.4` showed the review page loading successfully and filtering saved rows from the current local approval record.
- `node --check title-keyword-review.js` passed for the saved-row policy change.
