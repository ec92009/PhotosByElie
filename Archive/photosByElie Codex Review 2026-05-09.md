# photosByElie Codex Review 2026-05-09

Generated: 2026-05-09 00:00 Europe/Madrid

1/ General architecture

- photosByElie has become a full static-first commerce/media system with owner tooling, manifests, worker checkout, R2 sync scripts, and generated catalogs. The architecture needs stricter boundaries between source code, generated catalogs, manifests, and local curation state.
- The generated `photos-data.js`, worker catalog, and JSON manifests are enormous. Treat them as build artifacts unless they intentionally serve as the deployable static database, and document that decision clearly.

2/ UI

- The public gallery, liked/basket flow, owner tools, and hidden/reserve flows need consistent navigation and state cues. Users should always know whether they are browsing public, liked, basket, owner, or hidden content.
- Owner/admin UI should expose curation actions with reversible confirmations and visible manifest side effects.

3/ UX

- Media curation is the critical workflow. The product should make ingestion, classification, hiding, reserving, country assignment, and publish validation feel like one guided pipeline.
- Checkout/digital delivery should show exact states: basket ready, payment pending, zip generation, delivery ready, expired, and failed.

4/ Testing

- There is a worker checkout test, but the repo needs broader coverage for manifest generation, publish validation, owner actions, hidden/reserve state, and delivery bundle creation.
- Add tests that prevent generated catalogs and sidecars from drifting out of sync with manifests.

5/ Everything else

- The worktree already has a user modification in `assets/discarded-media-manifest.json`; preserve it and avoid cleanup that rewrites curation state casually.
- Add size/performance budgets for generated data files so the public site remains fast as the catalog grows.

6/ My suggetions:

1. Document which large catalog/manifest files are source of truth versus generated deploy artifacts.
2. Add validation tests for manifest/catalog consistency and publish readiness.
3. Build a guided curation pipeline for ingest, classify, hide/reserve, assign, validate, and publish.
4. Add checkout/delivery state tests around worker, zip creation, expiry, and failures.
5. Add performance budgets for generated JS/JSON catalog size and gallery load time.
