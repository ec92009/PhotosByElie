# photosByElie Codex Review 2026-05-08

Generated: 2026-05-08 00:00 Europe/Madrid

1/ General architecture

- PhotosByElie has grown from static gallery into a local owner workflow, publishing pipeline, R2 sync process, and checkout-worker prototype. The architecture needs stronger boundaries between public static viewer code, localhost-only owner tools, media pipeline scripts, and commerce worker code.
- Keep ignored/local assets and generated publish data clearly separated. The repo is close to becoming a system of record, so manifests and journals need schemas and validation.

2/ UI

- The public gallery, detail, liked, and basket surfaces should stay visually calm and photo-first. Avoid letting owner controls or debug concepts leak into public pages.
- The owner/unknown/hidden review tools need dense operational UI: counts, selected item, last action, undo availability, sync status, and publish eligibility should be visible without guessing.

3/ UX

- The localhost owner flow is powerful but complex. Focus next on reducing irreversible-feeling actions: clear undo, batch previews, and "what will publish" summaries.
- The basket/liked flow should make product options, resolution, digital delivery, and checkout mock/real status unmistakable.

4/ Testing

- There is one worker test, but the public/owner browser flows need more coverage. Add Playwright smoke tests for gallery filtering, detail navigation, basket sync, liked sync, owner hide/unhide, and unknown assignment.
- Expand `scripts/validate_publish.js` so it enforces media key presence, hidden blacklist exclusions, Expo cap behavior, and generated data consistency.

5/ Everything else

- This repo has the most operational risk around assets and publishing. The handoff docs are valuable; keep them current and make the validation script the gate before any publish.
- Consider writing a short data dictionary for `photos-data.js`, media manifests, hidden blacklist, R2 journal, and review snapshots.

6/ My suggetions:

1. Separate public viewer, owner tools, media pipeline, and checkout worker responsibilities in docs and folder structure.
2. Add Playwright smoke tests for public gallery/detail/basket/liked and localhost owner workflows.
3. Strengthen `scripts/validate_publish.js` around R2 media keys, hidden exclusions, Expo cap, and generated data.
4. Add an owner dashboard summary for counts, pending sync, hidden/unknown state, and publish eligibility.
5. Write a data dictionary for manifests, generated photo data, blacklist, and review snapshots.
