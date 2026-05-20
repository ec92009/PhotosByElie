# Photos By Elie Backlog

Last updated: 2026-05-20

## Current Facts

- Current visible build: `v81.14`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: `http://localhost:8000/owner.html?v=81.14`.
- Current catalog scale: `6,324` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Title/keyword review state is SQLite-backed in ignored local `assets/owner-actions/Owner.sqlite`.
- Latest generated title/keyword review batch: `2026-05-20-181058-181Z`.
- Current Owner title/keyword counts: accepted `1069`, submitted-unchecked/proposed `318`, rejected `0`, blocked `27`, parked `62`.
- `Owner.sqlite` title/keyword table counts: batches `12`, queue `1476`, proposals `2152`, decisions `1824`.
- Latest batch has `100` ordinary new proposals, `0` rework rows, `0` model blockers, and generator counts `local-metadata-rules-v1: 100`.
- All latest-batch titles are non-empty, but all `100` rows are `source_context` and below the 10-keyword target.
- Owner review JSON under `assets/owner-actions/title-keyword-review-queue/` is tracked/deployable unless deliberately excluded; treat it as public metadata exposure until the artifact boundary is hardened.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Owner DB records R2 objects as current, marked for delete, or confirmed deleted, and ordinary coverage checks trust current-key records before doing expensive cloud work.
- Real Estate client imports follow `/Volumes/Saturn/Pictures/RE/<ClientName>/<Property>`, derive most public fields from `<ClientName>`, and keep credentials local/ignored except for sanitized public contexts and Worker secrets.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Review batch `2026-05-20-181058-181Z`.**
   - Open `owner-review.html?view=title-keywords` locally and work through the newest 100 ordinary proposals.
   - Treat the rows as low-context local-rule proposals even though all have non-empty titles.
   - Approve only rows that are genuinely useful; reject weak rows with concrete notes; block photos that should leave the sale/review surface.

2. **Separate Owner-private review artifacts from public deployable assets.**
   - Decide whether title/keyword batch JSON should be ignored/local, sanitized before commit, or moved outside the public site tree.
   - Keep `Owner.sqlite` ignored/local as the durable source of truth.
   - Ensure public deploys do not expose source-path clues, Owner comments, internal workflow state, or unnecessary capture/provenance details.

3. **Fix the title/keyword generator buffer limit.**
   - `owner_state_db.py --title-keyword-generator-state-json` now emits about 1.36 MB and can exceed Node's default `spawnSync` buffer.
   - Raise the `runOwnerStateDb` buffer in the generator while preserving existing behavior.
   - Add or update a regression check so larger Owner queues do not break nightly generation.

4. **Improve latest-batch proposal quality.**
   - Investigate why all 100 latest rows are below the 10-keyword target.
   - Expand safe local keyword context where reliable, and escalate rows to model/vision context when local metadata is too thin.
   - Keep blacklisted keywords out of proposed metadata without using the blacklist to filter photos.

5. **Improve Codex-backed title/keyword rework quality.**
   - Inspect weak rework rows from earlier batches for image-understanding gaps, missing landmark context, and nearby-shoot inference failures.
   - Preserve rejected/rework state until a defensible proposal exists.
   - Use Owner rejection comments as hard context, especially `use the hints in the keywords to provide a decent title`.

6. **Harden title/keyword operator feedback.**
   - Keep progress output visible for long model-backed runs.
   - Report elapsed time, current row id, successes, retries, model blockers, parked rows, and final write/import phases.
   - Keep bounded model concurrency deterministic by model rung.

7. **Finish Real Estate owner-side client lifecycle.**
   - Keep create/update/delete client rows fully editable in the Owner table.
   - Import available property folders with clear count/total progress.
   - Publish sanitized contexts, upload public previews/private masters, and prepare Worker secret payloads coherently.

8. **Polish Real Estate client review outputs.**
   - Keep the property wizard compact on desktop and phone.
   - Preserve one-project-at-a-time PDF and slideshow outputs.
   - Move production PDF/slideshow assembly to the cloud using saved manifests; keep browser output as draft/fallback.

9. **Decide the production Real Estate access model.**
   - Current public contexts use browser-side hashes and Worker secrets for originals.
   - Decide whether final client auth should move to Worker/D1, Cloudflare Access, or another server-side gate.
   - Keep static preview constraints explicit in the decision.

10. **Harden hidden/discarded lifecycle.**
    - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
    - Avoid publishing partial hidden/discarded state.
    - Keep the remote hidden blacklist, local ignored hidden files, discarded tombstones, SQLite catalog, and Worker catalog in sync.

11. **Add Owner state-table browsing.**
    - Browse public and Owner state tables in a localhost-only UI.
    - Support table switching, filters, quick search, sorting, row counts, and copy/export.
    - Add photo-aware jumps to public detail, Owner detail, collection, R2 keys, hidden state, and discarded state.

12. **Prove Stripe checkout in test mode.**
    - Configure Stripe test keys and webhook secret in the Worker environment.
    - Test successful payment, declined payment, 3D Secure/authentication, webhook replay, and amount mismatch.
    - Confirm paid orders expose private download tokens and unpaid orders do not.

13. **Make checkout and order storage production-durable.**
    - Choose KV, D1, or a deliberate hybrid for order records.
    - Persist order id, buyer email, basket snapshot, totals, payment status, delivery keys, token events, and recovery facts.
    - Add buyer-facing order lookup/recovery before considering full buyer accounts.

14. **Add browser-side ZIP assembly for paid mainline delivery.**
    - Keep the Worker on per-file private tokens; do not make the Worker assemble large archives.
    - Add an order-page action that fetches ready purchased files and creates a single ZIP in the browser.
    - Keep per-file downloads as fallback for embedded browsers, failed ZIP assembly, and large mobile orders.

15. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
    - Attach a domain such as `media.photosbyelie.com`.
    - Update `media-config.js`.
    - Retest GitHub Pages gallery, detail, basket, liked, and Real Estate preview loading.

16. **Curate the first sellable storefront.**
    - Apply title/keyword approvals to the strongest catalog rows.
    - Block or discard photos that should not be sold.
    - Pick featured collections and hero images that feel intentional.

17. **Clarify the buyer offer.**
    - Explain full, 6 MP, 3 MP, and 1 MP downloads in buyer terms.
    - Clarify personal, commercial, resale, and AI-training licensing.
    - Add concise delivery, refund, custom-license, and contact help.

18. **Add conversion analytics.**
    - Track privacy-conscious funnel events: collection view, search/filter, like, add to basket, checkout start, payment complete, and download.
    - Report revenue by photo, collection, source origin, and product format.
    - Keep localhost Owner activity out of buyer analytics.

19. **Improve public discovery and SEO.**
    - Add fuzzy search over title, keywords, places, and collections.
    - Add page titles, descriptions, Open Graph images, canonical URLs, sitemap, and structured data where useful.
    - Avoid exposing Owner-only metadata.

20. **Add frontend smoke tests for buyer and client paths.**
    - Cover search/filter, detail open, like, add to basket, checkout draft, and embedded-browser escape.
    - Cover Real Estate login, selection, save/load, PDF draft, slideshow plan, originals ZIP, and footer/action-bar clearance.
    - Include mobile header/action-bar behavior.

21. **Keep physical products behind Owner review.**
    - Keep print/frame products off publicly until samples and fulfillment rules are settled.
    - Compare POD vendors for US/EU quality, packaging, landed cost, API fit, and support.
    - Re-enable only after pricing, shipping, refunds, and customer support are clear.

22. **Keep repo and media cleanup deliberate.**
    - Do not use GitHub as a media vault.
    - Keep source metadata edits non-destructive.
    - Keep root HTML while GitHub Pages serves from repo root.
    - Revisit bundling/minification and folder structure only after payment/media paths stabilize.
