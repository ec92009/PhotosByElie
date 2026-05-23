# Conversation Summary

Date: 2026-05-22

## Current State

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Branch: `main`
- Current visible build: `v83.6`
- Local Owner page: `http://localhost:8000/owner.html?v=83.6`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Deployed Worker: `https://photosbyelie-checkout-mock.ec92009.workers.dev`
- Current catalog scale: `6,019` public media rows in the SQLite catalog: France `123`, USA `159`, Spain `561`, Mexico `2`, AI/Leonardo `4,921`, Italy `35`, Portugal `216`, Slovakia `2`.
- Public catalog loading and rebuild operations now use plain `assets/catalog/photosbyelie.sqlite`; Brotli catalog generation/loading is retired from the normal path.
- Title/keyword review queue state is local SQLite in ignored `assets/owner-actions/Owner.sqlite`; generated review batch JSON is ignored/local and no longer tracked as deployable public metadata.
- Public previews are served from public R2 media. Private sellable files, Real Estate originals, and full video originals are delivered through Worker-created private download tokens.
- Localhost Owner/helper workflows remain the mutation path for catalog edits, hidden/discarded state, imports, R2 maintenance, and Real Estate client management.
- Stripe sandbox checkout proof is complete: successful card, declined-card, 3D Secure, webhook delivery, order recovery, per-file download, and download-all paths were manually verified.
- Live Stripe account `acct_1TWCksPuO9o6fOp6` is onboarded enough for the current setup pass and showed no active account tasks after onboarding.
- Live Stripe branding is saved with the new camera-tripod logo assets, brand color `#5B341E`, and accent color `#D86A3E`. The source assets are under `assets/branding/`.
- Live Stripe customer email setting `Successful payments` is enabled; `Refunds` remains off.
- Live Checkout card statement descriptor suffix is `DOWNLOAD`, producing `PHOTOSELIE* DOWNLOAD` with the current Stripe descriptor prefix.
- Live Stripe webhook destination is created for `checkout.session.completed`: destination ID `we_1TZmoVPuO9o6fOp6JkBENiyV`, display name `PhotosByElie Worker checkout`, endpoint `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook`, API version `2026-04-22.dahlia`.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git. Secret values are not committed or written into docs.
- Live Stripe checkout proof is complete: order `PBE-20260522-BA062E956C` charged `$8.00`, Stripe showed `$7.47` incoming after fees, the Worker marked the order `ready`, and a private R2 JPEG download returned `401,035` bytes with a valid JPEG header.
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo, adds buyer trust notes to basket/order, and adds `support.html` for payment, delivery recovery, license, refund-expectation, and support notes.
- `v83.4` promotes the first Photos By Elie Facebook Page post in the homepage Featured section alongside Pinterest features.
- `v83.6` adds localhost-only POD supplier readiness, quality-tier routing, supplier option, and schema preview panels in Owner Commerce; public print checkout remains gated off.
- Price/offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price changes have been made from that draft.
- Local POD preview data now lives in `assets/catalog/product-pricing.json`, the compact SQLite catalog, `photos-data.js`, and the Worker catalog export. Prodigi is modeled as primary/value, Printful as standard fallback, theprintspace as premium candidate, and Gelato as API-proof/global-routing candidate.
- A small Snapmaker/Orca 3MF project export for the PhotosByElie QR coaster is present under `assets/3d/`.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is docs-only: all active threads were quiet, `main` was clean against `origin/main`, and the current backlog remains in `TODO.md`.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three daily themes across Facebook, Instagram, and Pinterest with 5-10 watermarked public images per post and publishes only when existing authentication allows it.
- PhotosByElie active collaboration time is paused as of 2026-05-23 12:26 CEST. Generated browser screenshots under `output/` are local-only and ignored.

## Latest Conversation Update

The latest handoff sweep published Owner-approved title/keyword metadata into the public SQLite catalog and Worker checkout catalog, refreshed the keyword blacklist compatibility export, and bumped the visible build to `v83.0`; the later pricing/minimum-charge work brought the visible build to `v83.2`. The autonomous buyer-trust pass brought the visible build to `v83.3`, and the social-feature pass brought it to `v83.4` without changing catalog scale. Active public catalog scale remains `6,019` rows.

The latest Stripe pass completed live cutover. Cloudflare now has live Stripe and live webhook secrets installed outside git, `/health` reports real Stripe with USD, and a live Checkout Session used a `cs_live_...` id. The first real purchase was order `PBE-20260522-BA062E956C` for one JPG 1 MP Versailles photo. Stripe showed `$7.47` incoming from the `$8.00` charge, the live webhook moved the Worker order to `ready`, and the private download token served the expected JPEG.

Stripe's own successful-payment receipt is now intentionally part of the buyer experience, while PhotosByElie still owns the actual delivery links and order recovery. The live webhook destination has been renamed from Stripe's generated label to `PhotosByElie Worker checkout`; endpoint, event, and API version remain unchanged.

The Worker was redeployed after the first live proof so future Checkout PaymentIntents use statement descriptor suffix `DOWNLOAD` instead of `ORDER`.

The live checkout Worker was also redeployed as version `143f9f7f-ab55-4f82-9a68-88e4ab663cdb`; hosted Stripe Checkout now receives the updated low-tier line items, minimum-charge adjustment, and `DOWNLOAD` statement descriptor suffix.

The latest public-site pass added a conservative buyer trust path: basket/order notes explain Stripe receipts versus PhotosByElie delivery, `support.html` covers recovery, personal-use license, commercial-use approval, support email, and case-by-case refund handling, and the public favicon/topbar now use the selected camera-tripod brand mark.

The latest social pass updates the homepage Featured section from Pinterest-only to social, adds the first Facebook Page Invalides feature card, and keeps the existing Pinterest campaign links.

The latest autonomous repo-side strategy pass added a price/offer strategy draft. It recommends a digital-only launch, owner-approved support/refund posture, and a proposed real camera ladder of `$3 / $8 / $28 / $65` with lower AI pricing, while leaving the current live price files unchanged until owner approval.

The latest POD preview pass keeps the storefront closed while modeling the first print sizes, supplier capabilities, quality-tier routing, and supplier SKU/cost placeholders in the catalog. Owner Commerce now shows supplier readiness, route tiers, option rows, and schema counts on localhost; public checkout still defaults to digital-only unless Owner deliberately enables physical items locally.

The latest SEO/discovery pass added `robots.txt` and `sitemap.xml` for the homepage, core galleries, campaign pages, and support page while keeping owner/order/basket/real-estate/experiments/raw-social working pages out of crawler focus.

This checkpoint refreshed the durable docs after the user reported all threads quiet. No public version, catalog, Worker, Stripe, price, or site behavior changed; the work is just the SUMMARY/HANDOFF/TODO/README/TIMELOG state refresh and the fresh backlog rollup.

The latest automation setup added `pbe-daily-social-posts`, a daily 09:00 local automation for Facebook, Instagram, and Pinterest. It is instructed to use only public watermarked R2/social assets, avoid secrets/private downloads/Owner metadata, choose three distinct themes with 5-10 images per platform post, publish when already authenticated, and otherwise leave ready-to-publish packages.

## Earlier Conversation Context

This conversation focused on getting the Owner side of Photos By Elie usable as an operations console, then tightening the title/keyword review pipeline and its operational safety. The earlier work started with the Real Estate owner extension and grew into a broader pass over imports, R2 coverage, hidden/discarded state, and local catalog rebuild safety. The latest work ran the David-only nightly title/keyword automation locally, produced a fresh 100-row review batch, and identified a moderate security/privacy risk from committing Owner review JSON into deployable assets.

1. The Owner Real Estate side gained client management: create/update/delete clients, show plaintext local passwords for now, edit rows directly, derive usernames/slugs/gallery keys/titles/prefixes from the client name, and use `/Volumes/Saturn/Pictures/RE/<ClientName>/<Property>` as the source convention.
2. Real Estate import now proceeds with available property folders instead of failing the whole import on a missing folder, and progress reports count/total while it imports.
3. The Owner page was reorganized into tabs to reduce the scroll marathon. The import dashboard was restored as its own tab.
4. R2 background work was made more understandable: phase details moved under their progress bars, finished and failed phases collapse, active phases stay expanded, skipped phases show `UNFINISHED`, and phase-level skip controls were added.
5. The R2 background work copy was repeatedly clarified so the progress bar says what it is counting and whether a phase is doing new work or double-checking idempotent work.
6. The Cloud Coverage / Fill in gaps concept became distinct from full imports. Fill in gaps should repair missing masters, triplets, and previews without reimporting everything.
7. The import dashboard evolved toward a pipeline model: source discovery fills a FIFO queue, planning decides what is already covered versus what needs work, and a slower worker creates/uploads missing masters, triplets, and previews.
8. The matrix UI was tuned for long filenames and real progress: finished rows disappear, active/current rows stay near the top, the matrix uses more width, and the two-row-per-photo shape keeps names separate from checkboxes.
9. Camera, AI, Real Estate, Lightroom, and Apple Photos imports were aligned around the same shared source-lane detail and pipeline language. Apple Photos with faces remains off limits.
10. The conversation dug into possible misplaced R2 previews/triplets from older key conventions and confirmed the need for Owner DB truth: track current R2 objects, marked-for-delete objects, and confirmed-deleted objects so ordinary runs can trust the DB instead of doing expensive deep scans.
11. The local helper/catalog rebuild path was fixed so H/X changes survive SQLite regeneration and do not collapse the public catalog into partial exports.
12. The AI catalog was recovered after a bad export path dropped many AI rows. The active catalog was restored to the expected full scale.
13. The France gallery/detail H/X behavior was repaired. Detail-page H/X now navigates away assertively and repairs cases where local hidden state exists but the catalog state needs to be republished.
14. Photo `20180322-0915-00173-e3b893dbea` was investigated for both H/X and orientation. It had an EXIF rotate-180 source flag, and the public preview had been regenerated upside down. The importer now recognizes numeric EXIF orientation values, and corrected 900/1800 previews were uploaded to remote R2.
15. The title/keyword generator now invokes the selected Codex ladder model for each rework proposal instead of merely recording requested model metadata. Rework rows preserve prior rejected title/keywords and Owner comments as explicit model context.
16. A successful nightly run generated batch `2026-05-19-230413-165Z` with `321` proposals: `221` Codex-backed rework rows and `100` ordinary new-photo rows. Two rework rows remained model-blocked and were kept rejected for future stronger tooling/context.
17. The Owner review page Propagate button now propagates the reject note along with the reject decision, reject reasons are visible mutually exclusive horizontal checkbox options with short labels and editable note templates, video review rows show the usual play-triangle overlay, and rows can be basketed with a visible Block button or `H`/`X`.
18. Handoff sweep published 239 approved rows from batch `2026-05-19-230413-165Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and approval audit JSON.
19. Handoff sweep published 53 approved rows from batch `2026-05-20-093025-705Z`, refreshed hidden counts, and generated visible build `v81.10`.
20. The nightly title/keyword run and the improved review UI are an excellent key step: many remaining rejects should be treated as useful evidence that the next quality jump needs stronger picture recognition, more reliable visual clues, and better use of nearby-shoot context rather than another local-rule cycle.
21. The David-only nightly automation generated batch `2026-05-20-181058-181Z` with `100` ordinary new proposals, no rework rows, no model blockers, and no newly parked rows. All 100 proposals had non-empty titles and actual generator provenance of `local-metadata-rules-v1`, but all were `source_context` rows below the 10-keyword target and the audit showed weak internal-marker titles.
22. The automation exposed a workflow-method issue: `owner_state_db.py --title-keyword-generator-state-json` now emits about 1.36 MB, which can exceed Node's default `spawnSync` buffer in the generator. The run succeeded with a local in-memory buffer override; the durable fix should raise the generator's `runOwnerStateDb` buffer without changing workflow behavior.
23. The security review concluded that the current setup is a moderate metadata/privacy risk if Owner review JSON is pushed to a public deployable site. `Owner.sqlite` is ignored/local, which is correct, but committed review batches can expose photo IDs, capture dates, internal workflow state, title/keyword proposals, source-path clues, and Owner curation context.
24. The hardening pass removed tracked title/keyword review batch and approval JSON from the Git index while keeping those files locally for the localhost helper/review page. `.gitignore` now treats future review-queue JSON as local-only.
25. The title/keyword generator now uses a larger `Owner.sqlite` subprocess buffer, filters internal markers such as `NotMyPhoto`, derives better local titles for internal family/travel placeholders, preserves a safer keyword floor, and reports quality counts before writing/importing a batch.
26. Model-backed title/keyword output validation now requires the model to return at least 10 keywords, and normalized model proposals calculate keyword-target success after the fallback keyword floor is applied.
27. The Owner Real Estate client lifecycle gained a helper-backed `discover-properties` action so a saved client can replace its configured property list with media-bearing folders found under the convention source root.
28. The Real Estate client review wizard now gives a clearer output-step summary by listing selected media counts by active property/project before PDF/slideshow draft generation.
29. Batch `2026-05-20-181058-181Z` was rejected in local `Owner.sqlite` for rework with the exact Owner note `use the hints in the keywords to provide a decent title`, moving the 100 weak proposals out of submitted-unchecked state and into rework eligibility.
30. The improved generator then produced replacement batch `2026-05-20-185753-222Z` with `200` proposals: `100` Codex-backed rework rows, `100` ordinary local-rule rows, `0` model blockers, `0` keyword-target misses, and `74` `needs_owner_context` rows. Seven ordinary rows were marked reviewed as no-change.
31. A batch-summary preservation bug surfaced when no-change review marking overwrote the new batch's count row with zeros. `owner_state_db.py` now preserves existing nonzero batch counts when later decision-only/no-change writes touch the same batch, and the local row for `2026-05-20-185753-222Z` was repaired by re-importing the generated batch view.
32. Handoff sweep published the latest Owner discard/tombstone state into the buyer-facing catalog artifacts, reducing the active public catalog to `6,239` rows and moving `4,476` photo IDs into durable discarded state.
33. Handoff sweep published the latest Owner discard/tombstone state into the buyer-facing catalog artifacts, reducing the active public catalog to `6,019` rows and moving `4,696` photo IDs into durable discarded state.
34. Handoff sweep prepared the checkout/order hardening work for handoff as `v82.7`: order recovery now accepts order ID plus checkout email on `order.html`, Worker download tokens expose expiry/limit metadata, successful downloads append order events, Stripe Checkout receives the buyer email for receipts, and Worker KV/token defaults are documented.
35. Sandbox Stripe checkout was verified end to end with successful payment, declined-card handling, 3D Secure, webhook delivery, receipt URL inspection, order recovery, per-file downloads, and download-all delivery.
36. Live Stripe onboarding was completed far enough that the live dashboard showed no active account tasks.
37. A new camera-tripod PhotosByElie brand asset was selected and committed under `assets/branding/`; live Stripe branding uses that logo/icon plus brand color `#5B341E` and accent color `#D86A3E`.
38. Live Stripe successful-payment customer receipts were enabled; refunds remain disabled.
39. A live Stripe webhook destination was created for `checkout.session.completed` at the deployed Worker endpoint, with destination ID `we_1TZmoVPuO9o6fOp6JkBENiyV`; its display name is now `PhotosByElie Worker checkout`.
40. Live Stripe secrets were installed in Cloudflare outside git, and the Worker created live Checkout Sessions.
41. Live checkout proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming in Stripe balance, order status `ready`, one private JPEG delivery file, and a verified Worker download of `401,035` bytes.
42. The deployed Worker version `143f9f7f-ab55-4f82-9a68-88e4ab663cdb` now uses `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX=DOWNLOAD`, so future card statements should show `PHOTOSELIE* DOWNLOAD` with the current Stripe prefix.
43. `v83.3` adds public buyer trust/support copy and publishes the camera-tripod mark as the public site logo/favicon.
44. `v83.4` updates the homepage Featured section to show the first Facebook Page feature beside Pinterest features.
45. A repo-side price/offer strategy draft now lives at `docs/commerce/PRICE_OFFER_STRATEGY.md`; it documents the proposed launch ladder, bundle timing, refund/support draft, and implementation checklist without changing live prices.
46. First-pass public crawl files now exist: `robots.txt` and `sitemap.xml`.
47. A docs-only quiet-thread checkpoint refreshed SUMMARY/HANDOFF/TODO/README/TIMELOG and kept `TODO.md` as the numbered backlog source of truth.
48. Daily automation `pbe-daily-social-posts` now prepares daily Facebook, Instagram, and Pinterest post packages from watermarked public assets.

## Current Operational Notes

- `v79.29` reconciles the dirty Owner-generated state: discarded photos are now excluded from public manifest/catalog outputs, including `20180322-0915-00173-e3b893dbea`.
- Owner DB R2 rows now infer photo id/object kind for older records, including Real Estate keys, and current-key DB records are trusted by ordinary coverage checks.
- Fill in gaps now trusts known-current R2 objects, avoids force-uploading them, and emits initial checkbox state for each photo before slow work starts.
- In `v81.20`, the Imports tab's Start Imports button always starts the full source sweep across Camera, Apple Photos, Leonardo, and Real Estate, even when current catalog coverage is clean.
- In `v80.0`, the latest Owner title/keyword approvals are published into the public SQLite catalog and Worker catalog. The `2026-05-16` approval batch now contains 89 approved rows, with fresh Portugal, Bilbao, and Paris metadata carried into buyer-facing catalog data.
- In `v81.3`, the Owner title/keyword review flow can load pending proposals directly from `Owner.sqlite`, preserve useful existing keywords as a floor when generating proposals, split approval writes by proposal batch, show the pending review count from the Owner dashboard, show proposal model provenance, clear stale proposed rows that are already blocked or missing from the public catalog, propagate reject notes with propagated rejection decisions, offer mutually exclusive horizontal reject-reason checkboxes that prefill editable notes, preserve previous reject notes unchanged on load, and mark video rows with a centered play badge.
- In `v81.4`, 239 approved title/keyword rows from batch `2026-05-19-230413-165Z` are published into the buyer-facing SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- In `v81.5`, the Owner title/keyword review rows expose the existing H/X Waste Basket path as a visible Block button beside Propagate, so bad proposals can be blocked during the same review pass.
- In `v81.6`, individual title/keyword approvals autosave and move selection/scroll to the next row, making the review pass flow without manual arrow navigation after every approved photo.
- In `v81.7`, Block is a third title/keyword review decision beside Approve and Reject, propagates across current/following same-shoot rows, and saved block rows show `Blocked`.
- In `v81.8`, propagated title/keyword blocks use a helper-side batch Waste Basket action, avoiding one full catalog/Worker rewrite per blocked row.
- In `v81.9`, title/keyword decision controls ignore browser-restored checkbox state on reload so stale Block checks cannot trigger surprise autosaves.
- In `v81.10`, 53 approved title/keyword rows from batch `2026-05-20-093025-705Z` are published into the buyer-facing SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- Codex-backed title/keyword rework escalation is implemented: rejected rows carry prior proposal context from `Owner.sqlite`, select the next configured model ladder level, invoke the actual selected Codex model, record model attempts/preview paths, and export explicit model-blocked or ladder-exhausted details instead of silently recycling weak local proposals.
- Owner rejection patterns from this run should now feed the next model/tooling iteration. Rejects caused by insufficient visual understanding, missing landmark/context clues, or weak nearby-shoot inference are not a reason to weaken the workflow; they are the backlog signal for better picture recognition and richer per-photo context.
- Current title/keyword queue counts are accepted `1076`, proposed/submitted-unchecked `418`, rejected `0`, blocked `27`, parked `62`.
- Latest generated title/keyword review batch is `2026-05-20-185753-222Z`, with `200` proposals: `100` Codex-backed rework rows and `100` ordinary local-rule rows.
- Owner review JSON under `assets/owner-actions/title-keyword-review-queue/` is now ignored/local. The helper and generator should keep treating it as derived localhost review-page/audit output, with `Owner.sqlite` as durable state.
- In `v81.15`, the title/keyword generator has a durable buffer fix and local proposal-quality improvements, while the Real Estate owner UI can use discovered property folders and the client review output step summarizes selected projects.
- In `v81.18`, public catalog loading and helper rebuilds use the plain SQLite catalog directly and stop generating or preferring the Brotli-compressed `.sqlite.br` artifact.
- In `v81.19`, gallery Fill mode uses uniform square image cells while Fit mode keeps natural-ratio masonry.
- In `v81.20`, Start Imports no longer short-circuits on clean catalog coverage; Fill in gaps remains the coverage-only repair action.
- In `v81.20`, Camera, Apple Photos, and Leonardo source rows keep a source checkpoint, and Real Estate upload resume records include file size plus mtime. Edited source files are treated as new import work and force fresh renders/uploads under the existing R2 keys.
- In `v81.21`, Camera, Apple Photos, AI/Leonardo, and Real Estate import lanes use the same Owner matrix renderer, matrix rows can show tiny localhost-only source thumbnails, and a sweep stopped by skipped source lanes displays the catalog export as blocked/needs attention instead of making later phases look like they are waiting forever.
- In `v82.0`, the public SQLite catalog, Expo manifest, homepage data, Worker catalog, and discarded-media manifests reflect the latest Owner discard/tombstone state: `6,239` active public rows and `4,476` discarded photo IDs.
- In `v82.1`, the Nerja glass treatment keeps the documented Best Mix alpha/frosting values, shared filter/control heights are normalized, and the homepage photo-stack entrance animation is stabilized so it does not restart midway or jiggle at the end.
- In `v82.2`, the first-open gallery density fallback is 3 columns; saved owner/viewer density choices still win after a user changes the grid.
- In `v82.5`, the public SQLite catalog, Expo manifest, homepage data, Worker catalog, and discarded-photo tombstones reflect the latest Owner discard/tombstone state: `6,019` active public rows and `4,696` discarded photo IDs.
- In `v82.7`, buyer order recovery and delivery links are more durable: the order page can look up an order by order ID and checkout email, per-file delivery rows show link availability when present, Worker download tokens enforce expiry/download limits, successful downloads are appended to the order event history, and Stripe receipt metadata includes the buyer email.
- In `v83.0`, Owner-approved title/keyword metadata is published into the buyer-facing SQLite catalog and Worker catalog, and the keyword blacklist compatibility export is refreshed while keeping active public rows at `6,019`.
- In `v83.1`, rejected title/keyword review comments now carry the rejected proposal title and keywords as attached context for the next AI rework rung.
- In `v83.2`, JPG 1 MP and 3 MP checkout tiers are $0.10 and $0.30, buyer prices render cents cleanly, orders below Stripe's $0.50 minimum receive only the needed top-up, and a Dock launcher opens localhost Owner in Safari.
- In `v83.3`, basket/order pages show buyer trust notes, `support.html` documents payment, delivery recovery, license, and support expectations, and root public pages use the camera-tripod logo/favicon.
- In `v83.4`, the homepage Featured section includes the first Facebook Page feature card alongside Pinterest campaign cards.
- In `v83.6`, Owner Commerce exposes local-only POD automation preview data for supplier readiness, quality tiers, supplier option rows, and SQLite POD table shape while `pod_settings.storefrontEnabled` remains false.
- On 2026-05-23, the QR coaster 3MF assets were refreshed after print/underside review, the title/keyword blacklist added date/noise terms such as `2018`, `May 2018`, and `Sony?`, and the daily social package for Facebook, Instagram, and Pinterest was generated as ready-to-publish Owner output.
- Current local coverage reports zero missing active masters, triplets, or previews.
- The local helper is serving port `8000`.
- The ignored local hidden files can change during Owner actions and are not tracked by git.
- The tracked generated artifacts are expected to change when Owner actions discard photos or regenerate catalogs; commit them only after the public manifest, worker catalog, and SQLite catalog agree.
- Remote R2 was verified for the corrected `20180322-0915-00173-e3b893dbea_1800.jpg` preview, and the remote hidden blacklist contained that id at verification time.

## Recent Relevant Commits

- `e6c49772 photosbyelie: add crawl discovery files`
- `c7776899 photosbyelie: document launch offer strategy`
- `a8902dd2 photosbyelie: promote facebook feature`
- `bc48acf8 photosbyelie: add buyer support page`
- `e4496040 photosbyelie: record deployed descriptor suffix`
- `8e6787ab photosbyelie: align live checkout worker`
- `85b361d8 photosbyelie: record live stripe proof`
- `d53de85f photosbyelie: log public site update`

## Verification Notes

Recent implementation cycles ran:

```text
node --check photos.js basket.js order.js
node --check hidden-actions.js
node --check photo-detail.js
node --check owner.js
node --check title-keyword-review.js
python3 -m py_compile scripts/local_server.py
python3 -m py_compile scripts/owner_state_db.py
python3 -m py_compile scripts/build_lightroom_thumbnails.py
python3 XML parse check for sitemap.xml
npm test
npm run validate
git diff --check
browser checks on Owner tabs, import dashboard, detail H/X redirect, and corrected remote preview bytes
```

## Current Backlog

`TODO.md` is the numbered backlog source of truth. The fresh priority order is: review/tune the `v83.3` buyer support/refund/license wording, approve/deploy the price/offer strategy, curate the first sellable storefront, add analytics, deepen SEO/discovery, review daily social automation output/launch pages, Owner title/keyword review, Real Estate production polish, and long-horizon Owner/media hardening.
