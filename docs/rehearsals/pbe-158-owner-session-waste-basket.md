# PBE-158 Owner session and Waste Basket train evidence

Status: source/test candidate only. This record does not assert deployment,
installation, credential enrollment, live database acceptance, or ticket
completion.

Base: `a6aea417a2838199c4fa61bfdfbf711f0a98c2a9`

## Train invariants

- Backstage on an enrolled Mac is the sole actionable Owner launch path.
- Direct Google browser login for `ec92009@gmail.com` can provision, list, and
  revoke Backstage device credentials only.
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

## PBB-79 independent acceptance evidence

The base already contains the guarded gateway, provenance, operation, receipt,
restore, explicit-empty, and legacy-bypass controls. This train adds a second
fixture assertion inside the restore transaction so a hosted PBE request cannot
restore a recoverable row from another frozen fixture.

Focused proof:

```bash
python3 -m unittest -v scripts.waste_basket_gateway_test
```

The tests cover recoverable X, exact restore, idempotent/concurrent retry,
confirmed empty as the sole normal tombstone transition, culling/review/gallery
gateway convergence, audited legacy markers, and transactional hosted-fixture
restore.

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
freezes it until close or expiry.

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

Worker tests prove browser provisioning-only authority, device enrollment,
refresh/revocation, session mint/introspection/close, fixture and identity
binding, expiry, and rejection of direct Google Owner actions. Python tests
prove opaque local identities, one active in-memory lease, one-use browser
handoff, HttpOnly browser session, expiry/close, exact fixture gallery scope,
and guarded X/restore derivation. JavaScript tests prove page boot order,
fail-closed actions, session-scoped transient history, absence of browser
credential storage, and narrow/desktop status styling. Swift tests prove the
Backstage mint/attach/freeze/close transport contract.

Focused proof:

```bash
node --test worker/checkout-worker.test.mjs worker/google-oauth-auth.test.mjs \
  worker/owner-api-v1.test.mjs scripts/pbe_owner_session_web.test.mjs \
  scripts/public_owner_culling.test.mjs
python3 -m unittest -v scripts.pbe_owner_session_test
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
