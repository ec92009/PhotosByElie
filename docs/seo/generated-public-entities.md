# Static public entity metadata (PBE-218)

GitHub Pages serves the same `photo.html` bytes for every query string. PBE-18
(`e9b99095`) improves browser metadata, but cannot give a script-free share
fetcher a distinct response for `photo.html?id=…`. This generator adds real HTML
files at `/photo--<media-id>.html` and `/gallery--<collection-key>.html`, keeping
the current framework, query links and customer page shells.

## Artifact integration contract (PBE-216 / PBE-217)

Run from the candidate checkout, **after** validating the exact public catalog
and after applying the integration release identity to the existing shells:

```sh
node scripts/build_public_seo.mjs
node --test scripts/build_public_seo.test.mjs
```

The one generated output directory is `tmp/public-seo/`. The command supports
`--repo-root`, `--catalog` and `--output` for a prepared artifact. It never opens
Owner.sqlite or reads Owner JSON and does not invoke the catalog generator. Its
only data inputs are the read-only plain public SQLite catalog and existing
public storefront policy/media config. Python 3 and Node are already repository
requirements; no new dependency is required. Set `PYTHON` to a declared local
Python executable when needed.

Overlay the generated `photo--*.html`, `gallery--*.html`, `sitemap.xml` and
`robots.txt` at the **root of a fresh public staging artifact**, alongside the
existing allowlisted customer assets. These HTML files are root-level on purpose:
existing relative navigation, authentication return paths and versioned links
continue to work without a base tag, redirects or host routing. Do not publish
the `.pbe-seo-generated` ownership marker, source scripts, docs or private data.
Add the generated filename patterns explicitly to PBE-216's artifact allowlist.
Run the focused test command above in that release pipeline; this child does not
edit the other child's build/CI files or package script list.

PBE-217's catalog contract is unchanged: tables `collections`, `media_items`,
`media_assets`, `asset_types`, `source_origins` and `media_types`. Read only
public-scoped camera photos with a positive-dimension `still_900` asset. Apply
all retired collection/origin/media-type policy exclusions; AI, unknown scopes,
unknown origins, videos and missing previews are excluded. Public eligibility
and lifecycle removal must already have been validated when projecting this
catalog. This generator cannot infer current Owner decisions from a stale public
snapshot. It reports the source SHA-256 and refuses a changing catalog, missing
policy, non-checkpointed WAL, empty eligible set or unsafe identifier.

**Loader integration note:** generated photos identify themselves with
`document.body.dataset.photoId`; query `id` still takes precedence in
`photo-detail.js`. Generated collections use the existing `data-gallery`
contract. PBE-217's requested-detail optimization should recognize this same body
attribute as an alternative to `/photo.html?id=…` when choosing visibility
candidates. The baseline loader remains fail-closed on these routes but checks
the whole public catalog. No loader/generator file owned by PBE-217 is edited
here. Also include generated photo routes in any route-based commerce analytics
normalization when that separate work is undertaken.

## Metadata and browser behavior

The generator evaluates only PBE-18's SEO helper block from `photos.js` in an
isolated VM, reusing its text cleanup and JSON-LD constructors. A missing helper
boundary fails generation. Existing browser metadata also uses these helpers;
eligible photo/collection canonical URLs now point to the generated HTML files.
Utility and authenticated shared galleries keep the existing query URLs.

Each generated page has its entity title, description, canonical, Open Graph,
Twitter image and JSON-LD in the raw HTTP HTML. A no-JavaScript section contains
the same public identity, description and ordinary query links; collection pages
also link every generated photo. Settings, language controls, version badge and
all lifecycle-gated interactive scripts are copied from the existing shells.
No new direct image element, purchase state, price, original URL, private path,
GPS value or Owner workflow field is serialized. Share images use only the
existing Worker-mediated `_900.jpg` preview route, whose runtime denial remains
authoritative. Static text/metadata naturally remains a publication snapshot.

The tracked root sitemap lists only existing generic public pages. The generated
artifact sitemap replaces it with those pages and the eligible entity URLs.
It has no invented modification dates, old GitHub origin, AI collection or
private/commerce-session URLs. Do not publish only the canonical runtime changes
without the generated overlay: all entity routes must ship in the same artifact.

## Verification and rollback

The focused tests exercise script-free HTTP responses, canonical/share/schema
identity, HTML/JSON escaping, private/unknown/retired exclusions, query fallback,
read-only input, deterministic output, stale-page cleanup and failed-build
preservation. Existing lifecycle authority tests remain required. Full artifact
checks must confirm every sitemap URL resolves in that exact staged release and
generated pages hydrate correctly with the integrated loader.

Regenerate into a fresh stage for every public catalog release or removal so an
old generated file cannot survive through a copy overlay. The generator replaces
only its marked output directory. Static hosts cannot revoke previously fetched
metadata or third-party share caches; Worker media denial continues independently.
Before publication, verify the current settings treatment and About/version-pill
identity from the integration release, mobile layout, and representative raw
HTTP/share previews on the actual approved host. No production result is claimed
by local fixture HTTP tests.

Rollback by restoring the previous tested public artifact (including its complete
route set). To remove this approach entirely, revert the PBE-218 runtime hooks,
remove the `photo--*.html` / `gallery--*.html` outputs from a fresh artifact and
restore the conservative custom-domain sitemap. Existing query links continue
to work. No DNS, Worker, framework, canonical database or provider change is
needed. Parent owns ticket state, shared timelog, final release identity and
publication; this is a source candidate only.

## Candidate check receipt — 2026-11-15

- Public catalog input SHA-256:
  `ba14324a33fc400d5506738c4614fe0bf3f0e11747a46cab70f4b3b41706c632`.
  The same checksum was verified after generation and repository tests.
- Real catalog build: 5,303 photo pages, seven gallery pages, 5,316 sitemap
  URLs. Every URL maps to an existing staged/source file. All 5,310 entity
  canonicals and JSON-LD URLs match their sitemap identity. The ignored overlay
  is approximately 56 MB; generated pages are not committed source files.
- Focused command: `node --test scripts/build_public_seo.test.mjs
  worker/non-revocable-public-assets.test.mjs worker/lifecycle-deny-store.test.mjs
  scripts/public_worker_origin_policy.test.mjs` — 35 passed, zero failed.
  Fixture HTTP checks fetch generated gallery/photo HTML without running JS.
- `npm test` after `npm ci --ignore-scripts`: 32 pretest and 286 main Node tests
  passed. Python ran 489 tests: 487 passed, two failed in unchanged
  `scripts.native_culling_parity_test.NativeCullingParityTest` methods
  `test_culling_preview_is_bounded_and_collapsible` and
  `test_window_and_preview_layout_persist_between_launches`. Both assert legacy
  native preference markers in `BackstageViewModel.swift`; the test and native
  source are unchanged from the candidate's base commit. These failures are
  outside PBE-218 ownership and were not repaired here.
- `npm run validate`: Swift contract check passed (41 operations, 14 schemas);
  publish validation then refused to continue without an absolute reviewed
  Owner.sqlite snapshot via `--owner-db` / `PHOTOSBYELIE_OWNER_DB`. No substitute
  Owner authority was created or inferred.
- Changed JS/Python syntax checks and `git diff --check` passed. Browser
  hydration, mobile/settings visual verification and live social preview
  verification remain integration/release checks, not established by these
  script-free HTTP fixture tests. Existing shell version is inherited; parent
  must assign the integrated release identity before distributable staging.
