# Photos By Elie Backlog

Last updated: 2026-07-05

## Current Facts

- Public visible build: `v125.0`.
- Sidecar local build: `v126.2`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local preview: `http://localhost:8000/`.
- Public catalog source of truth: `assets/catalog/photosbyelie.sqlite`.
- Owner workflow source of truth: ignored local `assets/owner-actions/Owner.sqlite`.
- Access Console Sandbox V2: deployed on `auth.photos-by-elie.com` with D1 database `photosbyelie-access`; local preview at `http://100.111.30.109:8000/access-console.html`; audience fixtures are `Agnes's B'day`, `RE La Concha`, and `Johnson-Palmer wedding`.
- Public catalog integrity: `ok`.
- Public catalog scale: `7770` media rows.
- Gallery counts: AI `5076`, France `379`, Italy `70`, Mexico `31`, Portugal `214`, Slovakia `2`, Spain `1853`, USA `145`.
- Upload Bridge active approvals are clean: `0` uploadable items, `0` active blocked approved items, `0` missing keys.
- Picked-only Sidecar AI metadata queue is drained: `0` candidates.
- Uploaded-catalog registration dry-run is clean: `2676` candidates, all `already_in_catalog`.
- Sidecar review cleanup backlog: `20` unknown-gallery/generic-title rows are back in unpicked rework; `24` persistent Photos export failures are back in unpicked rework; `63` unpicked/proposed rows are harmless but state-untidy.
- Sidecar automation must use `~/Applications/PhotosByElie Photos Bridge.app` through LaunchServices for PhotoKit work. Do not call raw Swift or the bare bundle executable for scheduled Sidecar automation.
- Apple Photos with faces remains off limits.
- Public pages use the shared visible site version; Sidecar has its own version in `SIDECAR_VERSION`.
- `Owner.sqlite` remains ignored/local. Owner-action JSON files are compatibility views, audit files, or handoff artifacts, not primary workflow state when SQLite tables exist.

## Fresh Numbered Backlog

1. **Review the 20 unknown-gallery reset rows.**
   - Open Sidecar Culling/Review with unpicked/rework filters.
   - Fix title, country/gallery, and keywords, or reject them.
   - Do not requeue until each row has a clear public gallery signal.

2. **Resolve the 24 source-export-failed rows.**
   - These are mostly AI stained-glass JPGs that Photos repeatedly failed to render/export.
   - Reimport from an available source file, replace the Photos asset, or reject them.
   - Clear their source-failure block only after the source path is actually repaired.

3. **Decide what to do with the 63 unpicked/proposed rows.**
   - They are not in active picked AI or upload lanes.
   - Either keep their proposed metadata as context or normalize them back to unreviewed/rework for a cleaner review state.

4. **Verify the pushed public deploy after GitHub Pages updates.**
   - Confirm the public site shows `v125.0`.
   - Confirm Italy shows `70` media items.
   - Spot-check repaired portrait previews in Italy, Spain, France, and AI.
   - Confirm public quick previews match regular visitor delivery.

5. **Run one Owner title/keyword save smoke test on localhost.**
   - Edit a catalog-backed row title/keywords.
   - Confirm the visible title does not revert.
   - Confirm `worker/photos-catalog.generated.mjs` and `assets/catalog/photosbyelie.sqlite` stay in sync.

6. **Add a supported retry/reset command for Upload Bridge export blocks.**
   - Replace ad hoc SQL block clearing with a maintenance command.
   - It should clear selected active export blocks, retry through the normal bridge path, and optionally reset persistent failures to review.
   - Keep audit artifacts and Owner SQLite as the durable state path.

7. **Improve Sidecar review visibility for source/export failures.**
   - Surface `source-export-failed` rows with a clear status pill and review filter.
   - Show the last PhotoKit/local fallback error in the detail panel.
   - Provide a safe "ready to retry" action only after source repair.

8. **Tighten Upload Bridge metadata guard UX.**
   - Show why a row is metadata-blocked before queueing.
   - Keep the generic-title/no-gallery block list visible in the Upload Bridge rail.
   - Add a direct jump from a blocked row to metadata review.

9. **Create a compact post-upload health dashboard.**
   - Summarize picked approvals, covered R2 keys, uploadable rows, blocked rows, catalog registration candidates, and public catalog counts.
   - Use Owner SQLite and public SQLite as the authoritative sources.

10. **Finish source re-export de-duplication and cleanup.**
    - Use full source pathname plus modified date as the import anchor.
    - Same-path newer exports should overwrite previous generated masters, public previews, and private JPG triplets instead of creating duplicates.
    - Audit duplicate candidates before deleting anything.

11. **Add import source history management.**
    - Let Owner remove stale remembered folders, pin favorites, and inspect last-used path/time.
    - Keep `Owner.sqlite` authoritative; do not add another JSON state source.

12. **Review buyer support, refund, and license wording.**
    - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current policy draft.
    - Make delivery/recovery expectations explicit before heavier public traffic.

13. **Approve and deploy the real price and offer strategy.**
    - Review camera and AI price ladders.
    - After approval, update pricing, regenerate catalog/Worker artifacts, deploy the Worker, and run one low-value live proof purchase.

14. **Curate the first sellable storefront.**
    - Apply strong title/keyword approvals.
    - Block unsellable rows.
    - Pick featured collections and hero images.
    - Put the strongest commercial/travel/editorial sets first.

15. **Improve public discovery and SEO.**
    - Add richer per-gallery/per-photo metadata, Open Graph images, canonical URLs, structured data, and focused campaign metadata.
    - Keep Owner-only workflow details out of public page metadata.

16. **Move Real Estate PDF/video assembly fully cloud-side.**
    - Use saved selection manifests as job inputs.
    - Return durable view/download URLs plus job status and failure detail.
    - Keep local browsers out of production output creation.

17. **Run a full Real Estate client rehearsal.**
    - Import/publish/upload one client property set.
    - Save a selection, generate PDF/video, reopen from mobile, rename, and delete a throwaway product.

18. **Bring Etsy listing publishing online.**
    - Etsy API access is approved and smoke-tested locally.
    - Build the first listing-publisher pass as dry-run/draft payload generation from public catalog data and watermarked public previews only.

19. **Add a guarded checkout discount code for low-cost live payment rehearsals.**
    - Keep validation server-side in the checkout Worker.
    - Preserve Stripe minimum-charge, stale-basket, and availability checks.
    - Record original subtotal, discount, and paid total in order state.

20. **Keep repo/media cleanup deliberate.**
    - Follow `docs/sops/REPO_MEDIA_CLEANUP_SOP.md`.
    - Do not use GitHub as a media vault.
    - Protect `assets/catalog/photosbyelie.sqlite` as the active public catalog artifact.
    - Keep local Owner DB state out of git.

21. **Exercise and harden the D1-backed sandbox Access Console V2.**
    - Current V2 is deployed with real cloud/D1 read-write paths, immediate D1-backed auth/session reads, audience groups, effective-access preview, and capability metadata.
    - Keep `ec92009@gmail.com` as the bootstrap break-glass admin during the D1 auth migration.
    - Exercise people, roles, group memberships, and reversible writes from the browser before granting real non-fixture users.
    - Keep clearly marked fixture people and event/group records with fake `.test` email addresses so role assignment and event access flows can be rehearsed without granting real people.
    - Snapshot before mutations, append audit entries, and prefer disable/revoke over hard delete.

22. **Extend audience groups into real gallery access flows.**
    - Add future join-code/password flows for family/event groups.
    - Connect real gallery records to group creation and per-gallery defaults for watermark, sale, download, PDF, and video access.
    - Add group management beyond fixture seeding: create/edit/archive groups, revoke memberships in bulk, and inspect group-specific audit trails.

## Validation Before Publishing

- `python3 -m py_compile` for changed Python helpers.
- `node --check` for changed JavaScript/Worker files.
- `git diff --check`.
- Public catalog SQLite `PRAGMA integrity_check`.
- Sidecar Upload Bridge plan audit via `python3 scripts/sidecar_state_db.py --upload-bridge-plan`.
- Picked AI plan audit.
- Uploaded-catalog registration dry-run.
- Stale visible-version scan for `v124.0` / `v=124.0`.
