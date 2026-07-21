# Photos By Elie Backlog

Last updated: 2026-07-21

## Current Facts

- Public visible build: `v143.7`.
- Sidecar local build: `v126.6`.
- Public site: `https://photos-by-elie.com/`.
- Local preview: `http://localhost:8000/`.
- North Star: `docs/architecture/north-star.md`; the overarching goal is to make money from the enterprise by optimizing sellable offers, buyer/client trust, private access, and market learning.
- Main near-term inventory: the Apple Photos library has `57K+` photos, many potentially usable for the public gallery/store; finishing intake-to-sellable-catalog flow takes priority over hypothetical Real Estate, family, and private event verticals.
- Public catalog source of truth: `assets/catalog/photosbyelie.sqlite`.
- Owner workflow source of truth: ignored local `assets/owner-actions/Owner.sqlite`.
- Access Console Sandbox V8 cloud backend plus ACS9 local front-end rehearsal: deployed on `auth.photos-by-elie.com` with D1 database `photosbyelie-access`; local preview at `http://100.111.30.109:8000/access-console.html`; group manager creates/edits/archives audience groups, connects groups to real gallery records, persists per-gallery defaults, filters people, manages group memberships, previews gallery permissions for selected group/person/visitor/owner modes, runs cloud Worker policy tests for selected gallery access, shows a reversible audit/undo ledger for person/group access changes, and includes a selected-group invitation rehearsal for email/link/QR access propagation; audience fixtures are `Agnes's B'day`, `RE La Concha`, and `Johnson-Palmer wedding`.
- Real Estate output in `v141.0` uses A4/Letter, 3/4/5 seconds, PDF landscape/portrait, and video landscape/portrait radio choices. Matching ready cloud products turn Queue PDF/Video into direct Download actions; the hero identifies source photos/videos, shoots, and cloud-synced saved products. Language and theme preferences are user-scoped, with Google accounts persisting both in the cloud profile and legacy password clients retaining them per identity on the device.
- `owner.html` is the canonical authenticated cloud Owner control surface; `new-owner.html` redirects to it for compatibility. Scoped background connectors provide health, full Apple Photos index refresh, Photos previews, Sidecar stars/pick/reject/title/keywords/approval decisions, guarded single-item Upload Bridge execution plus catalog registration, and an Owner-only credential-free Mac installer download.
- Owner has a private Apple Photos Real Estate intake that creates or reuses `RE / Fixture / Sub-fixture` routes and registers each fixture for the later RE import. Its explicit selector offers Apartment 1, Apartment 2, Street, Main lobby, Pool, Tennis court, and `New…` for any custom sub-fixture. Previews render immediately below the intake buttons/status while the full album chooser stays in a bounded scroll region; long-running connector work remains visibly waiting instead of being mislabeled as failed after 90 seconds. Candidate thumbnails now come from the PhotoKit preflight's actual item rows, and the status explains the inspected total plus conservative one-second burst filtering. Assignment requires an actual selected preview and cannot accidentally fall through to copying whole albums. The current Corine proof uses the named La Concha routes.
- Build a Fixture supersedes that Real Estate-only intake as the canonical path: recursive fixtures, universal read-only asset search, immutable candidate snapshots, the shared Sidecar decision layer, reversible multi-fixture placement, and versioned per-destination receipts. Fixture-scoped Sidecar now processes each asset as verified R2 delivery followed by preflighted, verified Apple Photos give-back, so the `PBE Approved` Smart Album advances during the run. Unscoped historical uploads still require explicit Owner adoption. The legacy RE intake remains collapsed as a compatibility lane.
- ACS can create, replace, and revoke gallery-scoped Real Estate password logins in D1. A single La Concha gallery grant covers the full sub-fixture tree. A validated legacy Real Estate session now switches the shared site header from visitor pills to the signed-in face icon without expanding its ACS permissions. Do not send Corine access until the refreshed gallery, login, and downloads pass end-to-end verification.
- Account sign-out has one visible control and clears the account-synced basket, likes, order references, and profile cache from the browser before visitor mode resumes; Basket and Liked listen for the clear event and redraw immediately instead of exposing the departed account's local data.
- Real Estate PDF/video production is fully cloud-side: the browser queues and polls; a Cloudflare Workflow launches Browser Rendering, private expiring render tokens protect the internal handoff, Media Transformations converts the cloud WebM recording to MP4, and finished files land in private R2. The Worker now persists real render phases and percentages for a determinate client progress bar with elapsed time/ETA, and the output/shelf flow is localized in English, French, and Spanish. The production music pool uses forty verified 60-second R2 clips and repeats the selected clip for longer videos without modifying the source MP3s.
- The Real Estate finished-products shelf loads cloud records automatically without exposing the old manual sync banner or Sync button.
- Public catalog integrity: `ok`; public SQLite, Worker catalog, homepage data,
  Expo manifest, and media sidecar agree at `3,531` lifecycle-active rows.
- Public commercial catalog scale: `2713` media rows after retiring AI-generated images from storefront publication.
- Gallery counts: France `379`, Italy `70`, Mexico `31`, Portugal `214`, Slovakia `2`, Spain `1872`, USA `145`.
- AI/Leonardo source and Owner records remain preserved outside the public commercial catalog.
- Upload Bridge active approvals are clean: `0` uploadable items, `0` active blocked approved items, `0` missing keys, `0` blocked export failures.
- Picked-only Sidecar AI metadata queue is drained: `0` candidates.
- The restored Max Owner snapshot has `3314` uploaded/approved candidates: `2719` already in the public catalog and `595` older uploaded rows needing a separate catalog reconciliation decision. Cloud Upload next approved is scoped to only the asset IDs uploaded by that action, so it cannot publish this backlog accidentally.
- Paid/private access regression slice: central ticket `PBE-20260708-6FBE` tracks backlog item #4. Public order JSON now hides delivery ZIP/storage keys by default; deployed checkout/order/session payloads expose only Worker download-token URLs and buyer-facing file details. Real Estate deliverable/job/list responses now keep R2 output keys and source-video private keys internal while returning only status, failure detail, metadata, and authorized view/download URLs. `npm test` passes with coverage for unpaid token guesses, paid deployed downloads, wrong-account order access, 30-day redownload boundaries, Real Estate client scoping, Owner/Admin gates, Access Console admin-only writes, private R2 delivery missing-file blocks, and Real Estate public-payload leak checks.
- Sidecar review cleanup backlog: the `20` unknown-gallery/generic-title reset rows are resolved (`19` Benalmadena Aquarium videos approved/picked, `1` unsupported WhatsApp still tombstoned); the `24` persistent Photos export failures are repaired from verified external picGen PNG originals, uploaded to R2, approved/picked, re-queued, unblocked, and registered in the public catalog; the `63` unpicked/proposed rows are normalized back to `unreviewed` while preserving their proposed title/keyword context.
- Sidecar automation must use `~/Applications/PhotosByElie Photos Bridge.app` through LaunchServices for PhotoKit work. Do not call raw Swift or the bare bundle executable for scheduled Sidecar automation.
- Sidecar quick view now shows a desktop side metadata panel with camera, location, format, and pixel size. Current Apple Photos index data supplies location/format/size when available; camera shows `not indexed` until EXIF/camera enrichment is added to the PhotoKit bridge/index.
- Sidecar culling selection keeps a direction of travel: when a pick/reject/hide/unpick decision makes the selected card disappear under the active filters, the next highlighted card is the adjacent logical neighbor in the current travel direction.
- Sidecar Apple Photos previews now prefer PhotoKit current rendered image data for stills, which fixes RAW-origin JPEG previews such as `20221216 172145 01113.jpg` rendering blue from the older DNG/NSImage fallback path.
- Sidecar video cards now fall back to deriving a cached JPEG poster from the same local video resource used by Quick Look when PhotoKit fails to return a poster frame. Bridge app results are read from a result file, so preview errors retain their real cause instead of becoming a generic missing-cache message.
- Apple Photos with faces remains off limits.
- Public pages use the shared visible site version; Sidecar has its own version in `SIDECAR_VERSION`.
- `Owner.sqlite` remains ignored/local. Owner-action JSON files are compatibility views, audit files, or handoff artifacts, not primary workflow state when SQLite tables exist.

## Fresh Numbered Backlog

1. **Finish Apple Photos intake into a sellable public catalog.**
   - Use the Sidecar sandbox as the default first intake surface: newest-to-oldest from the indexed Apple Photos library, no album selector for the first pass.
   - Cull in reasonable visible-preview batches before any Expo materialization or R2 upload.
   - Turn picked survivors into a repeatable cull, metadata-review, Upload Bridge, catalog publish, and protected-download pipeline.
   - Prioritize photos and sets that can become public gallery/store inventory.
   - Keep local connector work limited to source access/export; durable decisions should land in cloud Owner or SQLite-backed state.
   - Track counts from library candidates to culled, picked, metadata-approved, uploaded, cataloged, protected, and purchasable items.
   - Treat Owner direct `Import to Expo` as a secondary/legacy route unless Elie explicitly chooses it.
   - Use this as the main revenue unlock before spending heavily on hypothetical RE/family/event workflows.

2. **Validate commercial offers and market positioning.**
   - Research comparable photo-download pricing, Real Estate media packages, private event gallery sales, and SEO/search demand.
   - Decide the first offers to test, starting with the public download store and treating Real Estate, family/private sharing, and private paid event galleries as secondary future offers.
   - Identify the likely buyer/client, price range, promise, proof path, and biggest conversion/security risk for each offer.
   - Turn research into concrete offer copy, package names, pricing hypotheses, and testable next actions.

3. **Curate the first sellable storefront.**
   - Current catalog reconciliation is complete at `3,531` camera-made items;
     Sidecar-approved uploads are registered, explicit tombstones and
     hidden/discarded rows are excluded, and publish validation passes.
   - Cloud Owner title/keyword editing and keyword-blacklist management are
     restored for the next curation pass.
   - Apply strong title/keyword approvals.
   - Block unsellable rows.
   - Pick featured collections and hero images.
   - Put the strongest commercial/travel/editorial sets first.
   - Make the first purchasable path feel intentional on mobile and desktop.
   - Use Apple Photos intake output as the main pool for storefront expansion.

4. **Prove paid/private access cannot be bypassed.**
   - Central ticket: `PBE-20260708-6FBE`.
   - First Worker regression pass is complete: unpaid checkout/session/order state has no delivery object and guessed order/session/photo/`dl_`/`re_` tokens return `unknown_download`.
   - Public checkout/order/session payloads now omit delivery storage keys, private object keys, render keys, source keys, mock signed URLs, and local ZIP paths by default; localhost local-server opt-in remains only for local ZIP workflow.
   - Paid deployed Worker checkout still serves private R2 files only through `/download/<token>`; guessing the private R2 key as a token returns `404`.
   - Real Estate deliverable save/list/job/status payloads now omit output storage keys, source-video private keys, private master fields, and cloud-source keys while the internal R2 job/deliverable records retain what the Worker needs to serve authorized ready assets.
   - Existing coverage also verifies wrong-account order access, 30-day re-download boundaries, RE client scoping, Owner/Admin gates, Access Console admin-only writes, and private R2 missing-file checkout blocks.
   - Remaining work: run a live/manual matrix before inviting real buyers or clients, including unpaid visitor, paid buyer, expired token, download-limit hit, RE client, event attendee, family member, Owner/Admin, and public watermarked-preview-only cases.

5. **Review buyer support, refund, and license wording.**
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current policy draft.
   - Make delivery/recovery expectations explicit before heavier public traffic.
   - Align license language with the offers selected in the North Star commercial pass.

6. **Validate the real camera price ladder with buyers.**
   - The approved camera ladder is `$8 / $16 / $28 / $65`; AI-generated images are retired from the commercial storefront.
   - Run a controlled live proof purchase after deployment, then use real buyer behavior to revise prices and offer copy.

7. **Improve public discovery and SEO.**
   - Add richer per-gallery/per-photo metadata, Open Graph images, canonical URLs, structured data, and focused campaign metadata.
   - Keep Owner-only workflow details out of public page metadata.
   - Let market research decide which galleries, subjects, and search terms get attention first.

8. **Extend cloud Owner beyond the completed Sidecar foundation.**
   - Add gallery/routing assignment and batch propagation to cloud Sidecar review.
   - Add supported cloud action types for the remaining legacy Owner workflows.
   - Apple-sign/notarize the Mac connector before distribution beyond David and Max.
   - Keep Apple Photos intake, sellable storefront expansion, and protected download workflows ahead of hypothetical verticals.

9. **Run a full Real Estate client rehearsal.**
   - Live Corine rehearsal completed on 2026-07-18 with the eight-photo `La-Concha-1-Apt-8AB1-260718-1` selection: cloud PDF and MP4 both reached ready, both finished-product download controls enabled and ran without browser errors, and the temporary Cloudflare probe resources were removed.
   - Save a selection, generate PDF/video, verify PDF page/QR footers and the video closing QR, reopen from mobile, rename, and delete a throwaway product.
   - Confirm the client-facing offer feels coherent enough to sell as a service.
   - Keep this behind the public photo-store intake priority unless a real RE client opportunity appears.

10. **Extend audience groups into real gallery access flows.**
   - Add production invitation flows described in `docs/architecture/access-invitations.md`: email invites, share links, and QR-code invite URLs.
   - Let any authenticated person with active access to a given fixture/group invite others into that same scope when member invites are enabled.
   - Do not let ordinary members un-invite, revoke, disable, or grant broader roles; Owner/Admin keeps pending-invite revocation, accepted-membership disable/revoke, expiry, and audit controls.
   - Store invitation records in D1 with opaque token hashes, expiry, accept limits, inviter identity, invitee email when address-bound, and acceptance provenance on resulting memberships.
   - Add a public `/invite/<token>` accept page that requires Google sign-in, validates email binding/link scope/group state, creates group membership, and redirects to the assigned gallery.
   - Use ACS V8 gallery defaults and Worker policy decisions as the policy source for watermark, sale, download, PDF, video, member-original, and Owner-original preview behavior when public/event/RE gallery routes begin enforcing group access.
   - Default family/event groups toward member invites; keep Real Estate groups Owner/Admin-only unless a specific client is intentionally allowed to propagate access.

11. **Bring Etsy listing publishing online.**
   - Etsy API access is approved and smoke-tested locally.
   - Build the first listing-publisher pass as dry-run/draft payload generation from public catalog data and watermarked public previews only.
   - Use it only where market research suggests Etsy can drive incremental revenue.

12. **Add a guarded checkout discount code for low-cost live payment rehearsals.**
   - Keep validation server-side in the checkout Worker.
   - Preserve Stripe minimum-charge, stale-basket, and availability checks.
   - Record original subtotal, discount, and paid total in order state.

13. **Create a compact post-upload health dashboard.**
   - Summarize picked approvals, covered R2 keys, uploadable rows, blocked rows, catalog registration candidates, and public catalog counts.
   - Use Owner SQLite and public SQLite as the authoritative sources.
   - Surface commercial readiness: sellable item count, protected download health, and gallery publication status.

14. **Add a supported retry/reset command for Upload Bridge export blocks.**
   - Replace ad hoc SQL block clearing with a maintenance command.
   - It should clear selected active export blocks, retry through the normal bridge path, and optionally reset persistent failures to review.
   - Keep audit artifacts and Owner SQLite as the durable state path.

15. **Improve Sidecar review visibility for source/export failures.**
   - Surface `source-export-failed` rows with a clear status pill and review filter.
   - Show the last PhotoKit/local fallback error in the detail panel.
   - Provide a safe "ready to retry" action only after source repair.

16. **Tighten Upload Bridge metadata guard UX.**
   - Show why a row is metadata-blocked before queueing.
   - Keep the generic-title/no-gallery block list visible in the Upload Bridge rail.
   - Add a direct jump from a blocked row to metadata review.

17. **Finish source re-export de-duplication and cleanup.**
   - Use full source pathname plus modified date as the import anchor.
   - Same-path newer exports should overwrite previous generated masters, public previews, and private JPG triplets instead of creating duplicates.
   - Audit duplicate candidates before deleting anything.

18. **Add import source history management.**
   - Let Owner remove stale remembered folders, pin favorites, and inspect last-used path/time.
   - Keep `Owner.sqlite` authoritative; do not add another JSON state source.

19. **Keep repo/media cleanup deliberate.**
   - Follow `docs/sops/REPO_MEDIA_CLEANUP_SOP.md`.
   - Do not use GitHub as a media vault.
   - Protect `assets/catalog/photosbyelie.sqlite` as the active public catalog artifact.
   - Keep local Owner DB state out of git.

20. **Exercise and harden the D1-backed sandbox Access Console V8.**
   - Current V8 cloud backend is deployed with real cloud/D1 read-write paths, immediate D1-backed auth/session reads, audience groups, real-gallery picker/defaults, group create/edit/archive, group membership workbench, people filters, effective-access preview, gallery-permission preview, Worker policy testing, capability metadata, and audit/undo for reversible person/group access changes.
   - ACS9 front-end rehearsal adds selected-group invitations for email, copyable link, and QR payloads; this is a UI/design rehearsal until the D1 invitation tables and public accept routes are implemented.
   - Keep `ec92009@gmail.com` as the bootstrap break-glass admin during the D1 auth migration.
   - Exercise people, roles, group create/edit/archive, bulk add/revoke memberships, and reversible writes from the browser before granting real non-fixture users.
   - Keep clearly marked fixture people and event/group records with fake `.test` email addresses so role assignment and event access flows can be rehearsed without granting real people.
   - Snapshot before mutations, append audit entries, and prefer disable/revoke over hard delete.

21. **Repair three catalog source-master gaps when source storage is mounted.**
   - Recover `img-5988-fe9bda0bdb`, `img-6157-40f428f4db`, and
     `img-6174-8674aea1e3` through the normal verified upload path.
   - Until then, describe the catalog as `3,528` fully deliverable items plus
     three blocked source repairs; do not claim all `3,531` are sale-ready.

## Validation Before Publishing

- `python3 -m py_compile` for changed Python helpers.
- `node --check` for changed JavaScript/Worker files.
- `git diff --check`.
- Public catalog SQLite `PRAGMA integrity_check`.
- Sidecar Upload Bridge plan audit via `python3 scripts/sidecar_state_db.py --upload-bridge-plan`.
- Picked AI plan audit.
- Uploaded-catalog registration dry-run.
- Stale visible-version scan for `v124.0` / `v=124.0`.
