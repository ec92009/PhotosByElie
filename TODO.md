# Photos By Elie Backlog

Last updated: 2026-05-19

## Current Facts

- Current visible build: `v79.24`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: `http://localhost:8000/owner.html?v=79.24`.
- Current catalog scale: `6,342` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Public pages attempt `assets/catalog/photosbyelie.sqlite.br` first where supported, with plain `assets/catalog/photosbyelie.sqlite` as the guaranteed fallback.
- Local Owner state writes to ignored local files and `assets/owner-actions/Owner.sqlite`; tracked generated catalog/discarded artifacts should be reviewed before publishing.
- The import dashboard now treats source lanes as a shared pipeline: discovery fills a FIFO, planning decides what is missing, and processing creates/uploads missing masters, triplets, and previews.
- Fill in gaps should cover lost masters, lost triplets, and lost previews without forcing a full source reimport.
- Real Estate client imports follow `/Volumes/Saturn/Pictures/RE/<ClientName>/<Property>`, derive most public fields from `<ClientName>`, and keep credentials local/ignored except for sanitized public contexts and Worker secrets.
- Apple Photos with faces remains off limits.
- `npm test`, syntax checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Review the current dirty generated Owner state.**
   - Inspect `assets/discarded/discarded-photo-ids.json`, `assets/expo-manifest.json`, and the SQLite catalog drift from the last Owner-page actions.
   - Decide whether the latest hidden-to-discarded state is intended, should be committed, or should be regenerated from the Owner DB.
   - Reconcile local ignored hidden files with tracked discarded/catalog artifacts before the next public publish.

2. **Make Owner DB the authority for R2 object state.**
   - Track objects currently on R2, objects marked for delete, and objects confirmed deleted.
   - Let ordinary maintenance runs trust that DB instead of deep-scanning R2 every time.
   - Keep a deliberate deep-dive mode for suspicious R2 storage volume or suspected legacy misplaced keys.

3. **Finish the Fill in gaps pipeline.**
   - Make the pipeline cover missing masters, private triplets, and public previews.
   - Do not regenerate triplets or previews that already exist and are recorded as current.
   - Keep the matrix focused on incomplete/current rows while completed rows vanish quickly.

4. **Finish shared source-lane import behavior.**
   - Keep Lightroom, Camera, AI, Real Estate, and Apple Photos lanes on the same discovery/planning/processing code path.
   - Start processing as soon as discovery finds eligible work, but keep discovery running until every source is scanned.
   - Show queue depth, active item, next few queued items, and per-photo step checkboxes.

5. **Stabilize R2 background work controls.**
   - Make Start background work and Fill in gaps visibly responsive.
   - Keep current phases expanded and finished/failed/skipped phases collapsed.
   - Make skip safe, phase-local, and clearly label skipped phases as `UNFINISHED`.

6. **Repair legacy/misplaced media only when evidence says it is needed.**
   - Search legacy R2 key layouts when current-key gaps look suspicious.
   - Distinguish "not uploaded yet" from "uploaded under old key" in the UI.
   - Record the outcome in Owner DB so the same question is not re-asked on every run.

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
