# Conversation Summary

Date: 2026-05-14

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v74.37`
- Recent pushed catalog/docs commits include `c6306eed photosbyelie: move public catalog to TSV` and `be5c6014 photosbyelie: refresh TSV migration notes`.
- Local Owner mutations require the helper server: `python3 scripts/local_server.py 8000`.
- Handoff direction on David: read `MAX2DAVID.md` as inbound context and write David reports to `DAVID2MAX.md`.
- Public previews resolve from R2/CDN keys. Do not restore local `assets/expo` or `assets/reserve` preview folders.
- Uploaded public previews, private masters, private render JPGs, and source/JPG embedded metadata are treated as immutable media except for explicit Waste Basket/discard cleanup.
- Title/keyword work updates generated catalog/manifest files and tracked owner-action JSON; it must not rewrite image metadata.
- There is dirty local Owner/generated state from live review and catalog work. Do not revert or stage it casually.

## Recent Conversation

- The Owner-facing blocked/hidden model was renamed and simplified into `Waste Basket`.
- Waste Basket means: basketed photos are live-blacklisted and can be put back; emptying deletes public previews, private masters, and private render triplets, then leaves durable tombstones so the same masters do not return.
- `Protect basket` became unnecessary in the simplified model. The live basket is the undo boundary; emptying is the permanent cleanup boundary.
- `P` on the Waste Basket page means `Put back`.
- The Owner page now combines Waste Basket status, cloud-object cleanup progress, and cost impact instead of splitting blocked-sync concepts across panels.
- Waste Basket purge was started, made faster, given better feedback, then intentionally suspended so the catalog-data migration could proceed. It can run later.
- Owner `Cloud bill forecast ($)` now shows storage month-to-date, expected current bill, next-month storage at the current rate, and telemetry gaps for Cloudflare operations/Worker CPU.
- Cloudflare usage telemetry is backburnered; R2 delete operations are free, but Worker request/CPU and R2 operation usage need Cloudflare analytics for invoice-grade reporting.
- The catalog payload was migrated away from the giant `photos-data.js` file:
  - `photos-data.js` is now a small compatibility bootstrap.
  - Public catalog data lives in `assets/catalog/collections.tsv` and `assets/catalog/photos.tsv`.
  - Compressed copies live beside them as `.gz`.
  - `assets/catalog/photos.tsv.gz` is about 577 KB.
- The browser contract remains `window.photosByElieData`, so current pages continue to work while the data is now TSV-backed.
- Pinterest/social buyer flow now lands on our own mini-collection page instead of a lone photo detail page. `campaign.html?c=pinterest-invalides-2026-05-14` shows the pinned Invalides photo, nine related shoot photos, six nearby Paris suggestions, and a local archive search.
- The homepage has a Featured on Pinterest section so future social campaigns have a first-party discovery shelf instead of becoming orphan entry points.
- Campaign grids now reuse the regular collection masonry controller, including Grid density and Fit/Fill view controls.
- Campaign, basket, and order pages detect common embedded social browsers and show an Open in browser / Copy link escape path, because Pinterest's in-app browser can block checkout redirects and downloads.
- The Pinterest owner kit remains internal; its manifest now points the Pin destination at the mini-collection campaign URL.
- Tooling was updated to read the TSV catalog:
  - publish validation
  - title/keyword queue generation
  - social package generation
  - Worker catalog generation
  - Worker tests and local Worker server
  - export/owner-state compatibility paths
- The version was bumped to `v74.37`.
- Browser smoke checks verified the Owner page and France gallery load through TSV at v74.37.
- Checkout pricing tests were updated to match restored Camera/AI tier pricing.
- The user framed a useful product-design heuristic:
  - Spec: imagine new behavior and describe what it should do.
  - Design: make it happen with the parts at hand, requiring as few new components as possible.

## Important Safeguards

- Do not rewrite JPG/source embedded metadata, public previews, private masters, or private render files during title/keyword cleanup.
- Do not use `assets/owner-actions/keyword-blacklist.json` to filter photos. Use it only to prevent proposed/generated keywords from containing blacklisted terms.
- Do not auto-apply generated proposals. Only Owner review actions should apply catalog metadata.
- Keep approval/rejection/proposal records in tracked owner-action JSON, not image files.
- Treat `hide` / blocked internals as the implementation behind owner-facing Waste Basket behavior.
- Treat `discard` and `Empty basket` as stronger cleanup/tombstone paths.
- Empty basket must preserve enough blacklist/tombstone state to prevent future imports/renders from resurrecting the same undesirable masters.
- Keep `photos-data.js` as a compatibility layer unless the dependent browser/Worker/tooling contract is deliberately changed.
- Run `npm test` and `npm run validate` before committing generated/catalog changes.

## Verification Snapshot

- Latest pushed TSV migration commit: `c6306eed photosbyelie: move public catalog to TSV`
- Browser smoke checks:
  - `http://127.0.0.1:8000/owner.html?v=74.37&run=tsv-catalog`
  - `http://127.0.0.1:8000/gallery.html?gallery=france&v=74.37&run=tsv-catalog`
- Passed:
  - `npm test`
  - `npm run validate`
  - `node --check photos-data.js scripts/catalog_tsv.cjs scripts/write_catalog_tsv.cjs scripts/validate_publish.js`
  - `python3 -m py_compile scripts/export_photos_data.py scripts/asset_state.py scripts/build_photo_state_db.py`
  - `git diff --check`
- Remaining local dirty/untracked items are outside the pushed TSV commit:
  - `AGENTS.md`
  - `assets/discarded/discarded-photo-ids.json`
  - `assets/expo-manifest.json`
  - `docs/sops/TITLE_KEYWORD_REVIEW_SOP.md`
  - `scripts/asset_state.py` unstaged prior hunks
  - `.tmp-social/`
  - `assets/owner-actions/reserve-data.json`
  - `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-13.json`
  - `scripts/build_photo_state_tsv.py`

## Fresh Numbered Backlog

1. Resume or intentionally defer the suspended Waste Basket purge.
2. Reconcile the remaining dirty Owner/generated state and decide what belongs in Git.
3. Finish the broader state TSV/export story around `scripts/build_photo_state_tsv.py`.
4. Split the public catalog into per-collection TSV shards so a gallery loads only its own rows.
5. Replace the synchronous TSV bootstrap with an async loader once dependent pages are ready.
6. Verify Waste Basket basket/put-back/empty behavior end to end on a tiny safe test set.
7. Regenerate and review the next Title/Keywords queue after state reconciliation.
8. Add a true vision-capable proposal pass for title/keyword generation.
9. Prove Stripe checkout in test mode.
10. Make checkout and delivery production-durable.
11. Package the buyer offer clearly.
12. Publish a real price and offer strategy.
13. Curate the first sellable storefront.
14. Add conversion analytics.
15. Improve public discovery and SEO.
16. Add more social/Pinterest featured campaigns and rotate them through the homepage Featured on Pinterest section.
17. Prepare launch and sales outreach.
18. Replace temporary `r2.dev` media URL with a custom media domain.
19. Refine gallery merchandising layout.
20. Add buyer account or order recovery only if needed.
21. Decide when physical goods return.
22. Replace keyword removal with an Owner keyword cleanup modal.
23. Make country collections open-ended.
24. Add gallery multi-select Owner metadata edits.
25. Extend the Owner operations dashboard.
26. Harden owner identity and publish validation.
27. Add an Owner state-table browser.
28. Keep long-horizon media/repo cleanup on the backburner until sales paths stabilize.
