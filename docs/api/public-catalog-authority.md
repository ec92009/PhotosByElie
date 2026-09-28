# Current public-catalog publisher fence

## Live rollout checkpoint — 27 September 2026, 19:40 CEST

The guarded sealed runtime is installed as Backstage 270.0/build 364; the selected
connector fallback points to that installed runtime. After the owner's explicit
approval of 869 additions, website v270.0 serves exactly 6,359 items from Owner
revision 3907, SHA256 `6b54c7e51e747edfabd13f2b24fc675bd2dc12736146695bf172a3149a4a181e`.
Supported enrollment has matching verified local/remote generation 1 for publisher
`max`, operation `0ee1ae100747f9bf2a7d34f31302b6e7d0965d9a75795bd13d6196da5c36eaec`.
Both server flags are enabled. Live Worker version is
`fd084bc0-5148-4a8d-bc41-e0eb1b79b4f8`; authority-only recovery version is
`ced5fd4f-c526-4c0c-8d20-7b853e06860e`. Existing bindings/runtime/domains are preserved.

No native MP4 was uploaded. Exact-photo readiness, hosted range/full-hash/playback
proof and daily-client/scheduler activation remain separate. Córdoba position 10
still lacks its current approval/publication identity bridge (PBE-213); do not
substitute a photo or bypass readiness. Disable video serving before any Owner
restore/runtime rollback; retain the guarded authority API for recovery. The
earlier source-only and unguarded 266.5 observations below are historical.

## Source contract and historical implementation evidence

PBE-215 / PBMSOC-9, 27 September 2026. Source and local tests only; no live
migration, enrollment, installation, deployment or catalog mutation is implied.
Owner authorization permits this narrow publisher change using existing
infrastructure. Weekly subject selection and approval are unchanged.

## Why a publisher fence

The public SQLite artifact is served by GitHub Pages with caching. Request
no-cache and unique diagnostic queries did not reliably produce Age 0. Neither
an aged artifact nor a checked-in snapshot proves that approved photos are still
current. A digest pinned forever would hide future removals.

The existing ACCESS_DB stores one current publisher marker, not a catalog copy.
The existing enrolled connector is the writer; first prepare pins its identity.
No original, preview or private source path is sent in this protocol. Existing
public-preview lifecycle/denial checks remain independently required.

## Protocol

Fixed endpoint: `https://auth.photos-by-elie.com/api/v1/public-catalog/authority`.
Existing connector bearer only; no redirects, query, cookies or browser context.
POST requires `PUBLIC_CATALOG_AUTHORITY_ENABLED = "true"`, independent of
`CAMPAIGN_VIDEO_HOST_ENABLED`. Both default false. This permits publisher
reconciliation while video delivery stays off. Authenticated GET stays
available after migration even when hosting is disabled: a restored writer must
not mistake a disabled host for absent publisher authority. GET returns the
current primary-backed marker or exact `404 public_catalog_authority_absent`.
Other failures must never be interpreted as absence.

POST accepts exactly schema `photosbyelie.publicCatalogTransition.v1`, phase,
operationId, expectedGeneration, projectionRevision and sha256 (4096-byte cap).
The operation ID is SHA256 of UTF8 `public-catalog\n<revision>\n<sha256>` with no
final newline. Revision and generation are safe integers; digest is lowercase hex.

1. Prepare before changing the authoritative local projection. It compares the
   old generation and records a new pending generation for the target revision
   and full SQLite hash. While pending, video operations fail closed.
2. The supported publisher changes/exports/deploys that same projection.
3. Verify the deployed bytes and re-read the current projection under its local
   write fence. Commit only that exact pending revision, hash and generation.
4. The server independently fetches and validates the bounded fixed public
   SQLite, hashes all bytes, then compare-and-swaps pending to verified.

Same-operation retries are idempotent; a different pending operation, stale
generation, lower/equal new revision or another publisher conflicts. A commit
replay still verifies public parity. Network uncertainty is reconciled with GET,
not a new operation. There is no reset, force, rollback or arbitrary-catalog API.
A pending remote fence after a failed local transaction is safe but requires
supported exact-operation recovery; never manually advance the marker.
Initial enrollment saves and commits the pending local guard before any remote
commit, then reacquires the Owner write lock and rechecks both identities.
Failure of the first local commit cannot leave remote verified authority;
failure of the final local commit retains a durable guard. Pending local
enrollment blocks changed projections until exact verification/recovery.

## Serving fence

Each production video eligibility check reads the primary marker, requires
verified, fetches only `https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite`,
checks the complete hash and parsed still membership, then reads primary again.
Each D1 read starts its own first-primary session. Generation, operation, hash
and publisher must remain equal. The request is bounded in bytes and duration;
the existing per-component lifecycle denial checks still apply.

Generation is included in cross-request-stage fences, so changing A to B and
back to A cannot silently pass based on a repeated digest. Unknown authority,
pending publication, stale bytes, malformed SQLite and authority drift are
failures, never a bundled-catalog or HTTP-age fallback.

## Publisher installation and activation

The Python client uses the existing private connector configuration with exact
repository binding, safe permissions, no symlinks, no redirect and bounded
responses. The supported Owner projection functions own enrollment state and
prepare/commit hooks. Un-enrolled temporary fixtures remain offline.

An actual production Owner without a local enrollment row must check current
authenticated remote authority under its local write lock before changing the
projection. Only exact typed absence permits pre-enrollment writes. Existing
pending/verified authority requires supported re-enrollment/recovery first;
auth/storage/network failure or a different 404 is never absence. This closes
whole-database restores of pre-enrollment backups without adding a service or
another local state store. An older enrolled snapshot must still satisfy the
existing remote revision/generation fences; there is no forced reset.

Before activation, prove every actual writer uses those hooks, including the
installed/sealed Backstage runtime rather than merely this source checkout.
Quiesce writers for initial supported enrollment; compare the exact current
Owner projection and deployed bytes. A stale writer could bypass the pending
fence, so source-only coverage is not enough. Deployment sequence must preserve
the old Worker version and keep hosting unavailable until these checks pass.
The staged rollout must provide the reviewed additive schema and authenticated
GET in the disabled Worker before installing the guarded production writer;
old/missing endpoints intentionally block, rather than bypassing the guard.
Before restoring Owner or rolling back any runtime, keep hosting unavailable;
afterward recheck current Owner/enrollment/remote authority and public parity
before reenabling. Never run an older unguarded writer while hosting is enabled.

Only the reviewed additive migration may be applied; preserve existing bindings,
secrets, domains and catalog hosting. No main-site DNS/proxy changes, public
originals, new service, raw Owner/D1 writes or new credential are authorized by
this implementation. Public HEAD/Range/full-byte and actual player checks remain
separate release evidence after a reviewed deployment.

## Local regression entrypoint

`npm run test:catalog-authority` runs the offline client, projection, native
publication and policy tests; it is also part of `npm test`'s pretest phase.
The Worker release check includes authority schema/CAS/primary-read and actual
local workerd/D1/R2 integration. All protocol tests use temporary databases and
synthetic credentials/transports; these commands do not enroll the real Owner.

Read-only runtime inventory at 14:42 CEST found installed Backstage 266.5 (362)
still bundles an unguarded projection writer. Its configured legacy connector
fallback also bypasses the new projection hooks. An offline disposable-database
reproduction confirmed the installed writer ignores an enrollment row. Both
paths, plus any active environment override, must be updated or retired under
the normal Backstage release process before enrollment. Replacing checkout
files alone does not meet this condition.
