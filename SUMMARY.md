# Conversation Summary

Date: 2026-05-13

## Current State

- Repo: `/Users/ecohen/Dev/photosByElie`
- Local preview: `http://localhost:8000/`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Current visible build: `v74.3`
- Local Owner mutations require the helper server: `python3 scripts/local_server.py 8000`.
- Public previews are watermarked and served directly from the public R2 endpoint configured in `media-config.js`.
- Public media objects, private masters, private render JPGs, and source/JPG embedded metadata are treated as immutable after upload. Owner metadata edits update generated catalog/manifest files only.
- The checkout Worker handles checkout, order state, payment webhooks, and private delivery; it is not in the public preview hot path.
- Business priority remains revenue readiness: trustworthy checkout, clear buyer offer, curated catalog, discovery/SEO, analytics, and launch outreach.

## Recent Conversation

- We ran and refined the nightly Title/Keyword Owner review queue for the newest 100 unreviewed photos.
- The queue writes tracked proposal JSON under `assets/owner-actions/title-keyword-review-queue/` and does not auto-apply proposals during generation.
- The review page was kept compact: one photo per row with preview, current title/keywords, proposed title/keywords, and approval checkbox.
- Preview URLs were verified against R2. Slow-loading thumbnails were not missing; the page now eagerly requests review thumbnails and warms the rest in the background.
- Proposed keywords now exclude blacklisted tokens/phrases from `assets/owner-actions/keyword-blacklist.json`, including blacklisted terms already present in current metadata.
- The generator attempts at least 10 proposed keywords per photo using source path, catalog, EXIF/orientation, and known prompt/title context when a vision pass is unavailable.
- The page now has **Approve all** controls at top and bottom.
- **Save approvals** now applies approved title/keyword changes to generated catalog metadata/state files through the helper endpoint `apply-title-keyword-review-approvals`.
- Applied rows receive the `Title_Keywords_Reviewed` metadata flag so future nightly queues skip them.
- Save also writes an approvals audit file under `assets/owner-actions/title-keyword-review-queue/`.
- We verified that **Approve all** checked all 100 rows, but no metadata apply happened because **Save approvals** was not clicked.
- Existing untracked file `assets/owner-actions/title-keyword-review-queue/approvals-2026-05-12.json` is an older local approval artifact and remains uncommitted.

## Important Safeguards

- Do not edit `MAX2DAVID.md` from David unless explicitly asked; David reports go in `DAVID2MAX.md`.
- Do not use the keyword blacklist to skip photos. It only blocks useless keyword strings from proposed/generated metadata.
- Do not rewrite JPG/source embedded metadata, public previews, private masters, or private render files during title/keyword cleanup.
- Use `npm test` and `npm run validate` before commits that affect behavior or generated metadata.
- Use `node scripts/generate_title_keyword_review_queue.mjs --limit 100` to refresh the nightly queue.
- Use `http://localhost:8000/title-keyword-review.html` with the helper server for approvals that mutate metadata.

## Fresh Numbered Backlog

1. **Apply the current title/keyword approvals deliberately.** In the helper-served review page, inspect the batch, use Approve all only if the full batch is acceptable, click Save approvals, then validate the generated metadata diff.
2. **Regenerate the next title/keyword queue after apply.** Confirm the applied 100 photos are skipped via `Title_Keywords_Reviewed`, then inspect the next newest batch for quality.
3. **Add a true vision-capable proposal pass.** Use preview pixels when credentials/tools are available, fall back to catalog/source metadata only when vision is unavailable, and mark uncertain rows instead of inventing facts.
4. **Tighten approval UX safeguards.** Show a pre-save summary with approval count, changed titles, changed keyword counts, and flagged low-confidence rows before applying.
5. **Prove Stripe checkout in test mode.** Configure test secrets/webhook and cover success, 3D Secure, declined card, verified webhook, delivery readiness, and retry/failure states.
6. **Make checkout and delivery production-durable.** Choose D1 vs KV, store durable order state, rate-limit or expire download tokens sensibly, and make recovery/contact copy trustworthy.
7. **Package the buyer offer clearly.** Clarify licenses, resolution labels, full-resolution meaning, AI-origin handling, delivery expectations, refunds, and contact.
8. **Move prices into a dedicated published price list.** Share the price source between public basket and Worker validation, with clear publish/version behavior.
9. **Curate the first sellable storefront.** Prioritize strong images/collections, block weak items, improve titles/keywords, and choose featured sets.
10. **Add conversion analytics.** Track privacy-conscious funnel events from view through checkout/download, excluding local Owner activity.
11. **Improve public discovery and SEO.** Add better titles/descriptions, Open Graph, canonical URLs, sitemap, structured data, and image metadata.
12. **Build launch landing pages.** Create focused pages for travel/editorial licensing, wall art, AI imagery, country sets, and brand story.
13. **Prepare launch outreach.** Draft launch email, direct buyer note, social checklist, and standout image set.
14. **Move public media to a custom domain.** Replace temporary `r2.dev` media URLs with a domain such as `media.photosbyelie.com`.
15. **Parameterize gallery routes.** Move from one HTML shell per country toward one data-driven gallery route while preserving old URLs.
16. **Refine gallery merchandising layout.** Continue polishing masonry/density/fit-fill behavior for buyer browsing.
17. **Replace keyword cleanup with a modal workflow.** Show keyword counts, checkbox deletes, confirmation, and before/after counts.
18. **Make country collections open-ended.** Let Owner create new country collections from Unknown assignment instead of relying on a fixed list.
19. **Extend Owner operations dashboard.** Surface sweep status, R2 coverage, blocked/discarded cleanup, and guided ingest/validate/publish flow.
20. **Keep long-horizon cleanup on the backburner.** XMP sidecar writes, videos, physical goods, semantic renames, and repo layout cleanup wait until the revenue path is steadier.

## Verification Snapshot

- Latest behavior commit before this docs refresh: `31281478 photosbyelie: apply title keyword approvals`.
- Helper server was verified on `127.0.0.1:8000`.
- `npm test` and `npm run validate` passed after the approval-apply flow was implemented.
- The current browser page had all 100 rows checked by the Approve all test, but Save approvals was not clicked.
