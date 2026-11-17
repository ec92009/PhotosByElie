# PBE-221 Worker source reconciliation

Follow-up: independent review reproduced a refund/readiness race in this
historical reconciliation. Integrated-base fix
`513823a400cd4241327a8cc69d92499038d08dfe` adds authoritative exclusion and
regressions; see [the settlement and rollout contract](../architecture/paid-refund-settlement.md).
The earlier source-equivalence statements below describe the original candidate,
not the later functional fix or a production release.

This is a source-only candidate on accepted integration
`92e753f74b1e60b4932cf64b41aaf210451ceb7f`. The parent owns the final release
identity, combined PBE-225 integration, required release gate and any production
action. No static artifact is rebuilt or published by this reconciliation.

## Verified source and deployment evidence

The accepted handoff binds `cloud-worker.mjs`, `stripe-client.mjs`,
`wst-commerce-snapshot.mjs` and `kv-store.mjs` to source
`01cc3ef32b17b9602f52ca2f4a50b42fe109d0fa`. Local Git comparison confirms those
starting bytes. It does not independently establish current deployed bytes.

Known later source `c00ef4d538b4908c012ff6b3a0945c85ef74bdbe` contains the omitted
feature families below. The retained production-baseline receipt for that SHA
hashes landing/static assets; it is not an attestation of the entire deployed
Worker, any subsequent wrapper, current bindings or provider configuration.
Historical rollout notes are not substituted for a current Worker receipt.
Private receipts and logs stay under ignored `tmp/pbe-221-worker-evidence/`.

## Feature mapping

| Feature | Original source | Reconciliation commit |
| --- | --- | --- |
| Guarded pre-delivery refunds, webhook orchestration, mock and fulfillment guard | Public promotion `cb90fb2871228952023022ca8781c4d3049f4a9c`, original `2e9b9e479be72dfc9df948258f78f3b85fa7588b` | `4e17fb270f4979513e65b9b1f6f4f66aeaf42366` |
| Account gallery checkpoints and lifecycle filtering | `58ec9ae3f73bffe4e109575f505e0034bb36ac3a` | `904878c522de4c6d9f74a4437e3d31f18c208411` |
| Read-only exact public-preview observation | `caefcf5f18502f80f3b69f4a84bd69b25738805b` | `b2cef3bf3ce096cfdf78bd1abff95e20fbacb316` |
| Bounded registration preparation, envelope replay and transaction fencing | `90e1146b7c6518eb4182357584f7b18aaf7a982b` | `626674327e3b694a89f16046009c08271eaccd05` |
| Untouched legacy identity reconciliation and actual D1 query-limit correction | `0323e22083b7c2968849b4876c1d1333f65cda0e`, `f9ea66fddf49f23fa51426b39dbf9b79c804829a` | `59cf6897b1d0d783b3e21d5065a466cc6e2065bd` |
| Native video, current-catalog authority and opaque native identities | `04163f9e2ec89870ba8704d06c6820e4c2dc4573`, `005c6113b18c086b8c44cd57c7fdc96682a547e1`, `67429742f4b0ec35e16e8d061f896c3697c75dc3`, `ec5c6e03e26a678413aa325aa58464cd232d6be1` | `37f676db1ca8fcd112488e4b6de9537d9344a1b9` |
| Guarded publisher client/projection dependencies, including restored-database fencing | `005c6113b18c086b8c44cd57c7fdc96682a547e1`, `67429742f4b0ec35e16e8d061f896c3697c75dc3` | `1da1a1aebec12644c1e9b3b514099a5a9dd387c5` |
| Isolated Tilbury routing, historical free/letter consent, fixed USD 0.99 offer | `2b42fa1f9ffe0ad2cb48c62dd41b5af621846be1`, `7c948c03cb571d9078a49603319987567eeee06f`, `356fed3b43aa37ee6e0919208c2d38d58bf78196` | `02a059e2ca03c69073fa65d674a5dc374546d0de` |

The final gate commit follows these feature commits. It restores the custom
build gate originally introduced at `cb90fb28`, registers every new regression
in the existing npm/CI path, and adds a real combined class-entrypoint test.
Source configuration defaults derive from `1127032d`/`be75ca8c`; they are not
permission to enable a flag in production. API 1.6.2 OpenAPI and generated Swift
match the known later source (49 operations, 19 schemas). No native UI changes.

The historical runtime lock from `caefcf5f` is necessary: the accepted older
Miniflare lacks `convertV4MiniflareOptions`. The restored lock matches later
source, including Miniflare 5.20260921.0-alpha and workerd 1.20260921.1. Tilbury
also restores its exact Stripe 23.0.0 dependency, with no provider access.

## Compatibility decisions

- Preserve PBE-220's fulfillment extraction and all accepted payment/recovery,
  revocation, email, per-file and legacy-capability regressions. Append refund
  race coverage; do not replace the stronger accepted test file with old tests.
- The accepted static `catalog-sqlite.js` does not export its reader. Keep the
  required scalar decoding in the Worker strict parser, retaining the original
  traversal/schema/overflow/size guards. Browser source and artifact bytes stay
  unchanged. The existing real-sized catalog and synthetic corrupt catalogs
  are decoded in Node and actual local workerd.
- Inspect common-webhook metadata on a clone before constructing the Tilbury
  SDK client; non-Tilbury values, including malformed/scalar JSON, fall through
  with the original body intact. Keep Tilbury client errors inside its handler.
  Successful purchases, historical entitlements and access controls are retained.
- Retain the accepted generated Worker catalog instead of importing the later
  unrelated data generation. Its 5,303 identities exactly match the accepted
  public SQLite (no missing or additional IDs). Plain SQLite retains SHA-256
  `ba14324a33fc400d5506738c4614fe0bf3f0e11747a46cab70f4b3b41706c632`.
- Preserve the private `wstCommerceSnapshot()` RPC and all accepted tests. Its
  module, Stripe reader and KV runtime remain byte-identical to the accepted
  source. Only the delegation test awaits the restored async HTTP wrapper.

After reconciliation, existing Worker runtime matches `c00ef4d5` except the
two compatibility adaptations (strict-parser scalar dependency and Tilbury
namespace dispatch) and the deliberately retained generated catalog. New test
and documentation files describe source behavior only.

## Offline validation

| Check | Result |
| --- | --- |
| `npm run worker:release-check` | 272 Node tests, 55 Python tests, generated-contract check passed |
| Expanded main npm Node test command | 448 passed, no failures/skips |
| OpenAPI/Swift generation | Current, 49 operations / 19 schemas |
| Combined class entrypoint in workerd | Private RPC succeeds only through binding; HTTP RPC paths 404; unconfigured RPC blocks; Tilbury and PBE webhooks retain separate dispatch |
| Native video / public-catalog authority | 39 tests including actual local D1/R2, conditional writes, ranges, checksum, catalog drift and later denial |
| Publisher dependencies | 55 temporary-database/injected-transport Python tests |
| Accepted static surfaces | No source/assets/version/allowlist changes; catalog hash and identity parity retained |

These checks use synthetic providers and disposable stores. No credential
retrieval, live analytics, canonical database write, enrollment, payment,
refund, email, migration or deployment occurs. Parent still runs the combined
required release gate; this candidate does not replace static artifact receipts.

## PBE-225 integration surface

`cloud-worker.mjs` gains a Tilbury import and an async `fetch` wrapper. Preserve
that wrapper, `RealEstateRenderWorkflow`, and `wstCommerceSnapshot()` while
adding the child-owned funnel import/RPC. This branch does **not** implement
`wstFunnelSnapshot()` or browser `pbe_stage` events. `kv-store.mjs` is unchanged,
so any PBE-225 KV edits must retain existing commerce readers and key isolation.
`package.json` also changes to register restored regressions; retain both sets
of child tests when combining. The receiver contract was read without changes.

## Remaining parent acceptance gates

1. Bind the actual active Worker version/deployment, complete module bundle
   (including any wrapper), current flags/bindings and rollback identity to
   reviewed source. Neither the WST source receipt nor landing hashes prove
   the entire live Worker. This ambiguity cannot be resolved by local Git.
2. Verify installed migration state for additive schemas 0016/0017 and guarded
   installed publisher adoption, current enrollment/generation and exact
   public-catalog parity before source configuration is adopted. Do not replay
   migration, enrollment or flag activation from these historical sources.
3. Preserve supported Stripe checkout/refund webhook subscriptions and verify
   their signed event transitions through separately authorized acceptance.
   Local signatures do not prove current provider delivery or real refunds.
4. Combine PBE-225, retain the existing commerce RPC, assign the parent release
   identity, and run the integrated required gate. Publishing-source adoption,
   active-origin negative paths, actual deployed identity/rollback and separate
   payment/email/native-public-playback outcomes remain production receipts.
