# Approved daily campaign-video hosting (PBE-215)

This document describes reconciled source; it does not attest to deployed state.
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

## Source integration and release boundary

PBE-221 restores the Worker contracts from `c00ef4d538b4908c012ff6b3a0945c85ef74bdbe`.
The original feature sources are `04163f9e`, `005c6113`, `67429742` and
`ec5c6e03`; configuration history includes `1127032d` and `be75ca8c`.
These are verified Git sources, not fresh deployment receipts.

The accepted static decoder does not export its internal reader. Worker-only
`campaign-video-sqlite.mjs` retains the same scalar semantics directly, with the
historical strict traversal/schema/size guards. No browser decoder bytes change.

The runtime requires explicit true values for `CAMPAIGN_VIDEO_HOST_ENABLED`
and, independently, `PUBLIC_CATALOG_AUTHORITY_ENABLED` for authority mutations.
Authenticated authority GET remains available with serving disabled. Historical
source configuration has both flags enabled; adopting that configuration still
requires verified deployed authority and guarded installed publisher state.

Additive migration `0016_campaign_videos.sql` supplies declaration and publisher
fence tables. Its presence here is not proof of production migration. Preserve
current bindings, domains, configuration and rollback identity during any later
parent-authorized release. Never replay migration/enrollment from source alone.
Exact eligible-package readiness, independent public HEAD/Range/full-byte hash
and playback proof remain separate acceptance gates. This reconciliation uploads
no MP4 and changes no Owner database, catalog, FIFO, campaign or provider state.
