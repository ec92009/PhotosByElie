# photosByElie Codex Review 2026-05-05

Generated: 2026-05-05 10:36:54 CEST

1/ General architecture

- photosByElie is now a substantial static photo commerce/archive app with generated data, many image assets, gallery filtering, detail pages, basket behavior, and owner-only local curation tools.
- The repo is very large and currently has extensive pre-existing dirty changes. I only archived the old root review file and added this review.
- The biggest architecture risk is generated data/assets living directly beside handcrafted UI code. Formalize the data generation pipeline and make it clear which files are source, generated, curated, or publish-only.

2/ UI

- The gallery controls are unusually rich for a static site: orientation, mood, subject, source, availability, sorting, density, detail navigation, and watermarks.
- The UI should expose active filter count and "clear filters" prominently. Large photo archives need fast recovery when users filter themselves into a sparse result set.

3/ UX

- The basket and detail availability logic is thoughtful. The next UX issue is confidence: users need to understand what resolution they are buying and whether full source exists.
- Owner-only moderation shortcuts are useful but should be impossible to expose publicly by accident. Keep localhost gating audited.

4/ Testing

- Add automated checks for `photos-data.js`: duplicate IDs, missing image files, missing 900/1800 pairs, unavailable resolution references, and broken detail links.
- Use Playwright smoke tests for home, each collection, detail navigation across collection boundaries, basket add/remove, and owner-only gating.

5/ Everything else

- Archive folder was created and the previous root `Codex Review 2026-05-05.md` was moved there.
- Consider Git LFS or a separate asset publishing pipeline if asset churn continues at this scale.

6/ My suggetions:

1. Add a generated-data integrity checker for photos, resolutions, and detail links.
2. Add Playwright smoke tests for gallery, detail, basket, and owner-only paths.
3. Document source/generated/published file ownership in `scripts/README.md`.
4. Add clear-filters UX and active filter count.
5. Evaluate Git LFS or split asset storage before the repo grows further.
