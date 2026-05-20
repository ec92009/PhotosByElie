# Photos By Elie Backlog

Last updated: 2026-05-20

## Current Facts

- Current visible build: `v81.21`.
- Public site: `https://ec92009.github.io/PhotosByElie/`.
- Local Owner page: `http://localhost:8001/owner.html?v=81.21`.
- Current catalog scale: `6,324` public media rows in `assets/catalog/photosbyelie.sqlite`.
- Public catalog loading and rebuilds use plain `assets/catalog/photosbyelie.sqlite`; Brotli `.sqlite.br` is legacy-only and not part of normal operations.
- A normalized SQL-shaped JSON catalog may be viable later, but only after measuring whether SQLite decode/rebuild costs are actually material.
- Title/keyword review state is SQLite-backed in ignored local `assets/owner-actions/Owner.sqlite`.
- Title/keyword batch/review JSON under `assets/owner-actions/title-keyword-review-queue/` is ignored/local review-page and audit output. It is no longer tracked as deployable public metadata.
- Latest generated title/keyword review batch: `2026-05-20-185753-222Z`.
- Current Owner title/keyword counts: accepted `1076`, submitted-unchecked/proposed `418`, rejected `0`, blocked `27`, parked `62`.
- `Owner.sqlite` title/keyword table counts: batches `13`, queue `1583`, proposals `2359`, decisions `1931`.
- Batch `2026-05-20-181058-181Z` had `100` weak local-rule proposals and all `100` were rejected for rework; replacement batch `2026-05-20-185753-222Z` has `200` proposals: `100` Codex-backed rework rows, `100` ordinary local rows, `0` model blockers, `0` keyword-target misses, and `74` `needs_owner_context` rows.
- The generator now uses a larger Owner-state subprocess buffer, filters internal marker keywords like `NotMyPhoto`, expands safe local keyword floors, and reports proposal quality counts before write/import.
- Real Estate owner clients can save/edit/delete, discover media-bearing property folders, import available configured properties with count/total progress, publish sanitized contexts, dry-run/upload R2 objects, and prepare the Worker secret payload.
- Start Imports scans the full fixed import anchors every time: Camera, Apple Photos, Leonardo, and Real Estate. It must not treat clean catalog coverage as proof that no new source files exist, and changed source files must re-render/re-upload even when their R2 keys already exist.
- Import source lanes share the same Owner matrix/progress renderer. Skipped source lanes are unfinished, and a blocked catalog export is shown as the needs-attention phase rather than as silent downstream waiting.
- Public previews are R2-backed. Public Photos By Elie previews are watermarked; Real Estate public previews remain unwatermarked and are only watermarked at PDF generation time.
- Private sellable files, private Real Estate originals, and full video originals are R2-backed and delivered through Worker-created private download tokens.
- Apple Photos with faces remains off limits.
- `npm test`, `npm run validate`, syntax checks, browser checks, and `git diff --check` remain mandatory before publishing public-site changes.

## Numbered Backlog

1. **Owner decision pass for batch `2026-05-20-185753-222Z`.**
   - Open `owner-review.html?view=title-keywords` locally and review the 200 pending proposals.
   - Pay special attention to the 74 `needs_owner_context` rows and the 100 Codex-backed rework rows from the rejected family-travel batch.

2. **Verify Owner-private artifact separation after deploy.**
   - Confirm public GitHub Pages no longer serves title/keyword batch or approval JSON.
   - Keep `Owner.sqlite` and generated review JSON local/ignored; use SQLite/helper output for localhost review.

3. **Run the next generator pass after the current batch is resolved.**
   - Use the improved local keyword floor, larger subprocess buffer, and batch-summary preservation fix.
   - Compare keyword-target misses, `source_context`, and `needs_owner_context` counts against `2026-05-20-185753-222Z`.

4. **Escalate thin ordinary title/keyword rows to stronger context.**
   - Use vision/model passes for photos where source path and existing keywords are too thin.
   - Keep conservative titles and mark uncertainty instead of inventing landmarks.

5. **Continue Codex-backed title/keyword rework tuning.**
   - Preserve rejected/rework state until a materially better proposal exists.
   - Use Owner comments and rejected titles/keywords as hard context, especially title-quality rejection notes.

6. **Improve title/keyword operator feedback in the UI.**
   - Surface keyword-target misses, local-rule/source-context status, and model-blocked rows directly in the review view.
   - Keep the terminal progress summary as the audit-level source of generator quality counts.

7. **Run a full Real Estate client lifecycle rehearsal.**
   - Pick one client folder on Saturn, use discovered properties, import previews, publish context, run upload dry-run, and prepare the Worker secret.
   - Check local and public review URLs before any real upload.

8. **Polish Real Estate production outputs.**
   - Move final PDF/slideshow assembly to cloud/server-side execution using saved manifests.
   - Keep browser PDF/slideshow output as draft/fallback and keep selected-original ZIP delivery through Worker tokens.

9. **Decide the production Real Estate access model.**
   - Choose Worker/D1, Cloudflare Access, or another server-side gate for client auth.
   - Keep static preview and private-original constraints explicit.

10. **Harden hidden/discarded lifecycle.**
    - Make H/X, undo, Waste Basket, discard, R2 public wipe, and catalog rebuilds share one durable state flow.
    - Avoid publishing partial hidden/discarded state.

11. **Add Owner state-table browsing.**
    - Browse public and Owner SQLite tables in a localhost-only UI with filters, sort, copy/export, and photo-aware jumps.

12. **Split banned-photo R2 cleanup out of Start Imports.**
    - Give the independent banned-photo R2 cleanup/double-check its own Owner button and dashboard lane.
    - Keep Start Imports focused on source discovery plus missing/edited media processing for Camera, Apple Photos, Leonardo, and Real Estate.

13. **Prove Stripe checkout in test mode.**
    - Configure Stripe test keys/webhook secret, test success/decline/3DS/replay, and confirm paid-only private download tokens.

14. **Make checkout and order storage production-durable.**
    - Choose KV, D1, or a deliberate hybrid for orders, delivery keys, token events, and recovery.

15. **Add browser-side ZIP assembly for paid mainline delivery.**
    - Keep Worker delivery per-file; build a buyer-side ZIP from ready purchased files with per-file fallback.

16. **Replace temporary `r2.dev` preview URLs with a custom media domain.**
    - Attach a media domain, update `media-config.js`, and retest public and Real Estate preview loading.

17. **Curate the first sellable storefront.**
    - Apply strong title/keyword approvals, block unsellable rows, and pick intentional featured collections/hero images.

18. **Clarify the buyer offer.**
    - Explain resolution tiers, licensing, delivery, refunds, custom licenses, and contact help in buyer language.

19. **Add conversion analytics.**
    - Track privacy-conscious browsing, basket, checkout, payment, and download events while excluding localhost Owner activity.

20. **Improve public discovery and SEO.**
    - Add fuzzy search, richer page metadata, Open Graph images, canonical URLs, sitemap, and structured data without Owner-only metadata.

21. **Add frontend smoke tests for buyer and client paths.**
    - Cover search/filter, detail, like, basket, checkout draft, Real Estate login, selection, PDF/slideshow draft, originals ZIP, and mobile controls.

22. **Keep physical products behind Owner review.**
    - Re-enable print/frame products only after samples, fulfillment, pricing, shipping, refunds, and support are settled.

23. **Keep repo and media cleanup deliberate.**
    - Do not use GitHub as a media vault. Keep root HTML while GitHub Pages serves from repo root.

24. **Measure catalog transport cost before another conversion.**
    - Keep a normalized SQL-shaped JSON catalog on the might-be-nice list, not the active migration path.
    - Instrument plain SQLite fetch/decode, JS object materialization, gallery filter/search scans, and helper-side rebuild cost before deciding whether SQLite is too expensive.
    - Revisit JSON tables only if the measurements show meaningful runtime or rebuild overhead from the current SQLite-backed catalog path.
