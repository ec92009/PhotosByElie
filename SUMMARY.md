# Conversation Summary

Date: 2026-05-15

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v74.38`
- Handoff direction on David: read `MAX2DAVID.md` as inbound context and write David reports to `DAVID2MAX.md`.
- Local Owner mutations require the helper server: `python3 scripts/local_server.py 8000`.
- Public catalog data is TSV-backed through `assets/catalog/collections.tsv` and `assets/catalog/photos.tsv`; `photos-data.js` remains a compatibility bootstrap for `window.photosByElieData`.
- Public previews resolve from R2/CDN keys. Do not restore local `assets/expo` or `assets/reserve` preview folders.
- Uploaded public previews, private masters, private render JPGs, and source/JPG embedded metadata are immutable except for explicit Waste Basket/discard cleanup.
- Title/keyword work updates generated catalog/manifest files and tracked owner-action JSON; it must not rewrite image metadata.
- There is dirty local Owner/generated state from live review, catalog, and approval testing. Do not revert or stage it casually.

## Recent Conversation

- The buyer checkout bug was traced to a basket item for a discarded/Waste Basket tombstone photo. The private-delivery manifest still had a stale-present master record, but the stronger product rule is that tombstoned photos are not sellable.
- Basket rendering now loads private delivery coverage and discarded tombstones before checkout-sensitive decisions.
- Basket selections are pruned when selected private masters or JPG triplets are unavailable, and discarded tombstone photos are removed from sellable selections even if browser localStorage still contains them.
- Checkout errors now include the exact missing photo ID, product, and object key instead of only reporting a generic file count.
- Owner R2 coverage now excludes discarded/Waste Basket tombstones from active repair targets.
- Owner R2 coverage can surface missing private masters or JPG triplets and mark whether a repair can be made from a Saturn/source file.
- The v74.38 browser smoke check showed the basket pruning the stale tombstoned full-resolution item and the Owner page reporting active catalog coverage as satisfied with Waste Basket media excluded.
- The helper endpoint `__photosbyelie/r2-coverage` currently reports active coverage satisfied for `5,796` active photos, with `48` discarded/Waste Basket photos excluded.
- The latest pushed implementation commit for this thread is `ca0bd349 photosbyelie: gate basket by delivery coverage`.
- A later local commit exists on `main`: `5a5ebf48 photosbyelie: daily health check 2026-05-15`; this doc refresh should push with it unless the branch changes before final push.
- The current working tree still has unrelated modified/untracked Owner/generated files, including local approval JSON, proposed-state, discarded IDs, expo manifest, and TSV state tooling. Leave them out unless intentionally reconciling state.

## Product Model

- Waste Basket is the Owner-facing model for unwanted photos.
- Basketed photos are live-blacklisted and can be put back before emptying.
- Emptying the basket deletes public previews, private masters, and private render triplets, then leaves durable tombstones so the same masters do not return.
- Tombstoned photos are not buyer inventory, even if stale browser basket state or stale private-delivery manifests still mention them.
- Private buyer delivery is gated by actual private master/render availability.
- When private files are missing for active photos, the Owner page should surface them and prefer Saturn/source-file repair when possible.

## Important Safeguards

- Do not rewrite JPG/source embedded metadata, public previews, private masters, or private render files during title/keyword cleanup.
- Do not use `assets/owner-actions/keyword-blacklist.json` to filter photos. Use it only to prevent proposed/generated keywords from containing blacklisted terms.
- Do not auto-apply generated proposals. Only Owner review actions should apply catalog metadata.
- Keep approval/rejection/proposal records in tracked owner-action JSON, not image files.
- Treat `hide` / blocked internals as implementation details behind Owner-facing Waste Basket behavior.
- Treat `discard` and `Empty basket` as stronger cleanup/tombstone paths.
- Empty basket must preserve enough blacklist/tombstone state to prevent future imports/renders from resurrecting the same undesirable masters.
- Keep `photos-data.js` as a compatibility layer unless the dependent browser/Worker/tooling contract is deliberately changed.
- Run `npm test` and `npm run validate` before committing generated/catalog/code changes.

## Verification Snapshot

- Latest delivery-gating implementation commit: `ca0bd349 photosbyelie: gate basket by delivery coverage`
- Passed during that implementation:
  - `npm test`
  - `npm run validate`
  - `node --check basket.js`
  - `node --check owner.js`
  - `python3 -m py_compile scripts/local_server.py`
  - `git diff --check`
- Browser checks:
  - `http://localhost:8000/basket.html?v=74.38&run=delivery-gating#checkout`
  - `http://localhost:8000/owner.html?v=74.38&run=delivery-coverage`

## Fresh Numbered Backlog

1. Reconcile remaining dirty Owner/generated state and decide what belongs in Git.
2. Prove Stripe checkout in test mode end to end.
3. Make checkout and delivery production-durable with real order state.
4. Move the published price list into a shared data file used by basket and Worker validation.
5. Resume or deliberately defer the suspended Waste Basket cloud-object cleanup.
6. Verify Waste Basket empty/put-back/tombstone behavior on a tiny safe test set.
7. Finish the broader TSV/state export story and decide whether `scripts/build_photo_state_tsv.py` becomes canonical.
8. Split public catalog TSV by collection so gallery pages can load only their own rows.
9. Replace the synchronous TSV bootstrap with an async catalog-ready loader once page code is ready.
10. Regenerate and review the next Title/Keywords queue after state reconciliation.
11. Add a true vision-capable title/keyword proposal pass.
12. Package the buyer offer clearly: rights, resolution, delivery, refunds, contact, and AI-origin handling.
13. Curate the first sellable storefront and first featured campaigns.
14. Add privacy-conscious conversion analytics and paid-order reporting.
15. Improve public discovery and SEO.
16. Add more Featured on Pinterest campaign pages and rotate them through the homepage.
17. Prepare launch and sales outreach.
18. Replace the temporary `r2.dev` media endpoint with a custom media domain.
19. Refine gallery merchandising layout after sales-critical paths stabilize.
20. Add buyer account/order recovery only if guest checkout proves insufficient.
21. Decide when physical print/frame products return.
22. Replace keyword removal with an Owner keyword cleanup modal.
23. Make country collections open-ended.
24. Add gallery multi-select Owner metadata edits.
25. Extend the Owner operations dashboard.
26. Harden Owner helper/session naming and destructive-action validation.
27. Add an Owner state-table browser.
28. Keep long-horizon media/repo cleanup on the backburner until sales paths stabilize.
