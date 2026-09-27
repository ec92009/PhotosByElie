# Approved daily campaign-video hosting (PBE-215)

Source implemented and locally tested; activation is blocked, not permission to upload.
Marketing owns rendering, approval evidence and independent anonymous byte checks.
This Worker hosts only an approved portrait derivative; films are not products.

## Client contract v1

Origin: `https://auth.photos-by-elie.com`. Existing enrolled connector bearer
authentication (`OWNER_CONNECTOR_TOKENS_JSON`) only; no browser/Owner-session
fallback, cookies, CORS upload permission, redirects or credentials in URLs.
New slugs must match `native-[a-z0-9]+(?:-[a-z0-9]+)*`, maximum 120 characters.
Only that new prefix is routed, so existing static campaign films are unchanged.

- `POST /api/v1/campaign-videos/<slug>` reserves one immutable declaration.
  JSON is limited to 16 KiB by actual bytes. Same slug/queue and binding replays;
  a different binding, or using the same queue with another slug, returns 409.
- `GET /api/v1/campaign-videos/<slug>` reconciles the declaration, exact R2
  metadata and current component eligibility. It never uploads or repairs.
- `PUT /api/v1/campaign-videos/<slug>/content` accepts raw MP4, not multipart.
  Required headers: `Content-Type: video/mp4`, exact `Content-Length`,
  `X-PBE-Video-SHA256` and `X-PBE-Binding-SHA256` (the returned `bindingSha256`).
  Maximum 64 MiB; exact byte count, MP4 signature and R2 SHA-256 verification.
  Conditional creation only, never overwrite. Reconcile before retrying a
  transport failure. Only identical verified stored objects are reusable.

Declaration (all fields required; unknown fields rejected):

```json
{
  "schema": "photosbyelie.campaignVideoBinding.v1",
  "queueId": "q-example",
  "selectionSha256": "<64 lowercase hex>",
  "approvalReceipt": "<existing owner approval receipt>",
  "sourceManifestSha256": "<64 lowercase hex>",
  "validationSha256": "<64 lowercase hex>",
  "approvedPhotoCount": 12,
  "video": {
    "sha256": "<64 lowercase hex>",
    "size": 23719645,
    "contentType": "video/mp4",
    "width": 1080,
    "height": 1920,
    "durationMilliseconds": 30000
  },
  "components": [
    {
      "assetId": "<weekly-selection asset ID>",
      "canonicalAssetId": "<current lifecycle canonical asset ID>",
      "canonicalMediaId": "<current lifecycle canonical media ID>",
      "sourceSha256": "<exact rendered original SHA-256>"
    }
  ]
}
```

Exactly `approvedPhotoCount` unique components in approved order; valid count
1–12, duration 25000–35000 milliseconds. Below 12 requires
`approvedPhotoCountException: {"count": <same count>, "receipt": <approvalReceipt>}`.
This optional field, when present for any count, must match both values exactly.
All numbers are integers to avoid cross-language floating-point serialization.
`approvalReceipt` accepts an existing relative evidence path or user-message
reference: 1–512 characters, no leading/trailing whitespace, control characters,
URL scheme or protocol-relative URL. It is preserved exactly, not replaced or
normalized. Exception receipt must be exactly the same string.
The example shows one component solely to describe its shape. No original
paths, URLs, private R2 keys, media bytes or arbitrary metadata are accepted in
the declaration. Hashes bind the connector's existing approval/source/encoded
validation evidence; the Worker does not invent approval or decode the film.

`bindingSha256 = SHA256(UTF8(canonical JSON of the declaration))`: recursively
sort object keys, use compact separators, emit Unicode as UTF-8 (`ensure_ascii=False`
in Python), preserve array order, and perform no implicit value normalization.
The slug is not included. Python clients must serialize number fields as ints.

Responses use `schema: photosbyelie.campaignVideoReceipt.v1`, `ok`, `slug`,
`queueId`, `bindingSha256`, `videoSha256`, `size`, `contentType`, `publicUrl`,
`portraitMp4`, `state`, `objectState`, `createdAt`, `checkedAt`, and when stored `uploadedAt`
and `etag`. `reserved` always means `objectState: absent` after fresh R2 HEAD;
`ready` means `objectState: verified` with matching digest/type/size/binding.
A receipt is not independent live verification. Missing declaration 404;
an object conflict is 409, never `absent`; denied component 410;
unavailable authority/storage/config 503. All replies are no-store.
Catalog revision change within an operation is 409 `campaign_video_catalog_changed`;
stale/unavailable catalog is 503, never fallback to the bundled catalog.

Public `GET`/`HEAD` accepts only the existing download-domain endpoint
`https://download.photos-by-elie.com/assets/campaign-media/<slug>.mp4`, with
single byte-range support. Both `publicUrl` and `portraitMp4` contain that same
absolute URL; `<slug>` includes the required `native-` prefix. The API remains
on `https://auth.photos-by-elie.com` with its existing native connector auth.
The player accepts exactly this HTTPS hostname/path and a valid native slug
of at most 120 characters, rejecting ports (including explicit 443), credentials,
query, fragment, encoded characters and traversal before URL normalization.
Existing `./assets/campaign-media/<legacy-slug>.mp4` films remain unchanged.
All approved stills must remain current public catalog photos and pass the existing
exact public-preview lifecycle verifier. No cached successful response, fallback
to an original, alias endpoint or stale receipt may bypass this decision.

## Current catalog reader / publisher authority

The earlier `deployed-worker.mjs` catalog parameter was a generated deploy-time
snapshot. That hosting dependency is removed; checkout's existing catalog is
unchanged. Hosting fetches only the fixed HTTPS
`https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite` on every check.
No query, redirect, caller-provided URL, alternate origin, positive cache or
catalog-copy database is used. `cache: no-store`, request no-cache and
identity encoding are enforced; only HTTP 200 and SQLite/octet-stream MIME pass.

Actual bytes are capped at 16 MiB with a 10-second fetch timeout. Exact declared
length when supplied, UTF-8 rollback-journal SQLite header and the required
table/column layout are required. The existing pure-JS browser
reader's scalar primitives are exported and reused with hosting-only guards:
bounded pages/rows/records, cycle/overflow validation and exact public camera
still membership with both JPEG preview rows. Unneeded metadata is not decoded.
No sql.js/WASM is vendored in either checkout; no new package/runtime was added.

The complete catalog-byte SHA-256 and publisher-authority generation are the
request's revision fence. Each check reads the current primary D1 publisher
marker before and after fetching the fixed public bytes. Missing, pending,
malformed or changing authority fails closed; the complete byte hash must match
the current verified marker. An older HTTP cache entry is acceptable only if its
bytes exactly match that independently current authority, never based on Age or
a successful historical receipt. Every primary read starts a new first-primary
session. Fresh authority reads and D1 denial checks bracket serving/reservation/reconciliation, precede upload,
and run at actual input EOF before releasing the final MP4 byte to R2. Changed
catalog bytes are 409 even if that particular component remains present.
Unknown or removed members fail closed; no new registration is performed.

Read-only live checks on 27 September: the artifact is 4,333,568 bytes, MIME
octet-stream, ETag `"6ab6b479-422000"`, SHA-256
`713c423f43a13363f233142ff5fe390d91e4fcc70d1be6aa8b28edfa7211dfb7`.
HEAD returned Age 0 at 10:49 UTC, but later GETs with no-cache/no-store (also
Pragma and cache:no-cache) returned Age 37 and 109 with origin
`Cache-Control: max-age=600`. At 11:09:37 UTC a fresh GET parsed successfully;
the strict reader's next GET already had Age 1 and correctly returned 503.

A bounded authorized nonce experiment at 11:10:17–11:10:44 UTC used three
unique `?_pbe_catalog_read=<generated UUID>` queries on the same fixed origin
and path, with the existing no-cache/no-store headers. All three returned the
exact requested URL, fresh Date and HTTP 200, but Age **40, 66 and 67**, not 0.
The two complete diagnostic bodies matched the above length/hash and passed
the strict SQLite parser. The first attempt stopped at the failed Age check.
This experiment did **not** establish freshness; nonce requests were not added
to production code and the freshness gate was not weakened.

The owner subsequently authorized the small supported catalog-publisher change.
The new [publisher-authority contract](public-catalog-authority.md) closes that
HTTP-age dependency only after all actual writers have the prepare-before-write
hooks installed and supported enrollment is verified. Source implementation and
local tests are not deployment evidence. The standalone HTTP-only diagnostic
reader retains the strict Date/Age checks above; production never falls back to it.

## Configuration / activation boundary

### Backend-only staging release, 27 September

The staging branch `codex/pbe-guarded-backend-release-20260927` retains the
reviewed backend/publisher guards but restores `campaign-video.js` and its tests
to the existing `origin/main` player. The native-download player allowlist remains
on `codex/pbe-native-video-hosting-20260927` for the later reviewed player release.
The shared SQLite decoder export remains because the Worker uses it; existing
browser decoding behavior is unchanged. Do not infer live player support from
the complete target contract described above.

The fresh migration inventory also contains unrelated
`0015_google_oauth_transactions.sql`. Stage only unchanged
`0016_campaign_videos.sql` through a temporary migration-only Wrangler config
with the same database ID and default migration ledger, and a directory
containing only that file. Its SHA-256 is
`f6eccc2dd1bc9afda687e5827832f3c2242a9ecdb71ab3e9ba43da838483c865`.
Require a one-file pending plan, then verify the full config still lists 0015
pending and no 0016. Never deploy the Worker with that migration-only config.
Both feature flags stay false during this staging release. This paragraph is
release procedure, not evidence that live staging succeeded.

Reuse the existing Worker, `PRIVATE_MEDIA` (`photosbyelie-private`), `ACCESS_DB`,
and connector authentication. One additive D1 migration stores immutable
declarations and a singleton publication fence separately from Owner state.
The hosting handler never writes catalog/Owner.sqlite state. Supported publisher
hooks manage the local enrollment receipt; no raw Owner edits are permitted.

No new credential or encryption secret. Only
`campaign-videos/v1/<bindingSha256>.mp4` objects in that private bucket are
accessible through the new handler; callers cannot choose an object key and no
original path is returned. Existing public-bucket r2.dev access cannot bypass
the lifecycle gate. The initially considered SSE-C API is documented and typed
but unnecessary with the approved existing private binding.

The feature is fail-closed unless explicitly enabled. The owner selected the
existing download domain; catalog authority and deployed configuration readiness
remain main's work. This source slice performs no deployment, migration,
credential installation or object upload.

## Live inventory, 27 September 2026 (read-only)

- Existing Worker: `photosbyelie-checkout-mock`; current deployment
  `b5188bed-05b4-4e66-a822-5ab2286b6851`, 100% version
  `22ca2c66-a88f-4ad9-83fe-d849a89b4046`, deployed 25 September 17:46:41 UTC.
  The name contains `mock` but the deployed Worker also has live Stripe secrets;
  do not replace/remove existing secrets or infer mock-only production.
- Live and source compatibility date `2026-07-10`, flag `nodejs_compat`.
  Every existing plain-text variable matches source; only the new disabled
  `CAMPAIGN_VIDEO_HOST_ENABLED` variable is absent live. Secret values were not
  read or output. Do not infer route inventory from these matching bindings.
  Live custom domains: `auth.photos-by-elie.com` and
  `download.photos-by-elie.com`. Same existing D1 database
  `photosbyelie-access` (`f93ae9cc-ffd4-4e2b-8dbd-bc7f840cb61b`).
- Live `PRIVATE_MEDIA` and `DELIVERY_MEDIA` bind `photosbyelie-private`.
  Its managed r2.dev is **disabled**, custom-domain list empty. The new code
  uses only `PRIVATE_MEDIA`; `PUBLIC_MEDIA` remains untouched.
- `photos-by-elie.com` DNS resolves directly to GitHub Pages
  `185.199.108.153` through `185.199.111.153`, not Cloudflare proxy addresses.
  The discarded apex path-route proposal would have required proxying that
  record. Existing token received HTTP 403 from both zone routes and apex
  DNS-record list; this slice does not request or change those permissions.
  **Whole-apex proxying is outside the owner-approved narrow route grant.**
- Account `26aa9df8b20960f20cf0e8dba5cb2f88`; zone
  `cd07f8b01da5305a0dd47bac2a7bd549`. No DNS, route, policy or bucket changes made.

## Owner-selected public host (27 September; source only)

The existing `download.photos-by-elie.com` Worker custom domain is selected.
`worker/campaign-video-hosting.mjs` now returns identical absolute download URLs
in both receipt fields. `campaign-video.js` allows only their exact native-video
shape alongside the unchanged legacy relative-film contract. Matching player
and hosting tests, OpenAPI and generated Swift contract accompany this change.
The commented apex route proposal is removed from `wrangler.toml`; existing
custom domains and `CAMPAIGN_VIDEO_HOST_ENABLED = "false"` remain unchanged.
The later publisher integration adds independent
`PUBLIC_CATALOG_AUTHORITY_ENABLED = "false"`. Neither flag was enabled live.
Authenticated authority GET remains available after schema deployment while
both flags are false; authority POST and public video serving have separate gates.

No DNS/proxy changes, new services, account changes or new credentials are needed
for this selected host. Whole-apex proxying remains outside the grant. Marketing
must accept both absolute receipt fields; main owns that client seam, current
catalog authority, activation readiness and later live verification.

This local slice does not change `campaign.html`, `social.html` or release/cache
versions. Their normal reviewed version update belongs to the eventual player
release. Independent cross-origin playback and HTTPS HEAD/Range/full-byte checks
remain release verification, not evidence supplied by a local test or receipt.

## Deployment readiness (main controller only; not executed)

1. Coordinate the existing PBB-191 runtime release and inventory all installed,
   fallback and override writers under the catalog-authority contract. The patch
   must not be activated on source tests alone. Fresh-read the
   deployment/version, bindings/vars/secrets **names** and existing custom domains;
   preserve the version ID as rollback. No apex route or proxy change is in scope.
2. Review the isolated source and its tests. Run `npm ci --ignore-scripts`,
   `npm run test:campaign-video`, `npm run test:campaign-video-hosting`,
   `npm run test:catalog-authority`,
   `python3 scripts/generate_owner_swift_contract.py --check`, then
   `./node_modules/.bin/wrangler deploy --dry-run --keep-vars`.
3. Run `./node_modules/.bin/wrangler d1 migrations list photosbyelie-access --remote`.
   Apply with `./node_modules/.bin/wrangler d1 migrations apply photosbyelie-access --remote`
   **only if** the reviewed pending set is exactly `0016_campaign_videos.sql`.
   Unexpected pending migrations need reconciliation, not a blanket apply.
4. With deployment authority, stage the reviewed Worker with both feature flags
   false. Verify authenticated authority GET (typed absence or exact existing
   marker), rejected mutations and unavailable video delivery. Preserve all
   existing custom domains/bindings; no apex route or DNS change.
5. Deploy each reviewed configuration using
   `./node_modules/.bin/wrangler deploy --keep-vars --message "PBE-215 approved derivative hosting <commit>"`.
   Keep the existing two custom domains, all bindings, and current production
   vars/secrets. Capture the returned new version/deployment IDs.
6. Install/verify the guarded current writer and retire/update enabled legacy
   paths through the coordinated native release. While video serving stays
   false, enable only `PUBLIC_CATALOG_AUTHORITY_ENABLED`; quiesce writers and
   complete supported enrollment/recovery with exact current projection and
   deployed full-byte parity. Never enable video temporarily just to perform
   a catalog transition. Missing/older restored state must reconcile or block.
7. Only after installed-writer and current authority proof, enable
   `CAMPAIGN_VIDEO_HOST_ENABLED` in a separately verified configuration. Recheck
   auth rejection, 404 exact absent slug, public-site and commerce health,
   and existing static film URLs. Only after exact photo readiness/approval is
   available may main reserve/upload a package. Independently verify anonymous
   HTTPS HEAD, Range, MIME, length, full SHA-256 and encoded playback. A local
   test or R2 receipt does not complete PBE publication/campaign integration.

Rollback: disable `CAMPAIGN_VIDEO_HOST_ENABLED` first. Prefer retaining current
guarded publisher APIs so supported catalog recovery can run while serving is
off. Do not roll back a writer or restore Owner while serving is enabled. If a
full Worker rollback is required, deploy the saved prior Worker version with
`./node_modules/.bin/wrangler rollback 22ca2c66-a88f-4ad9-83fe-d849a89b4046 --message "PBE-215 rollback"`
after fresh confirmation that it is still the correct previous version. The
selected contract adds no route or DNS record, so no DNS rollback is needed.
Do not drop the additive declaration table or delete
objects: retained declarations plus private objects allow safe reconciliation.
Rollback must not disable/rewrite existing Owner, media, commerce or DNS data.

## Local verification

Node 26.8.1; lockfile-installed Wrangler 4.137.0 / workerd 1.20260921.1.
Current published Workers types 5.20260927.1 inspected; generated environment
types also verified from the actual Wrangler config. The existing Owner OpenAPI
and generated Swift operation manifest are updated together to API 1.5.0; no
native app build or release was made. The HTTP API major remains v1.

- Original 16 focused tests: immutable reservation/replay, approved count exceptions,
  authentication/origin/path boundaries, real lifecycle later denial, absence vs
  conflicts, lost PUT recovery, concurrent conditional PUTs, length/hash/MP4
  validation, original exclusion, and full/HEAD/single-range delivery.
- The runtime test uses actual **local** workerd, D1, R2 and FixedLengthStream;
  no cloud bindings or real photo objects. The final upload byte is withheld
  until source EOF to prevent a fixed-length consumer committing a prefix.
- Ten catalog tests (26 focused total) add strict SQLite and HTTP bounds,
  additions/removals without redeploy, no stale-cache fallback, catalog/D1 drift
  before commit, and the actual production entrypoint in local workerd with real
  D1/R2 and its outbound fetch intercepted by a synthetic catalog origin. The
  real-sized checked-in catalog is also decoded read-only inside workerd. No WASM.
  Expiry during slow eligibility checks prevents even a reservation write.
- Final combined lifecycle/checkout/commerce/public-origin/API/hosting regression:
  **184 passed**. The final Worker release check passed **146 tests**. The final
  targeted rerun passed **26 tests, zero failures**. Canonical generated contract
  check passed (46 operations, 17 schemas); generated Swift typecheck passed.
- `wrangler deploy --dry-run --keep-vars` succeeded (no upload/deployment).
  Live HTTPS routing, migrations and independent public byte/playback proof are
  still pending. Source evidence is not a live hosting receipt.

### Integrated publisher/host verification — 14:44 CEST

The preceding counts describe the earlier pre-publisher-authority snapshot.
After the owner-selected download host, publisher protocol and independent review
fixes, main reran **156 Worker release tests**, **8 player tests**, and **48
Python client/projection/publication/policy tests**, all passing. The generated
OpenAPI/Swift check now covers **48 operations and 19 schemas**; Swift typecheck
and diff whitespace checks pass. A fresh Wrangler dry-run rebuilt the same
156-test release suite and compiled successfully without uploading.

Independent review reproduced a stale lifecycle-session replica serving after
primary denial. The new hosting-only fresh-primary query wrapper now rejects
that case. Initial catalog enrollment also commits its local pending guard
before remote verification; failure/race/lost-response tests cover both sides.
Malformed array-valued hashes return 400 without a database write.

Installed Backstage and the configured legacy connector still lack these hooks;
see [publisher rollout requirements](public-catalog-authority.md). Source tests
do not clear that installed-runtime dependency or the separate exact-photo
provenance blocker. The feature remains disabled.

## Source handoff

Worker handoff was uncommitted in `/tmp/pbe-native-video.3Cj4B8`, branch
`codex/pbe-native-video-hosting-20260927`, base `9d0cd76c`. Controller owns any
later local snapshot; its exact commit is recorded on PBE-215 and the Marketing
activation receipt. No push or live release is part of this source handoff.

Controller review independently reran the 146-test Worker release check and
generated-contract check at 13:13 CEST. Both passed. This does not clear the
catalog freshness dependency or authorize a host/DNS change. Three bounded
nonce-read attempts also retained nonzero Age, so no nonce workaround was added.

- New runtime: `worker/campaign-video-contract.mjs`, `campaign-video-store.mjs`,
  `campaign-video-stream.mjs`, `campaign-video-hosting.mjs`,
  `campaign-video-catalog.mjs`, `campaign-video-sqlite.mjs`.
- New tests: `worker/campaign-video-hosting.test.mjs`,
  `campaign-video-runtime.test.mjs`, `campaign-video-test-support.mjs`,
  `campaign-video-catalog.test.mjs`, `campaign-video-catalog-runtime.test.mjs`,
  `campaign-video-catalog-test-support.mjs`.
- Additive schema: `migrations/0016_campaign_videos.sql`.
- Existing entry/config integration: `worker/deployed-worker.mjs`,
  `wrangler.toml`, `package.json`; `catalog-sqlite.js` adds only the reusable
  scalar-reader class export, leaving existing browser decoding behavior intact.
- Documentation/types: this document, `docs/api/owner-v1.openapi.yaml`, generated
  `native/PhotosByElieBackstage/Sources/OwnerCore/Generated/OwnerContract.generated.swift`.

No canonical PBE checkout, FIFO, manifest, campaign JSON, real catalog,
Owner.sqlite, credentials, DNS, bucket policy or provider receipt was changed.
The companion Marketing client accepts the exact same download URL in both
receipt fields. Córdoba remains held. Main owns deployment and live verification.
