# photosByElie Codex Review 2026-05-06

Timestamp: 2026-05-06 02:02 CEST

## 1/ General architecture

- The site has grown into a static public gallery plus localhost owner/curation tooling; make that boundary explicit everywhere.
- Keep public data generation, local curation actions, basket state, likes, and detail navigation as separate modules.
- The asset volume is very large; catalog generation and publishable asset selection should be deterministic and auditable.
- Avoid mixing local-only operational logs with public-site source paths.

## 2/ UI

- Gallery density, filters, detail pages, basket rail, likes, and watermarks are now a full product surface; consistency matters more than new features.
- The owner-only UI should look operational and distinct from the public buying/browsing experience.
- Keep portrait/landscape detail layouts predictable so navigation does not jump between photos.

## 3/ UX

- Clarify the shopping path: like, choose resolution/product, basket, checkout/request. Any missing final commerce step should be obvious.
- Add public empty states for no filter results, empty likes, empty basket, and unavailable product choices.
- Keep keyboard shortcuts for local curation, but avoid showing operator hints on public pages.

## 4/ Testing

- Add deterministic catalog-generation tests for Expo/Reserve/Hidden transitions.
- Add Playwright smoke coverage for homepage, gallery filters, detail navigation, like/basket state, and localhost owner-only visibility.
- Add asset budget checks so accidental full-library publication is caught before push.

## 5/ Everything else

- Archive or ignore `.playwright-mcp` logs and local curation exports unless they are intentional audit fixtures.
- Keep `README.md` focused on current public/local workflows; the current behavior list is useful but long.
- Add a data-flow diagram for photo source metadata to public `photos-data.js`.

## 6/ My suggetions:

1. Document and enforce the public-vs-localhost boundary in code and tests.
2. Add catalog-generation tests for curation pass application and publishable asset caps.
3. Add Playwright smoke tests for gallery filters, detail navigation, likes, basket, and owner visibility.
4. Add asset budget checks before publishing.
5. Create a concise data-flow diagram for source metadata, catalogs, and public assets.
