# PBE-198 — Permanent All campaigns gallery

The permanent destination is https://photos-by-elie.com/campaign.html. Existing `?c=` links retain their campaign detail routes. Public membership is the deduplicated union of primary, hero and related IDs, filtered through the lifecycle-authorized public catalog and public-preview availability. Empty collections are omitted. Explicit private/draft/unpublished/archived campaigns are excluded. Four-image CSS composites use existing watermarked previews; no private media or parallel campaign records are introduced.

The existing social package finalizer rebuilds the campaign index, now including complete member IDs. Desktop uses a maximum of two cards per row; widths up to 700px use one. Homepage navigation and the sitemap include the directory; campaign details link back to it. Network, catalog rejection and empty results have visible status messages.

Validation: 62 targeted tests passed, including complete membership for all 173 source manifests and exclusion/deduplication cases. Publish validation passed against the canonical read-only Owner authority. Browser checked 170 currently eligible collections, desktop two columns, 390px mobile one column with no overflow, San Diego Zoo five photos, and Del Mar eight photos with return link. The plain static localhost server cannot serve the existing local media proxy or authenticated session endpoint; production media verification is recorded separately after deployment.

## Live receipt — 6 September 2026, 16:23 CEST

PR17 merged at `89a90de45bd470cbdd7b6a105ccf30ac20552d0c`; GitHub Pages build succeeded. The bare permanent URL rendered v249.1 with 170 collections. Live desktop layout used two 679px columns and all first eight composite images loaded. Live 390px mobile used one 356px column with no overflow. Del Mar detail rendered all eight cards and all eight images loaded. Local empty-index and HTTP503 simulations showed the expected empty/error messages. Browser cache retained the prior page from the predeployment check; a fresh request confirmed the permanent URL without a version query. PBM records updated separately, without social publication or account changes.

## Refinement receipt — 6 September 2026, 17:00 CEST

The cover index now carries an explicit `compositePhotoIds` sample for the user-flagged Fuengirola, Lisbon Ancient Art, Carnavalet, Malaga Aerial, Alhaurin, Pisa, Benalmadena, Gibraltar, Ronda, and Musee d'Orsay variants. Samples are drawn only from each existing public campaign manifest; complete `photoIds` membership and detail galleries are unchanged. The selection removes the visible Gibraltar head frame and the identified duplicate or near-duplicate pairs while preserving a varied scene, distance, and orientation where available.

Campaign detail cards now expose the same visitor controls as country collections: a `+` selection toggle at upper left and a heart like toggle at upper right, with pressed state, accessible labels, visual selection state, and cross-card like synchronization. v249.4 local browser verification on the Fuengirola detail route found eight cards, eight selection buttons, and eight like buttons; clicking one of each updated the pressed state and liked storage, then the test state was cleared. The same route opens Quick Look by double-click (including directly on an image link), Space, or the existing media context menu; Quick Look ArrowRight moved to item 2 of 8, ArrowDown with three columns moved to item 5 of 8, and the S/L commands updated selection and likes while the modal was open. Escape closed the modal and restored focus. The permanent directory still renders 170 eligible cards from the 173 indexed source manifests; three source manifests have no public-preview-backed entries and remain omitted.

Country-gallery Quick Look now receives the active grid density, so ArrowUp and ArrowDown move by one visible row there as well; a Spain gallery browser check with three columns moved down by one row and closed cleanly with Escape.

Campaign detail also handles Space at the page level: when focus is on the page it opens the nearest visible campaign card in Quick Look and prevents the browser's normal scroll action; focused links, selected cards, and native form controls retain their expected behavior.

## Space shortcut receipt — 6 September 2026, 18:18 CEST

The campaign detail keyboard path is cache-busted as v249.5. With page-body focus on the Albert Kahn detail route, Space stayed at the current scroll position and opened the first visible card in Quick Look; native card controls remain available to their own Space activation.

## Related section receipt — 6 September 2026, 21:31 CEST

Campaign details keep the primary photographs in “All photographs” and render each manifest's related public previews in the “You might also like” section. The section is hidden only when a campaign has no related public previews, preventing an empty panel while preserving the related gallery for campaigns that provide it. The public site cache-bust is v249.6.

## Landing footer layout receipt — 6 September 2026, 21:44 CEST

The landing footer now assigns the brand, tagline, privacy notice, and legal navigation to intentional grid areas. Legal links span a full-width row with a divider, while the narrow layout collapses cleanly to one column. The public site cache-bust is v249.7.

## Campaign controls and landing contrast receipt — 6 September 2026, 21:58 CEST

Campaign detail headers no longer render the inactive Grid density slider. Fit and Fill remain available, while the internal default density continues to support row-wise Quick Look navigation. The landing story-card scrim and text shadows now provide readable contrast over light, detailed images such as Spain. The homepage social shelf remains limited to three routed campaign entries—Facebook Del Mar, Instagram / Threads Fuengirola, and Pinterest San Diego Zoo—with no additional social campaign routes exposed from the front page. The public site cache-bust is v249.8.

## Usage guide refinement receipt — 6 September 2026, 22:16 CEST

The landing usage guide now uses an asymmetrical composition: one large square wall-art feature on the left and two stacked squares on the right. The wall-art feature uses the revised close-cropped Notre-Dame print environment with a bright paneled wall, pale credenza, warm lamp, restrained decor, and the foreground chair cropped to its top edge. The upper-right visual shows an operator from behind using a dark-mode browser with the Del Mar photograph; the lower-right visual keeps the photobook and framed print. English, French, and Spanish copy now describes browsing at leisure or searching by geography, time, keywords, and the photographer’s note. Local browser verification at v249.9 confirmed the three visuals, two-column desktop composition, and complete usage-guide action; the full 302 Node and 489 Python test suites passed.

## Usage guide copy receipt — 6 September 2026, 22:28 CEST

The usage-guide captions now frame the three paths as “Enjoy it,” “Work with it,” and “Remember it.” The supporting sentence is “Find the image that fits by place, time, keywords, or the photographer’s own note.” French and Spanish translations carry the same concise tone without em dashes. The public cache-bust is v249.10.

## Usage guide and social directory receipt — 6 September 2026, 22:51 CEST

The usage guide now runs full width like the country-photo grid, with a deliberate three-pixel seam between the large wall-art feature and the two stacked supporting visuals. Its left-to-right scrim reaches full transparency at 50% of each image, keeping captions readable while letting the photography carry the right side. The hero now places a same-width “Social campaigns” pill beneath “Explore the collection,” and the latest-social shelf repeats that route for visitors who continue down the page.

`social.html` is a dedicated, campaign-backed directory filtered to Facebook, Instagram, Threads, and Pinterest sources. It renders only lifecycle-authorized catalog previews, reports the filtered count, and excludes Etsy campaigns. Local browser verification at v249.11 found 119 social collections, two desktop columns, no Etsy entries, aligned hero pills, and a full-bleed usage grid. The sitemap and active cache-busters use v249.11. Full npm tests passed (303 Node tests, 489 Python tests); publish validation passed against the reviewed Owner.sqlite snapshot.

## Hero navigation receipt — 6 September 2026, 23:10 CEST

The homepage now treats “Social campaigns” as one more destination in the expandable country picker. It uses the same compact country-pill treatment and sits with the geographic destinations, so the hero has one clear action instead of a separate full-width social control. The menu remains content-sized and responsive, with the public cache-bust advanced to v249.12.

## Campaign navigation receipt — 6 September 2026, 23:28 CEST

The campaign header no longer presents the social view as a nested archive trail. Social campaigns now keeps only `Photos | Social campaigns`; the all-campaigns directory keeps `Photos | All campaigns`. Both route trails use unboxed inline links with no oversized breadcrumb pill, while the footer remains the complete cross-directory navigation. The public cache-bust is v249.13.
