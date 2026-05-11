# photosByElie Codex Review 2026-05-11

Review time: 2026-05-11 02:05 CEST.

1/ General architecture

- PhotosByElie has grown into a sophisticated static public site plus localhost owner tooling, generated catalogs, R2 media delivery, and a Worker checkout prototype.
- The split between public static pages and localhost-only owner mutation endpoints is the right safety boundary. Keep it explicit in code and docs.
- Generated manifests (`photos-data.js`, Worker catalog, Expo manifest) are central source-of-truth artifacts and should be validated before every publish.

2/ UI

- The public gallery surfaces are broad: country galleries, detail view, basket, liked page, filters, density controls, and basket rail.
- Owner surfaces are powerful but can become operationally dense. Keep dangerous actions like discard/delete visually distinct from reversible block/unblock actions.
- Public previews depend on external media routing; broken image states need polished fallbacks.

3/ UX

- The public UX is now closer to a real photo storefront, with basketed resolutions and liked photos.
- Owner UX is workflow-heavy: Unknown classification, Blocked review, metadata edits, R2 maintenance, and cloud sweeps. Locking and one-lane media sync are important and should be visible when running.
- The distinction between Blocked, Discarded, Unknown, and Expo should remain consistent everywhere.

4/ Testing

- No test files were found in the lightweight scan, but `scripts/validate_publish.js` exists and should be treated as a release gate.
- Add browser smoke tests for homepage catalog bootstrap, gallery filtering/sorting, detail previous/next, basket sync, liked sync, and owner localhost-only availability.
- Add generated-data consistency checks for photo IDs across public catalog, worker catalog, blocked/discarded tombstones, and R2 coverage reports.

5/ Everything else

- The repo was already dirty before this review: `assets/expo-manifest.json`, `photos-data.js`, and `worker/photos-catalog.generated.mjs` had modifications. Today's review did not attempt to resolve those.
- The README is comprehensive but long. Keep a short "operator path" near the top for the most common publish/review workflow.

6/ My suggetions:

1. Run and harden `scripts/validate_publish.js --external-media` as the required pre-publish check.
2. Add Playwright smoke tests for gallery, detail, basket, liked, and localhost owner-only access.
3. Add a generated-manifest diff report so catalog changes are reviewable before commit.
4. Make long-running R2 sweep lock/status visible in the Owner dashboard.
5. Resolve the current generated-data dirty state in a dedicated commit before larger feature work.
