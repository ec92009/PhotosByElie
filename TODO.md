# Photos By Elie Backlog

Last updated: 2026-05-19

## Current Facts

- Current visible build: `v79.29`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: `http://localhost:8000/owner.html?v=79.29`.
- Current catalog scale: `6,324` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Public pages attempt `assets/catalog/photosbyelie.sqlite.br` first where supported, with plain `assets/catalog/photosbyelie.sqlite` as the guaranteed fallback.
- Local Owner state writes to ignored local files and `assets/owner-actions/Owner.sqlite`; tracked generated catalog/discarded artifacts were reconciled in `v79.29` so discarded photos are excluded from public outputs.
- Owner DB now records R2 objects as current, marked for delete, or confirmed deleted, and ordinary coverage checks trust current-key records before doing expensive cloud work.
- The import dashboard now treats source lanes as a shared pipeline: discovery fills a FIFO, planning decides what is missing, and processing creates/uploads missing masters, triplets, and previews.
- The Imports tab's Start background work button reports "already up to date" when no background work is needed.
- Fill in gaps covers lost masters, lost triplets, and lost previews without forcing a full source reimport or force-uploading known-current objects.
- Real Estate client imports follow `/Volumes/Saturn/Pictures/RE/<ClientName>/<Property>`, derive most public fields from `<ClientName>`, and keep credentials local/ignored except for sanitized public contexts and Worker secrets.
- Apple Photos with faces remains off limits.
- `npm test`, syntax checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Completed in `v79.29`: reconcile dirty Owner generated state.**
   - The discarded tombstone, public manifest, home data, worker catalog, and SQLite catalog now agree.
   - Newly discarded photos, including the France photo investigated during the session, are excluded from public outputs.

2. **Completed in `v79.29`: make Owner DB the ordinary R2 authority.**
   - R2 object rows record current, marked-for-delete, and confirmed-deleted states.
   - Older current rows were backfilled with inferred photo ids/object kinds, including Real Estate keys.
   - Ordinary coverage checks trust current-key Owner DB records; deep inventory remains reserved for suspicious storage or legacy-key investigations.

3. **Completed in `v79.29`: finish Fill in gaps behavior.**
   - Fill in gaps covers masters, private triplets, and public previews.
   - It no longer force-uploads objects already recorded as current.
   - It emits initial per-photo checkbox state so pending/done steps are visible before slow work finishes.

4. **Completed in `v79.29`: keep source-lane imports on the shared pipeline model.**
   - Source lanes use discovery/planning/processing language and shared matrix display.
   - Processing can begin while discovery continues, and the matrix shows active plus next queued rows instead of every completed row.

5. **Completed in `v79.29`: stabilize R2 background controls.**
   - The sweep exposes the import-cache phase, Fill in gaps is skippable at phase level, and skipped phases continue to render as `UNFINISHED`.
   - Background controls now report a clean no-missing state when coverage is already complete.

6. **Completed in `v79.29`: make legacy/misplaced repair evidence-led.**
   - Current-key Owner DB records satisfy normal coverage.
   - Legacy-key searching remains a deliberate deep-dive path instead of an automatic slowdown on every run.

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
