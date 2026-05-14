# Conversation Summary

Date: 2026-05-13

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v74.30`
- Local Owner mutations require the helper server: `python3 scripts/local_server.py 8000`.
- Handoff direction on David: read `MAX2DAVID.md` as inbound context and write David reports to `DAVID2MAX.md`.
- Public previews resolve from R2/CDN keys. Do not restore local `assets/expo` or `assets/reserve` preview folders.
- Uploaded public previews, private masters, private render JPGs, and source/JPG embedded metadata are treated as immutable media except for explicit Waste Basket/discard cleanup.
- Title/keyword work updates generated catalog/manifest files and tracked owner-action JSON; it must not rewrite image metadata.
- There is dirty local Owner/generated state from live review and catalog work. Do not revert or stage it casually.
- Current known unrelated failures:
  - `npm test` fails checkout pricing assertions.
  - `npm run validate` reports existing generated catalog/media-origin/public-preview key issues.

## Recent Conversation

- Restored and then unified Blocked/Waste Basket review behavior.
- Owner-facing name is now `Waste Basket`.
- The separate blocked-sync/public-cleanup panel was merged into the Waste Basket card.
- Waste Basket now exposes one owner workflow:
  - `Review`: inspect unwanted photos.
  - `Empty basket`: purge public previews, private masters, and private render triplets for basketed photos, then leave blacklist/discard tombstones so those masters do not return.
- The extra Owner-facing `Protect basket` action was removed from the main model. Basket/put-back is the live blacklist boundary; emptying is the permanent tombstone/media deletion boundary.
- The blacklist/tombstone meaning is now explicit: “do not make that mistake again.”
- `P` on the Waste Basket page means `Put back`.
- `D` discards a selected basket item and leaves a tombstone.
- The earlier idea of a 24-hour automatic undo window was dropped. The owner decides when to take out the trash.
- Waste Basket page now shares the normal gallery paging shape:
  - 24 items initially.
  - external `Show more` and `Show all` controls.
  - shared Grid/Fit/Fill floating-control positioning.
  - shared card rendering with broken preview fallback.
- Owner dashboard combines Camera/AI and current catalog state into one `Catalog mix` card with a pie chart and raw counts.
- Owner-facing R2 coverage copy now says `Waste Basket` instead of `blocked`.
- Empty basket refreshes `In basket`, `Cloud media left`, and `Tombstones` immediately after the helper returns.
- Gallery Fit mode has the panorama span hook restored, so pano cards can span the full grid width in Fit mode.
- Gallery Grid/Fit/Fill controls now sit in the sticky header band when there is room and avoid the basket rail.
- Owner page language was simplified around the Waste Basket mental model instead of implementation terms like blocked sync.
- Waste Basket now reports preview-cleanup progress inline under `Cloud media left`; `Empty basket` only disables for a true basket-empty task, not for older preview-only cleanup jobs.
- Owner price list now defensively restores the canonical `Camera photo` and `AI image` digital pricing columns when local generated catalog state is stale.
- Waste Basket progress now keeps state counts in one place: `In basket` is the undo queue, `Cloud media left` is remaining media state, and preview-only cleanup progress is a subline rather than a separate panel.
- Owner now has a `Cloud bill forecast ($)` card fed by `assets/storage-estimate.json`. It shows consumed month-to-date storage cost, expected current-month storage bill, next-month storage at the current rate, the Workers Paid-plan base caveat, and telemetry gaps for R2 operations and Worker CPU/request overages.
- Title/Keywords review queue remains helper-server backed with autosave approve/reject/comment/edit, H/X block shortcuts, `A`/`R`/`P` shortcuts, row selection, and saved-row filtering after reload.
- Proposed title/keyword keywords are still normalized, deduped, and filtered through `assets/owner-actions/keyword-blacklist.json`.
- User articulated a useful working distinction:
  - Spec: imagine the new behavior and describe what it should do.
  - Design: make it happen with existing parts and as few new components as possible.
- Waste Basket was treated as a design exercise over existing hidden/blocked catalog, blacklist JSON, discard tombstones, and R2 delete tasks rather than a new subsystem.

## Important Safeguards

- Do not rewrite JPG/source embedded metadata, public previews, private masters, or private render files during title/keyword cleanup.
- Do not use `assets/owner-actions/keyword-blacklist.json` to filter photos. Use it only to prevent proposed/generated keywords from containing blacklisted terms.
- Do not auto-apply generated proposals. Only Owner review actions should apply catalog metadata.
- Keep approval/rejection/proposal records in tracked owner-action JSON, not image files.
- Treat `hide` / blocked internals as the implementation behind owner-facing Waste Basket behavior.
- Treat `discard` and `Empty basket` as stronger cleanup/tombstone paths.
- Empty basket must preserve enough blacklist/tombstone state to prevent future imports/renders from resurrecting the same undesirable masters.
- Run targeted syntax checks before committing JS/Python behavior changes.
- Run `npm test` and `npm run validate` before committing generated metadata once the current catalog/pricing validation issues are reconciled.

## Verification Snapshot

- Base Waste Basket cleanup commit: `979de98c photosbyelie: unify waste basket cleanup`.
- Latest report commit: `e3199bb6 photosbyelie: report waste basket cleanup`.
- Browser smoke checks on localhost `v74.25` verified Owner/Waste Basket wording.
- Browser smoke check on localhost `v74.26` verified the Waste Basket progress report and disabled `Emptying...` button while three cleanup jobs were active.
- Passed:
  - `node --check hidden-actions.js`
  - `node --check hidden-page.js`
  - `node --check owner.js`
  - `node --check photo-gallery.js`
  - `node --check photos.js`
  - `node --check title-keyword-review.js`
  - `python3 -m py_compile scripts/local_server.py`
  - `git diff --check`
- Known unrelated failures:
  - `npm test`: checkout pricing assertions.
  - `npm run validate`: generated catalog/source-origin/public-preview key validation issues.

## Fresh Numbered Backlog

1. Reconcile current generated catalog and checkout-pricing test failures.
2. Decide whether to keep and commit the dirty Owner approval/generated state.
3. Verify Waste Basket basket/put-back/empty behavior end to end on a small safe test set before using it broadly.
4. Regenerate and validate the next Title/Keywords queue after state reconciliation.
5. Add a true vision-capable proposal pass for title/keyword generation.
6. Prove Stripe checkout in test mode.
7. Make checkout and delivery production-durable.
8. Package the buyer offer clearly.
9. Publish a real price and offer strategy.
10. Curate the first sellable storefront.
11. Add conversion analytics.
12. Improve public discovery and SEO.
13. Create marketing landing pages.
14. Prepare launch and sales outreach.
15. Replace temporary `r2.dev` media URL with a custom media domain.
16. Split gallery/catalog data by collection.
17. Refine gallery merchandising layout.
18. Add buyer account or order recovery only if needed.
19. Decide when physical goods return.
20. Replace keyword removal with Owner keyword cleanup modal.
21. Make country collections open-ended.
22. Add gallery multi-select Owner metadata edits.
23. Extend Owner operations dashboard.
24. Harden owner identity and publish validation.
25. Add an Owner state-table browser.
