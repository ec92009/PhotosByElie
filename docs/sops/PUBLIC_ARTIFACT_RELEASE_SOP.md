# Public customer artifact release

## Publication boundary

PBE-216 supplies a complete static customer artifact and release checks. The
exact-file policy lives in `scripts/public-artifact-files.json`. New files,
including files added beneath an approved asset directory, require an explicit
policy entry. The exact `integrationFiles` entries add `theme-preference.js`
and `customer-recovery.js` when PBE-219 supplies them. Missing referenced helpers
fail dependency checks. Theme preference must precede customer initialization,
and recovery must precede initialization in gallery, photo and basket shells,
including generated entity pages. Validation rejects private/source classes even if listed.

On November 15, 2026, the GitHub REST API reported Pages `build_type=legacy`,
source `main` at `/`, and custom domain `photos-by-elie.com`. The repository is
public. Its only existing workflow was GitHub's generated Pages deployment.
Anonymous HEAD requests still returned 200 for the private delivery manifest,
timelog, and generated Worker catalog. PBE-22's removed review JSON returned
404. Its completion commit `55ad1e3c` remains valid for that earlier scope.

The new CI workflow builds and uploads the validated customer site and its
receipt as separate candidate artifacts. It has read-only repository permission.
All tests and artifact checks must succeed before either upload runs.

Production adoption requires an authorized Pages publishing-source change to a
custom Actions workflow that uploads only the checked `site/` directory and
deploys that same artifact after the release gate succeeds. The publishing job
must depend on the successful checks. Preserve the existing custom domain,
HTTPS, and DNS. GitHub documents this artifact-based publishing path separately
from legacy branch publication. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

Legacy root publication continues to expose tracked internal files until that
production adoption is authorized and verified. Website exclusions also leave
the public Git repository and its historical copies accessible. Repository
visibility and removal of historical copies require their own owner decision.

## Artifact contents

The artifact includes gallery, detail, basket, liked, order, campaign, policy,
support, and Real Estate customer routes, their runtime dependencies, existing
public campaign manifests and public media/context assets. It retains the plain
`assets/catalog/photosbyelie.sqlite` byte-for-byte. The prototype remains an
isolated experiment with its existing noindex behavior.

The unlinked `owner.html` Backstage recovery page and its limited provisioning
dependencies remain included to preserve the accepted PBB-133 boundary. Existing
customer-only cutover and access tests cover its restrictions. Retired browser
Owner workspaces and private Owner state are excluded. This packaging change
adds no browser authority.

Basket and liked source still make optional requests for the excluded delivery
manifest and discarded-ID file. Their existing missing-file fallback remains
in effect. Lifecycle authorization and trusted Worker checkout validation
continue to control access and purchases. Runtime cleanup belongs with the
customer/lifecycle owners.

Source `VERSION` and existing linked page references supply the visible
identity. Packaging copies them unchanged and validates their agreement. Apply
the canonical versioning SOP to the integrated release before publishing.
Public `release.json` adds the source commit, version and catalog/policy hashes.
The complete per-file SHA-256 receipt stays outside the served directory.

## Candidate checks

From the isolated repository root, run these commands.

```sh
npm ci
npm test
npm run contract:check
npm run public:build
npm run public:check
```

The default package is `tmp/public-release/`. Only its `site/` directory is
publishable. Its sibling `receipt.json` and generated marker are local/review
metadata. Use `--replace` on the build command for a previous generated package.
A failed validation preserves the previous package. The validator checks exact
membership, file bytes, symlink exclusion, negative paths, required page assets,
CSS URLs, dynamic module imports, campaign-index dependencies, SQLite integrity,
shipped decoder/pricing contracts, script syntax, and version identity.

`npm test` includes deliberate forbidden-file, symlink, ineligible SEO, damaged
receipt, missing dependency and failed-critical-test cases. An isolated HTTP
test serves customer pages and confirms that internal paths return 404. These
checks cover packaged bytes and server responses. Mobile/keyboard and test-mode
buyer acceptance remains part of the integrated PBE-221 verification.

## Authoritative release gate

The existing `npm run validate` requires an absolute, checkpointed, reviewed
Owner SQLite snapshot. CI receives no private Owner database. Its catalog and
runtime checks produce a candidate artifact.

On a machine with the reviewed snapshot, build the release package through the
following gate. The existing validator opens that snapshot read-only and checks
public eligibility. The command requires a clean committed source tree and
fails before staging if a critical test or authoritative validation fails.

```sh
npm run public:release -- --owner-db /absolute/reviewed/Owner.sqlite --replace
```

Require the resulting receipt's `releaseChecks.sourceCommit` to match its
identity commit and the approved integration SHA before any publishing step.
This command runs tests, authoritative validation, and artifact checks. It
performs no provider action. Keep the snapshot and validation logs private.

## SEO integration hook

PBE-218 candidate `45d88cb8c81861752b5f2d1356500ffd35ab017b` defines the
integration contract in `docs/seo/generated-public-entities.md`. Parent integrates
that candidate and its canonical runtime changes together.

When `scripts/build_public_seo.mjs` exists, every artifact build invokes it with
the exact source catalog and repository root. It generates `tmp/public-seo/`
after catalog/version preparation. The builder creates a fresh customer stage,
then overlays only `photo--<eligible-id>.html`, `gallery--<eligible-key>.html`,
`sitemap.xml`, and `robots.txt` at its root. The existing generic query routes
remain included. `--seo-root` selects an alternate generated output directory
for both build and check commands when needed.

Eligibility comes from PBE-218's exported `loadSeo` / `publicEntities` reader and
its existing storefront policy. Its exact catalog-derived entity filenames form
the allowlist. Filename patterns alone grant no publication rights. Additional
HTML for unknown, private, retired or otherwise ineligible entities fails the
build, as do arbitrary runtime replacements, extra directories, symlinks and
missing generated entities. The `.pbe-seo-generated` ownership marker is
verified and excluded from the served artifact.

The generator runs for every build when present. Failure prevents publication
of a new candidate and preserves the preceding package. Catalog fingerprint
changes during generation fail the build. Static version references must match
`VERSION`, staged bytes must match their generated sources, and every generated
sitemap URL must resolve to a file in that same artifact. The receipt binds the
whole output to the exact catalog, source commit and per-file hashes.

CI and the authoritative local release gate run
`node --test scripts/build_public_seo.test.mjs` whenever the generator is present.
They also run `scripts/public_gallery_startup.test.mjs` when PBE-217 integrates,
`scripts/customer_resilience.test.mjs` when PBE-219 integrates, and
`worker/paid-order-fulfillment.test.mjs` when PBE-220 integrates.
PBE-219 candidate `7710d7f56b528cec1d520341192c8fbd83e02d32` supplies its
customer helper assets and updated shells. Regenerate every static SEO entity
from those integrated shells so its loading and recovery scripts ship together.
The fulfillment test registration is conditional on the file being present
in this isolated source checkout, and mandatory in the integrated CI/release
gate once it exists. Parent should integrate the five commits recorded in
`docs/audits/pbe-220-fulfillment-integration.md` at candidate
`e9cb93970ea96504f33e442dcb23cd577c9429cc`.
The shipped catalog check uses `catalogGenerationFor(repoRoot)` when exported
by the integrated reader, compares its complete SQLite/pricing contract to the
bootstrap binding, and rejects partial integration or mixed generations.
PBE-217 candidate `d884a66a16662ba23c7eff04677a2aa0072c81fe` supplies that reader.
After applying the reviewed catalog and release version, regenerate its binding
with `node scripts/write_catalog_tsv.cjs --bootstrap-only` before staging.
Artifact staging reads the canonical database without rebuilding it.
The generator and its canonical runtime changes must be integrated together.
After integration, the build automatically requires their generated overlay.
The PBE-216 branch keeps the PBE-218 source candidate separate for parent-owned
integration. Its hook is exercised with a generator fixture and eligible-file,
unknown-entity, override and failed-generation regression cases.

## Deployment receipt and rollback

After an authorized publication, run read-only verification against every active
public origin using the receipt for the artifact actually uploaded.

```sh
npm run public:verify -- \
  --origin https://photos-by-elie.com \
  --origin https://www.photos-by-elie.com \
  --origin https://ec92009.github.io/PhotosByElie
```

The verifier requires matching deployed identity, exact customer entry-point,
bootstrap and public catalog bytes, and 403/404 for every recorded private path.
Redirects follow the site's existing domain routing. Network failures and soft
404 pages fail verification. Retain its output with the approved commit,
visible version, tested artifact receipt, CI run and deployment receipt.

Keep the preceding sanitized package and receipt for rollback. Revalidate that
package against its original source commit and reviewed Owner snapshot, then
republish its unchanged `site/` artifact through the authorized publishing job.
Repeat the same origin checks against that receipt. Local regression tests
rehearse replacement and preservation of the prior package after a failed
rebuild. The legacy full-repository artifact includes the reported exposure and
requires an explicit owner decision before it can serve as a rollback target.

## Candidate verification on November 17, 2026

- Focused artifact regressions passed 26 tests. Catalog-generation regressions
  passed four tests, including mixed SQLite/pricing generations and partial
  integration. The local HTTP fixture denies excluded paths with both GET and
  HEAD and detects a deliberately leaked timelog.
- The current standalone candidate stages 318 files, validates 385 local
  references and 26 excluded paths, decodes 5,303 public media rows and seven
  products, and syntax-checks 37 shipped scripts. The plain public catalog
  checksum stays `ba14324a33fc400d5506738c4614fe0bf3f0e11747a46cab70f4b3b41706c632`.
- Full repository checks passed 32 existing pretests, four new generation tests
  and 286 main JavaScript tests. The 489-test Python suite still fails only
  `NativeCullingParityTest.test_culling_preview_is_bounded_and_collapsible` and
  `test_window_and_preview_layout_persist_between_launches`. Both source and
  tests match the untouched baseline. The release gate preserves these failures.
- `npm run validate` confirms the generated Swift contract is current, then
  requires an absolute reviewed Owner.sqlite snapshot. No snapshot was supplied
  for this candidate. Full release eligibility remains unverified.
- GitHub REST still reports legacy publication from main at the repository
  root. Fresh anonymous HEAD probes return 200 for the three PBE-216 exposure
  paths. The old PBE-22 review JSON returned 404 on a bounded repeat probe.
- Startup, SEO and fulfillment candidates remain separate source commits for
  parent integration. Their hooks are registered. Combined generated-page
  hydration, settings/mobile checks, reviewed Owner validation, publishing-source
  adoption and deployed identity/negative-path proof remain release gates.
