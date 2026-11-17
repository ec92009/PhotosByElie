# PBE-221 integrated release candidate

Prepared isolated branch `t3/pbe-221-release-integration`, based on
`618f9da211810a09fbc0aed88f6283ec0ba536aa`. Parent owns YouTrack, shared time
tracking, telemetry, production adoption and ticket acceptance.

## Integrated provenance

All supplied commits were cherry-picked sequentially with `-x`. Git resolved
the shared-file hunks cleanly. The package manifest retained its full existing
test inventory and gained the artifact and WST checks.

| Source | Integrated commit |
| --- | --- |
| `d884a66a16662ba23c7eff04677a2aa0072c81fe` | `994b737d160721e9dc3ff5f97d58d5208972f013` |
| `0753f4433e7fdd130ad0fd3fd376fb52b69928e2` | `a1141c9026008772e1d5b0eea278c55471150b50` |
| `45d88cb8c81861752b5f2d1356500ffd35ab017b` | `bb52a8a883257f60f88de7995a4f51ad3f690729` |
| `7710d7f56b528cec1d520341192c8fbd83e02d32` | `044d996d95e3a82cab56f758f91a61da562c55d6` |
| `439ac64802a8478e4603a1a66d6c0fdbc591d829` | `b88e0b591c7665ba7b6e2722751117a7a222a76b` |
| `397bc77a84e082aac1aee39d74952f4232c1b576` | `14968c4cd1c139bac1297888d05b9b47b6c30af8` |
| `4dcd766ba3d402d66c80d61f82bfd75a7c0a1400` | `4978948316f28270091bd3b3ff43c355741de77b` |
| `16f77893ed0ad5aa572c3380a8fcd0d0fa496925` | `caee55b285233e7ddff65c886ac16e4df3e2c50d` |
| `e9cb93970ea96504f33e442dcb23cd577c9429cc` | `5a16c2532d5e0f21035d4a38b971b6071bbb8120` |
| `60c365ca02134b9debad8fa960aa09f63c040ae8` | `f141e7464750694cd095eb953cbf27cfb53508b8` |
| `25a5ac307096b0ada748ef742216addbbe17ee40` | `a730b095dbd8d03fa55dfea692985705a9a3c4e3` |
| `735cd1171406a10400b03d5cc144f8f388e9a8d7` | `b7dff318c5c3f192db732b9ced399b6d6cd076a9` |

Additional bounded integration commits contain native assertion maintenance,
the release identity, deployed WST reconciliation, the native-zoom settings
fix, authority-test environment isolation, translated action labels and host
fixture diagnostics. Their history follows the
`photosbyelie:` prefix.

## Release identity and retained inputs

Remote main at `c00ef4d538b4908c012ff6b3a0945c85ef74bdbe` carries v314.0.
A read-only T3 browser visit independently observed v314.0 in production's
About and version pill on November 17. The prepared checkout inherited v241.0.
The canonical calendar SOP yields day 321 for this date. Branch/ref inspection
found no existing 321.x identity when the first candidate v321.0 was assigned.
That candidate produced a validated local artifact at `08162814`. Subsequent
localization changes produced v321.1. The source-backed local-host startup
fix advances the final candidate to v321.2.

The existing version advancement helper updated the linked HTML surfaces and
README together. About and pill agree on v321.2. Packaging checks their
agreement and binds the source commit in `release.json`. The package-manager
version retains its existing separate package identity.

The retained plain public SQLite and pricing policy have these SHA-256 values.

- SQLite `ba14324a33fc400d5506738c4614fe0bf3f0e11747a46cab70f4b3b41706c632`
- Pricing `4ffa3c68fc2666a5d8fb4bb317777ca0040fdc0979c572b2754006254460897f`

`node scripts/write_catalog_tsv.cjs --bootstrap-only` was run after integration.
It remained byte-idempotent and retained those input hashes. The final-shell
SEO build produces 5,303 photo routes, seven gallery routes and 5,316 sitemap
URLs. Artifact generation repeats that build and verifies exact membership,
canonical resolution, version references and per-file bytes.

The private package and gate receipts live at `tmp/public-release/receipt.json`
and `tmp/pbe-221-evidence/authoritative-release.log`. The release package is
generated after this source receipt is committed so its identity can bind the
clean committed tree. The previous v321.0 package is retained separately at
`tmp/public-release-v321.0/` and `tmp/public-release-v321.1/`. Inspect its `identity` and `releaseChecks` for the exact
artifact source SHA and gate result.

## Owner input review

An existing frozen Owner snapshot was inspected through immutable, read-only
SQLite connections. Its stored public projection records approved PBE-173
provenance. The same read-only policy inspection was performed against current
canonical Owner metadata. All 5,303 retained candidate identities were eligible
in both inputs, with zero blocked or missing candidate identities. Both
databases passed `quick_check`, and file size/mtime remained stable.

This review uses durable SQLite decisions, reconciliation and lifecycle state.
The existing frozen snapshot was selected for the local candidate gate after
this substantive eligibility/current-lifecycle review. Its absolute path,
fingerprint, stored projection provenance and aggregate comparisons are retained
privately in `tmp/pbe-221-evidence/reviewed-input.json`. That JSON is an inspection
receipt. The validator reads the selected SQLite file itself. Canonical Owner,
the public catalog and the existing frozen snapshot received zero writes.

The direct policy validator passed against that input. A validator invocation
without an authority input failed closed as expected. Parent retains production
approval and acceptance of the resulting release receipts.

## Verified production landing baseline

Read-only browser fetches confirmed exact SHA-256 parity with
`c00ef4d538b4908c012ff6b3a0945c85ef74bdbe` for `index.html`,
`landing-concept/landing.js`, `landing-concept/landing.css`, `social.html`,
`campaign.js`, `campaigns.js`, `campaign-video.js` and
`campaign-collection.js`. Private hash receipts live in the evidence directory.

The integrated landing source starts from prepared `618f9da2` and PBE-219
settings at `7710d7f5` / integrated `044d996d`. Production adds revised
usage-guide markup/copy/assets, social-directory navigation, story-card
contrast and later campaign behavior. Their broader baseline adoption remains
a parent-reviewed release dependency. PBE-224 can use the exact production
commit above for its separate offer candidate. Prices/licenses and the new
PBE-224 copy candidate received no changes here.

## Deployed WST reconciliation

Parent's PBE-222 findings identified production WST source at
`01cc3ef32b17b9602f52ca2f4a50b42fe109d0fa` and storefront activation at
`b1ab5ad5f6fdaf30cd148072bf176a06d60c670a`. The private business report was
read through Git. Runtime prerequisites and tests were selected from committed
source, with their broader branch diff inspected first.

The candidate carries the deployed browser handoff, action map, beacon,
privacy-policy wording, private commerce snapshot, Worker RPC entrypoint and
Stripe reader prerequisites. The four Worker runtime files match the deployed
source commit. New tests exercise aggregate-only output, live-configuration
gating, HTTP delegation and bounded mocked Stripe GET readers.

Generated photo/gallery families enter the existing sessionless handoff.
Their transmitted paths normalize to `/photo.html` and `/gallery.html`.
Existing semantic action IDs cover generated links and the customer settings
gear. The WST assets inherit the initiating analytics script's version query.
Privacy/route tests cover canonical and generated routes, production-origin
restriction, local/IPv6/mesh/foreign origins, preview mode, DNT/GPC, late GPC,
query removal, session-storage exclusion and stable dynamic CTA markers.

`npm test` includes these WST privacy and commerce tests. The public exact-file
allowlist contains both WST assets. The private research report, collector,
business aggregates and `.wst` configuration stay outside the public artifact.

Workers API references were checked against current Cloudflare documentation
and `@cloudflare/workers-types@5.20261117.1`. Service binding RPC uses
`WorkerEntrypoint` and its environment. [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

## PBE-223 offline tool integration

The parent-reviewed source-only tool at `735cd117` was cherry-picked with
provenance. Its two Python source files are registered in the existing main
Python test command once. The 24 synthetic report tests add no separate CI
invocation. Both source paths and representative ignored CSV/JSON report paths
are explicit negative probes, supplementing the existing forbidden scripts/tmp
classes. A synthetic CLI export/report fixture under ignored `tmp/search-console/`
exercises the normal private output path. Its files stay outside the staged site.
Actual Search Console exports remain PBE-223 owner evidence and carry no new
PBE-221 acceptance condition.

## Verification performed

| Check | Observed result |
| --- | --- |
| First combined catalog/SEO/settings/fulfillment suite | 283 passed |
| Initial full suite | 32 pretests, 288 main Node tests passed, two baseline failures among 489 Python tests |
| Native maintenance | 68 Python parity tests and the existing Swift independent-preview relaunch behavior test passed |
| Integrated required startup/SEO/resilience/fulfillment/customer-boundary checks | 71 passed |
| Artifact regression suite | 26 Python and four catalog-generation tests passed |
| WST/commerce/checkout/fulfillment/analytics/origin suite | 141 passed |
| Full suite with WST and zoom fix | 32 pretests, 26 artifact Python tests, four generation tests, 298 main Node tests and 489 main Python tests passed |
| Swift API contract | Current, 41 operations and 14 schemas |
| Authority environment fixture isolation | Reproduced inherited-authority failure, then all three fixture tests passed with a real authority variable present, including explicit environment-input success |
| Syntax and whitespace | Changed/shipped scripts checked by the artifact gate, `git diff --check` passed |

The authoritative gate repeats the required and full suites from the committed
candidate, performs Owner validation, stages a fresh artifact and records the
source SHA in its receipt. Its log provides the final repeated run counts.

### Native and release-gate test maintenance

The two native failures asserted symbols intentionally replaced in
`b09b6b9f3458ee3c3c0689157d4b8338ede71343`. Updated assertions retain both exact
persisted preference-key strings and the existing layout/collapse contract.
The native implementation is unchanged. The separate maintenance receipt is
`docs/audits/pbe-221-native-test-maintenance.md`.

The release gate supplies `PHOTOSBYELIE_OWNER_DB` to its test subprocesses.
The authority negative fixture previously inherited that variable and therefore
received real authority despite intending to omit it. Fixture environments now
explicitly control the authority input. The same test also checks the supported
environment-input success path. Production validation remains fail-closed.

GitHub CI repeatedly failed the split-root host readiness fixture while local
Python 3.14 and Python 3.12 passed. A separate diagnostic run at
`b86bcc7d` captured the child blocked in Python `socket.getfqdn` called from
`HTTPServer.server_bind`. The local server now binds through `TCPServer` and
sets HTTP metadata from its actual configured address/port. A regression test
raises on any reverse-DNS call. The original 10-second deadline, split-root
identity, exact served bytes and tamper rejection remain. The temporary CI
tracing step was removed after diagnosis. The DNS regression brought the Python suite to 490 tests. PBE-223 adds 24
synthetic checks, bringing the integrated total to 514 tests. Final CI and repeated gate results are recorded with the source identity.

### Browser and local buyer receipts

T3 preview was the primary browser. A private IPv6 loopback fixture exercised
the actual non-localhost lifecycle path through local responses. Its CSP
restricted connections to the fixture. Preview media used a representative
existing public hero image through the local mock media route.

- Generated France gallery hydrated 24 cards. Its 54 lifecycle batches used
  concurrency six. Generated detail requested one batch for its one identity.
- Generated body identity and query-ID precedence both selected the expected
  photo and canonical. The duplicate gallery attribute fix remains present.
- Gear, About/pill agreement, System/Day/Night, OS appearance changes,
  reload/cross-page theme persistence, EN/FR/ES controls, 320px and 390×844
  viewports were exercised. The legacy gallery action-label checkbox now uses
  the same EN/FR/ES translation contract. Keyboard open, Tab wrap, Escape, outside dismissal
  and focus return were exercised.
- Settings text contrast at transparency/blur extremes was at least 14.54:1
  on the landing dialog, 15.51:1 on the light customer dialog and 15.03:1 on the
  dark customer dialog against worst-case black/white backdrops. Screenshots
  were visually inspected. Broader image/text combinations have partial visual
  coverage.
- Real network abort of SQLite and real local lifecycle HTTP 503 both produced
  localized recovery, zero installed media and preserved basket bytes. Retry
  restored the generated route and gallery after recovery, preserving URL
  query/hash and the $65 selection.
- The local delayed checkout failure synchronously disabled Buy Now. Repeated
  activation produced one local checkout POST, then released the button on
  failure. Basket bytes remained identical. Worker happy/recovery paths use
  the existing in-memory/mock binding tests.
- T3 preview zoom shortcuts left viewport/scale unchanged. A separate isolated
  Playwright persistent browser used Chrome's actual Page zoom setting at 200%.
  A 1280px browser viewport yielded a 640px CSS viewport. Landing settings
  remained scrollable. Gallery settings overflow exposed by that check was
  fixed with viewport-constrained internal scrolling. The repeated check showed
  the dialog and About within the 450px CSS viewport.
- Browser CSP sandbox with scripts disabled rendered entity identity, links
  and EN/FR/ES guidance. A separate Playwright context with
  `javaScriptEnabled:false` confirmed engine-level disabled scripting and an
  ordinary support-link navigation.

Screenshots, browser result JSON, network counts, fixture controls, zoom and
engine-disabled receipts remain private under `tmp/pbe-221-evidence/`. Staged
artifact checks use the same exact customer bytes, with fixture-only media and
API configuration overrides recorded separately from release output.

## Remaining release and architecture acceptance

- Parent accepts the final candidate, source SHA, reviewed-input receipt and
  required checks before deciding production next steps.
- Production artifact-source adoption, live negative-path checks on every
  active origin, deployed identity and whole-artifact rollback proof remain
  production work. PBE-216's parent-reported legacy exposure persists until
  authorized publishing-source adoption.
- Public website publication requires parent-reviewed adoption of the deployed
  landing/social/campaign baseline described above. The prepared landing
  content has a verified source drift boundary.
- Worker publication requires reconciliation of additional deployed-source
  refund orchestration and account gallery-checkpoint behavior absent from the
  prepared baseline. The public artifact excludes Worker source. The WST RPC
  prerequisites are integrated, while broader Worker release acceptance remains
  a parent dependency.
- Real Stripe sandbox/payment and email delivery receipts, physical-phone
  cold/warm timing, mobile installation/share and production lifecycle behavior
  retain their separate acceptance boundaries. Browser receipts above use
  desktop Chrome at mobile viewports and local mocked dependencies.
- Public settings/SEO/module extraction, unused Owner-branch removal and active
  native connector seams remain the deferred architecture scope recorded in
  PBE-220. The included unlinked `owner.html` retains PBB-133's restricted
  provisioning/recovery contract, covered by existing customer-cutover tests.
