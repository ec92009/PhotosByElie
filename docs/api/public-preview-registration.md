# Exact public-preview registration preparation (PBE-214)

The existing connector-only `POST /api/v1/lifecycle/reconcile` accepts a read-only
preparation mode. This supplies the manifest envelope required by the existing
guarded writer without direct D1 inspection or exporting private bindings.

## Prepare, persist, apply, verify

1. The connector proves current local approval, source revision, public fixture
   policy and exact checksum-verified R2 receipts. Preparation is not that proof.
2. Query current exact public access first. Reuse an already correct registration;
   stop on a conflicting identity, denied photo, armed barrier or owned key.
3. Send `prepareOnly: true`, a stable `repairId` bound to the run/source batch,
   and 1–20 `items`, each with explicit `canonicalAssetId`, `canonicalMediaId`
   and exactly these two `bindings`:
   - `public`, `expo/{canonicalMediaId}_900.jpg`
   - `public`, `expo/{canonicalMediaId}_1800.jpg`
4. Persist the returned `envelope` before any apply attempt. It contains exact
   previous/resulting activation digests and counts plus the canonical seed.
5. Recheck local authority and submit that envelope unchanged to the same route,
   omitting `prepareOnly` (or setting it to false). The server supplies `actorId`
   from the authenticated connector; caller-supplied actors are ignored.
6. If the response is lost, prepare again with the **same** repair ID and exact
   members. An already applied repair returns its original envelope, even if
   unrelated registrations have since advanced the global manifest. Replaying
   this envelope returns its durable receipt without another write.
7. A stale, unapplied plan can be prepared again only after reconciling cloud and
   current local state. Do not mint new identities or overwrite a conflict.
8. Separately finish catalog deployment and exact public-byte verification.
   Neither a prepared envelope nor an old applied receipt is a Live grant.

This API does not register originals or private previews, repair aliases, approve
photos, upload objects, deploy catalogs, or make campaigns. The existing explicit
apply writer is unchanged apart from making a lost transaction fence abort the
entire batch. Identity conflicts require supported reconciliation, not a second
identity for the same asset.

## Bounds and access

- Only existing authenticated connector credentials may call reconciliation;
  native Owner sessions and public browser sessions are not sufficient.
- Preparation: 64 KiB UTF-8 JSON, 20 identities, 40 exact public bindings,
  canonical media IDs of 1–128 ASCII letters/digits/dot/underscore/hyphen,
  canonical asset IDs of at most 256 characters, stable repair IDs of 1–128
  ASCII letters/digits/dot/underscore/hyphen.
- Existing apply envelopes: 1 MiB, 100 identities, 400 bindings. Streamed
  requests are counted by actual bytes, not caller Content-Length.
- Successful responses send `Cache-Control: no-store` and
  `CDN-Cache-Control: no-store`; error responses are private/no-store.
- No unrelated object keys, original paths or private bindings are returned.
- An applied replay after a later denial remains denied; verify current access.

## Verification

Store tests exercise zero-write preparation, private/invalid/oversized inputs,
key and identity conflicts, denied photos, lost-response recovery, stale plans,
later-denial replay and all-or-nothing rollback when the authority fence changes.
Route tests cover unauthenticated/Owner rejection, authenticated actor binding,
cache headers, byte limits, Unicode byte counts and oversized streams with a
false Content-Length. The generated Owner contract documents the API as v1.4.0.

Native resumable orchestration is separate PBB-191 work. Historical repair is
PBE-213; whole-subject marketing readiness is PBM-56. Their completion must not
be inferred from the availability of this supporting API.
