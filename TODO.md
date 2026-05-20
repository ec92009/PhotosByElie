# Photos By Elie Backlog

Last updated: 2026-05-20

## Current Facts

- Current visible build: `v81.2`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: `http://localhost:8000/owner.html?v=81.2`.
- Current catalog scale: `6,324` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Title/keyword review state is SQLite-backed in `assets/owner-actions/Owner.sqlite`; the latest generated review batch is `2026-05-19-230413-165Z`.
- Current Owner title/keyword counts: accepted `711`, submitted-unchecked `321`, rejected `2`, parked `14`.
- The latest title/keyword batch has `321` proposals: `221` rework proposals produced by `codex-gpt-5.4-mini` plus `100` ordinary new-photo proposals produced by `local-metadata-rules-v1`.
- Two rework rows remain model-blocked after retry: `20220519-145011-04398-926891f8aa` and `20220511-101037-04339-de0f00382f`.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Owner DB records R2 objects as current, marked for delete, or confirmed deleted, and ordinary coverage checks trust current-key records before doing expensive cloud work.
- Real Estate client imports follow `/Volumes/Saturn/Pictures/RE/<ClientName>/<Property>`, derive most public fields from `<ClientName>`, and keep credentials local/ignored except for sanitized public contexts and Worker secrets.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Review the new title/keyword batch.**
   - Open `owner-review.html?view=title-keywords` locally and work through batch `2026-05-19-230413-165Z`.
   - Prioritize the `221` rework rows because they now have real Codex model provenance.
   - Approve strong rows, reject weak rows with concrete comments, and use H/X for photos that should leave the sale/review surface.

2. **Resolve the two model-blocked title/keyword rows.**
   - Inspect `20220519-145011-04398-926891f8aa` and `20220511-101037-04339-de0f00382f`.
   - Decide whether to retry with a stronger/vision ladder level, provide manual Owner context, or park them deliberately.
   - Preserve their rejected/rework state until a defensible proposal exists.

3. **Improve title/keyword generator operator feedback.**
   - Stream progress while Codex-backed rework rows are running so long nightly jobs are less opaque.
   - Add elapsed time, current row id, completed/model-blocked/retry counts, and final ETA-style summary.
   - Consider safe low-concurrency model calls after the current single-file state path remains stable.

4. **Tune title/keyword proposal quality.**
   - Investigate rows below the 10-keyword target and decide whether they need model retry, local metadata expansion, or Owner context.
   - Review `needs_owner_context` rows for patterns that could be improved through source path, preview-pixel, or location handling.
   - Keep blacklisted keywords out of proposed metadata without using the blacklist to filter photos.

5. **Finish Real Estate owner-side client lifecycle.**
   - Keep create/update/delete client rows fully editable in the Owner table.
   - Import available property folders with clear count/total progress.
   - Publish sanitized contexts, upload public previews/private masters, and prepare Worker secret payloads coherently.

6. **Polish Real Estate client review outputs.**
   - Keep the property wizard compact on desktop and phone.
   - Preserve one-project-at-a-time PDF and slideshow outputs.
   - Move production PDF/slideshow assembly to the cloud using saved manifests; keep browser output as draft/fallback.

7. **Decide the production Real Estate access model.**
   - Current public contexts use browser-side hashes and Worker secrets for originals.
   - Decide whether final client auth should move to Worker/D1, Cloudflare Access, or another server-side gate.
   - Keep static preview constraints explicit in the decision.

8. **Harden hidden/discarded lifecycle.**
   - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
   - Avoid publishing partial hidden/discarded state.
   - Keep the remote hidden blacklist, local ignored hidden files, discarded tombstones, SQLite catalog, and Worker catalog in sync.

9. **Add Owner state-table browsing.**
   - Browse public and Owner state tables in a localhost-only UI.
   - Support table switching, filters, quick search, sorting, row counts, and copy/export.
   - Add photo-aware jumps to public detail, Owner detail, collection, R2 keys, hidden state, and discarded state.

10. **Prove Stripe checkout in test mode.**
    - Configure Stripe test keys and webhook secret in the Worker environment.
    - Test successful payment, declined payment, 3D Secure/authentication, webhook replay, and amount mismatch.
    - Confirm paid orders expose private download tokens and unpaid orders do not.

11. **Make checkout and order storage production-durable.**
    - Choose KV, D1, or a deliberate hybrid for order records.
    - Persist order id, buyer email, basket snapshot, totals, payment status, delivery keys, token events, and recovery facts.
    - Add buyer-facing order lookup/recovery before considering full buyer accounts.

12. **Add browser-side ZIP assembly for paid mainline delivery.**
    - Keep the Worker on per-file private tokens; do not make the Worker assemble large archives.
    - Add an order-page action that fetches ready purchased files and creates a single ZIP in the browser.
    - Keep per-file downloads as fallback for embedded browsers, failed ZIP assembly, and large mobile orders.

13. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
    - Attach a domain such as `media.photosbyelie.com`.
    - Update `media-config.js`.
    - Retest GitHub Pages gallery, detail, basket, liked, and Real Estate preview loading.

14. **Curate the first sellable storefront.**
    - Apply title/keyword approvals to the strongest catalog rows.
    - Block or discard photos that should not be sold.
    - Pick featured collections and hero images that feel intentional.

15. **Clarify the buyer offer.**
    - Explain full, 6 MP, 3 MP, and 1 MP downloads in buyer terms.
    - Clarify personal, commercial, resale, and AI-training licensing.
    - Add concise delivery, refund, custom-license, and contact help.

16. **Add conversion analytics.**
    - Track privacy-conscious funnel events: collection view, search/filter, like, add to basket, checkout start, payment complete, and download.
    - Report revenue by photo, collection, source origin, and product format.
    - Keep localhost Owner activity out of buyer analytics.

17. **Improve public discovery and SEO.**
    - Add fuzzy search over title, keywords, places, and collections.
    - Add page titles, descriptions, Open Graph images, canonical URLs, sitemap, and structured data where useful.
    - Avoid exposing Owner-only metadata.

18. **Add frontend smoke tests for buyer and client paths.**
    - Cover search/filter, detail open, like, add to basket, checkout draft, and embedded-browser escape.
    - Cover Real Estate login, selection, save/load, PDF draft, slideshow plan, originals ZIP, and footer/action-bar clearance.
    - Include mobile header/action-bar behavior.

19. **Keep physical products behind Owner review.**
    - Keep print/frame products off publicly until samples and fulfillment rules are settled.
    - Compare POD vendors for US/EU quality, packaging, landed cost, API fit, and support.
    - Re-enable only after pricing, shipping, refunds, and customer support are clear.

20. **Keep repo and media cleanup deliberate.**
    - Do not use GitHub as a media vault.
    - Keep source metadata edits non-destructive.
    - Keep root HTML while GitHub Pages serves from repo root.
    - Revisit bundling/minification and folder structure only after payment/media paths stabilize.
