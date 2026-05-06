# Codex Review 2026-05-05

Generated: 2026-05-05 02:04:28 CEST

## 1. General Architecture

- `photos-data.js` is very large and should be treated as generated data with a clear source, schema, and validation step.
- Split owner-only curation tools from public gallery runtime so localhost workflows cannot leak into public behavior by accident.
- Consolidate basket, liked, hidden, reserve, and curation state into documented store modules with shared serialization rules.
- Keep image ingestion as a pipeline: source scan, reserve generation, curation pass, Expo publish, data export, and public smoke check.

## 2. UI

- The public gallery has many moving parts. Keep public navigation simple: collection, photo detail, basket, liked.
- Owner-only controls should be visually and structurally distinct from public pages, with localhost gating tested.
- Add clearer loading/empty/error states for missing image pairs, unavailable resolutions, and empty basket/liked views.
- Ensure the wide-screen basket rail never competes with photo inspection on narrower laptop widths.

## 3. UX

- Add a concise owner dashboard flow: ingest, curate, classify unknowns, review hidden, publish cap, export.
- Add confirmation and undo affordances for destructive curation actions such as hide, unhide, promote, and classify.
- Add a "why this resolution is available" explanation for full/JPG options when metadata or source dimensions limit choices.
- Add continuity cues between gallery, detail, liked, and basket so users understand selections persist locally.

## 4. Testing

- Add generated-data validation for `photos-data.js`: unique IDs, valid collection keys, existing image assets, matching 900/1800 pairs, and valid resolution metadata.
- Add browser tests for basket sync, liked sync, detail previous/next, localhost-only owner links, and curation keyboard actions.
- Add pipeline tests for `scripts/export_photos_data.py` and `scripts/apply_curation_pass.py` using tiny fixture folders.
- Add screenshot smoke tests for homepage, collection grid, detail, basket, liked, owner, unknown, and hidden review pages.

## 5. Everything Else

- There was already extensive unrelated uncommitted work in this repo before this review was written, including many image asset moves/additions/deletions.
- Avoid committing generated data or image churn without a manifest summary that explains collection counts and changed assets.
- Existing review files did not match the requested `Codex Review YYYY-MM-DD.md` pattern.
- No existing `Codex Review YYYY-MM-DD.md` file was found to archive during this run.

## Prioritized Backlog

1. Add validation for generated photo data and publishable asset pairs.
2. Add fixture-based tests for export and curation scripts.
3. Split public runtime modules from owner-only curation modules.
4. Add browser tests for basket, liked, detail navigation, and localhost-only owner gating.
5. Add an owner dashboard flow with ingest, curate, classify, hidden review, cap, and export steps.
6. Add screenshot smoke tests for public and owner pages.
7. Add manifest summaries for image/data publish changes.
