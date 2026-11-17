# PBE-224 customer copy candidate

## Source identity

The candidate branch is `codex/pbe-224-copy`, based on
`c00ef4d538b4908c012ff6b3a0945c85ef74bdbe`. Direct HTTPS reads on
2026-11-17 matched that commit byte-for-byte for the public homepage,
`landing-concept/landing.js`, `landing-concept/landing.css`, and `photos.js`.
The served homepage identified itself as `v314.0`.

The original T3 checkout branch, `t3/commerce-copy-clarification`, remains at
`618f9da211810a09fbc0aed88f6283ec0ba536aa`. The copy candidate uses the
verified landing baseline so its source retains the live imagery, full-width
usage composition, social navigation, and country discovery.

Fetched homepage SHA-256 is
`9adf43ccd49eadbff5a588c2536e8e9ad4adfa89e34dd15fa647e99c1b0b07d0`.
Fetched landing JavaScript SHA-256 is
`7558f85dcfc074373528dd9e570f20fe6a23d6043b7b049fc2d3fcded23a9d9c`.
Fetched landing CSS SHA-256 is
`00932ae812b0e9e7adf5048126a042e3f4e1c1cc5a20503e970fa208d48ea99a`.

## Customer wording

The existing introduction now explains digital photo downloads starting at
USD 8, photo-dependent file-size availability, private order-page links after
payment, and included personal print and personal web use. Customers arrange
printing themselves. The accompanying sentence lists the existing uses that
require prior written approval. English, French, and Spanish cover both copy
and accessible navigation labels.

The purchase link opens the existing selection gallery. The permission link
opens an email addressed to `orders@photos-by-elie.com`, the existing support
address in `photos.js`. The current support controller hides its email button
when there is no order context. A direct email link gives prospective buyers
an available permission-request action. The footer retains the support and
license page.

The project-use image caption now says “Project permissions”, with localized
equivalents. The basket's localized 3 MP description now describes a JPEG
download. This removes listing, portfolio, and editorial-use suggestions from
that customer presentation.

The fetched product configuration exactly matches the baseline file. Its
digital prices are USD 8/16/28/65 and storefront POD is disabled. The configuration
still contains the ambiguous 3 MP use description. Broader editorial-use
eligibility remains unspecified by the retained default personal-use license.
Any future policy decision should answer whether non-personal editorial use is
permitted and which listing/portfolio contexts qualify. PBE-14 and PBE-16 retain
their parked scope. This candidate uses the existing personal-use grant and
written-permission path.

## Parent integration

Apply the copy commit as a bounded patch onto the reconciled PBE-221 source.
Its diff affects the homepage introduction and one caption, three landing
translation entries per language plus new offer keys, three small CSS rules,
and one product-description key per language in `photos.js`.

Keep PBE-219's System theme, storage handling, settings events, account-profile
theme guard, and recovery behavior. Keep PBE-218's metadata and generated-shell
contract, plus the deployed WST source. The copy patch leaves their entry points
available for the integrated candidate.

The inspected PBE-221 commit `afe381ad5ce7432ec6ce7ef83890f38cfe06b5b1`
still contains the earlier three-card usage composition. Parent reconciliation
must bring forward the verified live landing layout before release acceptance.
Its current settings implementation can be retained while applying the copy
hunks. Whole-file replacement would discard independent integration work.

A synthetic merge of PBE-219 commit
`7710d7f56b528cec1d520341192c8fbd83e02d32` onto this baseline merged the
landing JavaScript and CSS cleanly. The homepage conflict concerns the existing
stylesheet version and addition of the theme bootstrap. The `photos.js`
conflict concerns the account-profile theme guard alongside newer gallery
checkpoint restoration. Preserve both behaviors when reconciling those existing
source differences. The new copy occupies separate hunks.

Parent assigns the integrated release identity under the canonical versioning
SOP, including the new purchase-link query, existing assets, About value, and
version pill. `v314.0` in this source records the verified baseline. Advance the
integrated identity before distribution.

## Verification

The following existing test suites passed all 61 tests.

```sh
node --test scripts/landing_concept.test.mjs scripts/shared_gallery_integration.test.mjs scripts/pbe_customer_only_cutover.test.mjs scripts/pbe_owner_session_web.test.mjs
node --check landing-concept/landing.js
node --check photos.js
git diff --check
```

The added tests execute the existing language handler over the offer's HTML
bindings, switch EN/FR/ES repeatedly, check English fallback and no-JavaScript
copy, and verify link destinations. They compare the advertised entry price
with product configuration and exercise the basket description through the
customer translation function. Existing tests cover discovery, settings
structure, contrast palettes, keyboard handlers, and responsive CSS contracts.

Browser rendering, mobile geometry, settings persistence in an actual browser,
email-client launch, and deployed purchase behavior require parent acceptance.
The synthetic source checks supply local implementation evidence. The parent
owns the integrated version, release checks, deployment, and public receipts.
