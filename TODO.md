# Photos By Elie Backlog

Last updated: 2026-07-08

## Current Facts

- Public visible build: `v125.0`.
- Sidecar local build: `v126.2`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local preview: `http://localhost:8000/`.
- Public catalog source of truth: `assets/catalog/photosbyelie.sqlite`.
- Owner workflow source of truth: ignored local `assets/owner-actions/Owner.sqlite`.
- Public catalog integrity: `ok`.
- Public catalog scale: `7813` media rows.
- Gallery counts: AI `5100`, France `379`, Italy `70`, Mexico `31`, Portugal `214`, Slovakia `2`, Spain `1872`, USA `145`.
- Upload Bridge active approvals are clean: `0` uploadable items, `0` active blocked approved items, `0` missing keys, `0` blocked export failures.
- Picked-only Sidecar AI metadata queue is drained: `0` candidates.
- Uploaded-catalog registration dry-run is clean: `2719` candidates, `0` would register, all `already_in_catalog`.
- Sidecar review cleanup backlog: the `20` unknown-gallery/generic-title reset rows are resolved (`19` Benalmadena Aquarium videos approved/picked, `1` unsupported WhatsApp still tombstoned); the `24` persistent Photos export failures are repaired from verified external picGen PNG originals, uploaded to R2, approved/picked, re-queued, unblocked, and registered in the public catalog; the `63` unpicked/proposed rows are normalized back to `unreviewed` while preserving their proposed title/keyword context.
- Sidecar automation must use `~/Applications/PhotosByElie Photos Bridge.app` through LaunchServices for PhotoKit work. Do not call raw Swift or the bare bundle executable for scheduled Sidecar automation.
- Apple Photos with faces remains off limits.
- Public pages use the shared visible site version; Sidecar has its own version in `SIDECAR_VERSION`.
- `Owner.sqlite` remains ignored/local. Owner-action JSON files are compatibility views, audit files, or handoff artifacts, not primary workflow state when SQLite tables exist.

## Fresh Numbered Backlog

1. **Publish and verify the catalog registration.**
   - Commit/push the public catalog SQLite and generated Worker catalog when ready.
   - Confirm the public site shows `v125.0`.
   - Confirm public gallery counts include AI `5100`, Spain `1872`, and Italy `70`.
   - Spot-check repaired AI stained-glass previews and Benalmadena Aquarium video previews.
   - Confirm public quick previews match regular visitor delivery.

2. **Run one Owner title/keyword save smoke test on localhost.**
   - Edit a catalog-backed row title/keywords.
   - Confirm the visible title does not revert.
   - Confirm `worker/photos-catalog.generated.mjs` and `assets/catalog/photosbyelie.sqlite` stay in sync.

3. **Add a supported retry/reset command for Upload Bridge export blocks.**
   - Replace ad hoc SQL block clearing with a maintenance command.
   - It should clear selected active export blocks, retry through the normal bridge path, and optionally reset persistent failures to review.
   - Keep audit artifacts and Owner SQLite as the durable state path.

4. **Improve Sidecar review visibility for source/export failures.**
   - Surface `source-export-failed` rows with a clear status pill and review filter.
   - Show the last PhotoKit/local fallback error in the detail panel.
   - Provide a safe "ready to retry" action only after source repair.

5. **Tighten Upload Bridge metadata guard UX.**
   - Show why a row is metadata-blocked before queueing.
   - Keep the generic-title/no-gallery block list visible in the Upload Bridge rail.
   - Add a direct jump from a blocked row to metadata review.

6. **Create a compact post-upload health dashboard.**
   - Summarize picked approvals, covered R2 keys, uploadable rows, blocked rows, catalog registration candidates, and public catalog counts.
   - Use Owner SQLite and public SQLite as the authoritative sources.

7. **Finish source re-export de-duplication and cleanup.**
    - Use full source pathname plus modified date as the import anchor.
    - Same-path newer exports should overwrite previous generated masters, public previews, and private JPG triplets instead of creating duplicates.
    - Audit duplicate candidates before deleting anything.

8. **Add import source history management.**
    - Let Owner remove stale remembered folders, pin favorites, and inspect last-used path/time.
    - Keep `Owner.sqlite` authoritative; do not add another JSON state source.

9. **Review buyer support, refund, and license wording.**
    - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current policy draft.
    - Make delivery/recovery expectations explicit before heavier public traffic.

10. **Approve and deploy the real price and offer strategy.**
    - Review camera and AI price ladders.
    - After approval, update pricing, regenerate catalog/Worker artifacts, deploy the Worker, and run one low-value live proof purchase.

11. **Curate the first sellable storefront.**
    - Apply strong title/keyword approvals.
    - Block unsellable rows.
    - Pick featured collections and hero images.
    - Put the strongest commercial/travel/editorial sets first.

12. **Improve public discovery and SEO.**
    - Add richer per-gallery/per-photo metadata, Open Graph images, canonical URLs, structured data, and focused campaign metadata.
    - Keep Owner-only workflow details out of public page metadata.

13. **Move Real Estate PDF/video assembly fully cloud-side.**
    - Use saved selection manifests as job inputs.
    - Return durable view/download URLs plus job status and failure detail.
    - Keep local browsers out of production output creation.

14. **Run a full Real Estate client rehearsal.**
    - Import/publish/upload one client property set.
    - Save a selection, generate PDF/video, reopen from mobile, rename, and delete a throwaway product.

15. **Bring Etsy listing publishing online.**
    - Etsy API access is approved and smoke-tested locally.
    - Build the first listing-publisher pass as dry-run/draft payload generation from public catalog data and watermarked public previews only.

16. **Add a guarded checkout discount code for low-cost live payment rehearsals.**
    - Keep validation server-side in the checkout Worker.
    - Preserve Stripe minimum-charge, stale-basket, and availability checks.
    - Record original subtotal, discount, and paid total in order state.

17. **Keep repo/media cleanup deliberate.**
    - Follow `docs/sops/REPO_MEDIA_CLEANUP_SOP.md`.
    - Do not use GitHub as a media vault.
    - Protect `assets/catalog/photosbyelie.sqlite` as the active public catalog artifact.
    - Keep local Owner DB state out of git.

18. **Exercise and harden the D1-backed sandbox Access Console V8.**
    - Current V8 cloud backend is deployed with real cloud/D1 read-write paths, immediate D1-backed auth/session reads, audience groups, real-gallery picker/defaults, group create/edit/archive, group membership workbench, people filters, effective-access preview, gallery-permission preview, Worker policy testing, capability metadata, and audit/undo for reversible person/group access changes.
    - ACS9 front-end rehearsal adds selected-group invitations for email, copyable link, and QR payloads; this is a UI/design rehearsal until the D1 invitation tables and public accept routes are implemented.
    - Keep `ec92009@gmail.com` as the bootstrap break-glass admin during the D1 auth migration.
    - Exercise people, roles, group create/edit/archive, bulk add/revoke memberships, and reversible writes from the browser before granting real non-fixture users.
    - Keep clearly marked fixture people and event/group records with fake `.test` email addresses so role assignment and event access flows can be rehearsed without granting real people.
    - Snapshot before mutations, append audit entries, and prefer disable/revoke over hard delete.

19. **Extend audience groups into real gallery access flows.**
    - Add production invitation flows described in `docs/architecture/access-invitations.md`: email invites, share links, and QR-code invite URLs.
    - Let any authenticated person with active access to a given fixture/group invite others into that same scope when member invites are enabled.
    - Do not let ordinary members un-invite, revoke, disable, or grant broader roles; Owner/Admin keeps pending-invite revocation, accepted-membership disable/revoke, expiry, and audit controls.
    - Store invitation records in D1 with opaque token hashes, expiry, accept limits, inviter identity, invitee email when address-bound, and acceptance provenance on resulting memberships.
    - Add a public `/invite/<token>` accept page that requires Google sign-in, validates email binding/link scope/group state, creates group membership, and redirects to the assigned gallery.
    - Use ACS V8 gallery defaults and Worker policy decisions as the policy source for watermark, sale, download, PDF, video, member-original, and Owner-original preview behavior when public/event/RE gallery routes begin enforcing group access.
    - Default family/event groups toward member invites; keep Real Estate groups Owner/Admin-only unless a specific client is intentionally allowed to propagate access.

20. **Promote the Track B NewOwner shell into real cloud workflows.**
    - Replace remaining `track-b-cloud-shell-check` probes with real queued action types; the cloud queue already supports recent-action listing for Max/David reload continuity.
    - Enrich the `sidecar-culling-review` review workspace with thumbnails/previews, gallery/routing assignment, and clearer staged-decision audit feedback.
    - Reuse the same browser-mediated connector pattern for Apple Photos import and Real Estate source operations without moving source files into the public repo.

## Validation Before Publishing

- `python3 -m py_compile` for changed Python helpers.
- `node --check` for changed JavaScript/Worker files.
- `git diff --check`.
- Public catalog SQLite `PRAGMA integrity_check`.
- Sidecar Upload Bridge plan audit via `python3 scripts/sidecar_state_db.py --upload-bridge-plan`.
- Picked AI plan audit.
- Uploaded-catalog registration dry-run.
- Stale visible-version scan for `v124.0` / `v=124.0`.
