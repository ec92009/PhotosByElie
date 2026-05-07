# photosByElie Codex Review 2026-05-07

Reviewed at: 2026-05-07 00:00 Europe/Madrid

1/ General architecture:
- The product is now a serious static photo commerce/gallery app. The biggest architecture risk is `photos-data.js` at roughly 35k lines; move toward generated data shards or JSON artifacts consumed by stable viewer code.
- Keep the static deployment model, but separate source catalog data, generated media metadata, and hand-written application logic.
- The scripts folder has useful asset tooling; define one authoritative build/sync pipeline so thumbnails, R2 media state, hidden/liked/basket data, and exports stay consistent.

2/ UI:
- The gallery/viewer surfaces need predictable controls across country pages, detail pages, basket, liked, and owner flows.
- Large photo sets require strong loading states, empty states, and progressive image behavior so pages feel intentional even on slower devices.
- Keep owner/hidden tools visually distinct from public buying/browsing surfaces.

3/ UX:
- Prioritize the buyer journey: browse, inspect, like, basket, reserve/order, and delivery should feel like one continuous path.
- Add explicit recovery for missing media, stale basket entries, unavailable photos, and failed reserve/delivery actions.
- Make category/country navigation and search/filter state shareable through URLs where practical.

4/ Testing:
- Add data validation for generated photo records: required fields, duplicate IDs, valid media paths, dimensions, country/category consistency, and public/private flags.
- Add static smoke tests for every public page plus core flows: open gallery, open detail, like, add to basket, basket persistence.
- Add script tests around Lightroom export, R2 sync metadata, and digital delivery generation.

5/ Everything else:
- There is one pre-existing untracked file, `home-v66-41.png`; keep it intentionally handled in the next media sync/review.
- The repo has strong SOPs. The next maintenance win is making generated data reproducible and easy to diff.
- Keep review logs, curation logs, and owner-only artifacts clearly separated from deployable public assets.

6/ My suggetions:
1. Split `photos-data.js` into generated shards or JSON plus a loader.
2. Add a photo-data validation command and run it before deploys.
3. Add smoke tests for gallery/detail/liked/basket flows.
4. Consolidate asset sync into one documented pipeline.
5. Review and either commit or discard `home-v66-41.png`.
