# PBE-158 Owner session and Waste Basket train evidence

Status: source/test candidate with retained release-topology and live-acceptance
gates. This record does not assert deployment, installation, credential
enrollment, live database acceptance, cache invalidation, or ticket completion.

Base: `a6aea417a2838199c4fa61bfdfbf711f0a98c2a9`

Deployed deny-plane cycle base: `a6393947fa9a35ff574006c2fce8b914d2dd0a25`

## Train invariants

- Backstage on an enrolled Mac is the sole actionable Owner launch path.
- Direct Google browser login for `ec92009@gmail.com` can provision, list, and
  revoke Backstage device credentials only on official deployed PBE. There is
  no local/Tailscale browser bearer transfer and no refresh token; Backstage
  re-presents its Keychain device credential for each short-lived access token.
- One global, stable fixture identity drives Culling, Review, Metadata, Upload,
  Delivery, and the hosted PBE Owner lease.
- The hosted lease freezes fixture id, breadcrumb, source identity, catalog
  identity, readiness identity, device, capabilities, writer, and expiry.
- The browser receives no device credential or Worker session token. A
  single-use opaque URL-fragment handoff is exchanged for an HttpOnly,
  SameSite, session-only loopback cookie.
- `Owner.sqlite` remains the private source of truth and the shared PBB-79
  gateway remains the only normal lifecycle writer.
- X is recoverable. Restore is exact and fixture-bound. Only separately
  authorized, explicitly confirmed Empty Waste Basket creates a tombstone.
- Sidecar is obsolete as a product, authority, and launch path. Retained
  `sidecar-*` names are compatibility identifiers only.
- Backstage sends no bearer until both Backstage and Python independently
  attest the same clean tracked host tree at the exact git commit. Ignored
  root `node_modules` remains non-blocking, while native pre-launch rejects
  stray executable/import-shadow content under `scripts/` before a bootstrap
  secret exists.

## Exact-commit audit remediation

- Shannon P2: the host identity now includes a manifest-scoped tracked-tree
  digest in addition to `HEAD`. Dirty and `assume-unchanged` host changes fail
  closed in independently implemented Swift and Python checks.
- Curie P1: restore returns authoritative success if its later static projection
  fails. A new request can resolve the fixture-bound restored receipt and retry
  projection without replaying the authoritative mutation.
- Curie P2: browser session generations prevent an in-flight heartbeat from
  publishing `ready` after close.
- Curie P2: the old PBB-78 Sidecar tombstone apply path is retired. The script
  is inventory-only and `--apply` exits before reading inputs; no legacy marker
  enables a second writer.
- Curie P3: fixture refresh and selection are both locked from synchronous
  launch capture through mint/attach, with release on failure.
- Curie P3: README now states that public browser Owner is
  provisioning/list/revoke only; actionable PBE Owner is Backstage-launched.
- Curie P2 final hardening: native Backstage now rejects untracked and ignored
  Python/import-extension files, symlinks, special files, and executables in
  the `scripts/` import scope before creating the bootstrap secret. The exact
  `scripts/json.py` attack fails at launch with
  `pbe_owner_checkout_stray_import`; inherited Python configuration and local
  bytecode caches are neutralized. Python applies the same scope rule as
  defense in depth, while ignored root `node_modules` remains accepted.

## PBB-79 independent acceptance evidence

The base already contains the guarded gateway, provenance, operation, receipt,
restore, explicit-empty, and legacy-bypass controls. This train adds a second
fixture assertion inside the restore transaction, prohibits every retained
Sidecar local/cloud tombstone-family write, strips lifecycle fields from D1
editorial batches while preserving existing lifecycle state, and makes hosted
multi-photo Undo one atomic gateway batch whose history survives failure. A
post-commit projection failure is acknowledged separately and can be reconciled
through an already-restored receipt under a new request key.

Focused proof:

```bash
python3 -m unittest -v scripts.waste_basket_gateway_test
python3 -m unittest -v \
  scripts.local_server_title_review_undo_test.TitleReviewUndoTests.test_restore_acknowledges_authority_and_retries_failed_projection
```

The tests cover recoverable X, exact restore, idempotent/concurrent retry,
confirmed empty as the sole normal tombstone transition, culling/review/gallery
gateway convergence, Sidecar restore/mirror rejection, D1 editorial-batch
lifecycle preservation, atomic hosted batch restore, rejection even with a
legacy marker, transactional hosted-fixture restore, and projection failure /
acknowledgement-loss retry.

The deployed deny-plane cycle adds a source candidate for the retained blocker:
a dedicated ACCESS_DB control/projection/barrier/receipt authority, explicit
blocked-to-ready activation over a deterministic durable manifest, and a
connector-only arm/local-commit/apply/ack lifecycle. Public Worker media,
checkout, fulfillment, order, token, ZIP, and Real Estate delivery paths are
expected to deny through canonical IDs or exact R2 bindings and fail closed
when the authority is absent or unready. Browser catalog filtering is a
defense-in-depth display projection, not the security boundary. Exact focused
and broad verification evidence is recorded only after parent-side integration
and audit.

Retained release-topology blocker: the production storefront is still static
GitHub Pages and directly serves `assets/catalog/photosbyelie.sqlite` plus
generated app-context scripts such as
`assets/apple-photos/2025-2026-app-contexts.js`. A caller can fetch those
artifacts, including embedded metadata and exact object keys, without traversing
the Worker deny plane, so hiding a row in browser JavaScript cannot prove
immediate metadata/search revocation.
PBE-158/PBB-79 cannot close until the Public Web Release train either places the
catalog and app-context data behind an authoritative filtered route or publishes
a topology with no direct stale-data bypass. The release must also apply and activate the exact
ACCESS_DB migration/manifest before traffic, prove every production Worker
binding, and invalidate or version every previously cacheable denied media
response. Static brand/marketing images must be explicitly classified as
non-revocable or bound to canonical media IDs; they cannot remain an implicit
exception.

No source-only test can satisfy those deployment gates. Local
`catalog_publish_pending`, client-side filtering, and a later catalog rebuild
remain insufficient by themselves. PBB-79 and PBE-158 therefore remain
nonterminal until the deployed topology has direct-URL, stale-cache,
GET/HEAD/Range, checkout/order/download, Real Estate delivery, activation,
replay, stale-revision, duplicate, partial-batch, barrier-persistence, race,
and canonical-ID proof.

Remaining human/live gate: use an approved disposable copy of a real
`Owner.sqlite` through the signed installed Backstage build; confirm X, Put
Back, explicit Empty confirmation, tombstone audit, catalog rebuild, and
rollback/backup evidence. Do not run this against the live database as part of
source acceptance.

## PBB-80 independent acceptance evidence

`FixtureSelectionCoordinator` owns one selection and one last-used stable id.
The top sidebar hierarchy is the only chooser. Missing/archived last-used state
uses an explicit Expo fallback; otherwise selection fails closed. The current
breadcrumb uses leading truncation so the leaf remains visible. Menu rows carry
hierarchical indentation, keyboard equivalents, and accessibility labels.
Every fixture consumer reads the same coordinator, and a PBE Owner lease
freezes it until close or expiry. Launch captures that fixture before any
suspension point and disables both the chooser and refresh until attach succeeds
or the provisional lock is released.

Focused proof:

```bash
swift test --package-path native/PhotosByElieBackstage \
  --filter 'FixtureSelectionCoordinatorTests|BackstageFixtureSelectionTests'
python3 -m unittest -v scripts.native_culling_parity_test
xcodebuild -project native/PhotosByElieBackstage/PhotosByElieBackstage.xcodeproj \
  -scheme PhotosByElieBackstage -destination 'platform=macOS' build \
  CODE_SIGNING_ALLOWED=NO
```

Remaining human gate: in a signed installed app, verify narrow/wide leaf
visibility, hierarchy comprehension, full keyboard operation, VoiceOver
announcement/focus, last-used relaunch, explicit Expo fallback, and that every
listed surface changes together while an Owner session prevents drift.

## PBE-122 independent acceptance evidence

Worker tests prove official-origin browser provisioning-only authority, device
enrollment/re-authentication/revocation, absence of refresh and local OAuth
transfer routes, session mint/introspection/close, fixture and identity binding,
expiry, exact CORS allowlists, and rejection of direct Google Owner actions.
Python tests prove opaque local identities, fixture-membership revisions, random
loopback host launch with one-use bootstrap and independently checked checkout
identity, clean tracked host content (including `assume-unchanged`, untracked
`scripts/json.py`, ignored Python shadow, and executable-file adversaries),
one active in-memory lease, exact Origin/JSON CSRF checks, one-use browser
handoff, HttpOnly browser session, expiry/close, exact fixture gallery scope,
and guarded X/restore derivation. Swift tests prove the native launch rejects
those stray import-scope files before starting Python while allowing ignored
root `node_modules` and neutralized `__pycache__`. JavaScript tests prove page
boot order, fail-closed actions, stale-heartbeat rejection after close,
session-scoped transient history, absence of browser credential storage, and
narrow/desktop status styling. Swift tests independently prove checkout
attestation plus the Backstage device re-authentication and random-port
mint/attach/freeze/close transport contract.

Focused proof:

```bash
node --test worker/checkout-worker.test.mjs worker/google-oauth-auth.test.mjs \
  worker/owner-api-v1.test.mjs scripts/pbe_owner_session_web.test.mjs \
  scripts/public_owner_culling.test.mjs
python3 -m unittest -v scripts.pbe_owner_session_test
python3 -m unittest -v scripts.migrate_sidecar_tombstones_to_cloud_test
swift test --package-path native/PhotosByElieBackstage \
  --filter 'PBEOwnerHostContractTests|FixtureSelectionCoordinatorTests|BackstageFixtureSelectionTests|generatedContractAndExamples'
python3 scripts/generate_owner_swift_contract.py --check
```

Remaining external/human gate: deploy the Worker/static candidate through the
normal release, provision a real credential with the exact Google account,
enroll it into Keychain, launch the signed Backstage app against approved local
sources, and manually verify revoke, host unavailable, identity mismatch,
expiry, close, X, restore, keyboard, VoiceOver, and visual behavior. The hosted
gallery is deliberately bounded to the first 500 picked fixture items in this
candidate; accepting fixtures above that size requires an explicit pagination
decision and additional displayed-window authorization evidence.

## Safety boundary

All automated lifecycle tests use temporary synthetic SQLite databases. No
credential, Keychain item, PhotoKit/TCC grant, source photo, R2 object, live
catalog, live `Owner.sqlite`, production Worker/static asset, installation,
signing state, or ticket was changed.

## Candidate verification

The integrated deny-plane source candidate passed these local checks on
2026-08-13:

- focused deployed deny-plane/browser/local-rehearsal coverage: 113 Node tests;
- focused hosted relay, lifecycle journal, session, and local-server coverage:
  89 Python tests;
- complete `npm test`: 31/31 pretests, 221/221 Node tests, and 263/263 Python
  tests;
- full Swift package: 73 tests across four suites;
- `python3 scripts/generate_owner_swift_contract.py --check`: 38 operations
  and 12 schemas current;
- unsigned macOS Xcode build with `CODE_SIGNING_ALLOWED=NO`: succeeded; and
- `git diff --check`: clean.

The standard pretest now includes both the D1 lifecycle authority suite and the
exact non-revocable public-asset allowlist suite, so the reviewed static music
exception cannot silently broaden.

`npm run validate` remains blocked by the existing public catalog's
Owner-applied title/keyword visibility gate (it reports catalog media IDs whose
metadata is not Owner-applied). This train changed no catalog artifact,
approval row, or real Owner state and did not bypass or simulate that gate.
The Python runs also emitted existing SQLite `ResourceWarning` diagnostics from
fixture/performance and mocked-connection tests, but all 263 broad tests passed.
