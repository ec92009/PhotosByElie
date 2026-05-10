# photosByElie Codex Review 2026-05-10

Timestamp: 2026-05-10 02:04 CEST

1/ General architecture:

- The project has grown into a real static commerce/gallery system with Worker checkout, R2/KV delivery, local curation scripts, and very large generated catalogs. It needs stricter source-of-truth boundaries.
- `photos-data.js` and `worker/photos-catalog.generated.mjs` are each roughly half a million lines. Treat generated catalog size as an architectural constraint, not just an artifact.

2/ UI:

- The public gallery, owner tools, liked/hidden/reserve paths, basket, and order flow need consistent state language so users know what is public, private, hidden, reserved, liked, or deliverable.
- Large galleries should prioritize perceived performance: progressive loading, collection counts, clear loading states, and stable grid sizing.

3/ UX:

- The curation workflow is the core operator experience. It should be guided as ingest -> classify -> hide/reserve/select -> validate -> publish -> fulfill.
- Checkout and delivery should make failure states legible: unpaid, paid but ZIP pending, expired link, missing source asset, and retryable Worker error.

4/ Testing:

- There is a Worker test and publish validation script, which is good. Expand coverage around catalog/manifest consistency, delivery token behavior, ZIP creation, and expired/missing assets.
- Add performance budgets for generated JS/catalog payload size and gallery load behavior.

5/ Everything else:

- There are pre-existing uncommitted changes in this repo; keep them separate from review-file automation work.
- Document which manifests are source, generated, deploy-only, local-only, or ignored reserve/hidden state.

6/ My suggetions:

1. Document source-of-truth status for every catalog, manifest, generated file, and local-only asset folder.
2. Add validation tests for catalog/manifest consistency and generated payload size budgets.
3. Build a guided curation command for ingest, classify, hide/reserve, assign, validate, and publish.
4. Expand Worker tests for checkout, ZIP creation, token expiry, missing assets, and retryable failures.
5. Add public gallery performance budgets and lazy-loading checks for large collections.
