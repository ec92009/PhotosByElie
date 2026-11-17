# PBE-220 fulfillment integration receipt

Source-only implementation, 2026-11-17, in prepared isolated branch
`t3/paid-order-fulfillment`, starting from
`618f9da211810a09fbc0aed88f6283ec0ba536aa`. This is a private engineering
receipt, not a public storefront artifact or production acceptance receipt.

## Reconciliation and exact prerequisites

Read-only YouTrack REST calls returned HTTP 200 for PBE-220 (`3-1200`, Active)
and PBE-182 (`3-915`, Done). PBE-182's completion comment explicitly describes
a source-only extraction at `49644606426f91bdff69109a7f807107df887b2f`.
Its previous test/deployment statements are historical receipts, not fresh
validation of this branch. No ticket, comment, timelog or telemetry write was
made by this implementation child.

Only the following patches were cherry-picked, with `-x` provenance:

| Original commit | Isolated branch commit | Reason |
| --- | --- | --- |
| `0bd9b026fc4469a00440116900b7178fbd5951ca` | `439ac64802a8478e4603a1a66d6c0fdbc591d829` | Await Cloudflare Images output before reading its response; make the integration double asynchronous. |
| `dfff2cb0d4c00ce8a86239a708318dbb04d88f37` | `397bc77a84e082aac1aee39d74952f4232c1b576` | Clear old delivery failure on successful recovery, with recovery coverage and guarded support instructions. |
| `524af00c95fb8d072613536ae37aeafddaff6b23` | `4dcd766ba3d402d66c80d61f82bfd75a7c0a1400` | Suppress obsolete delivery errors in the public projection of ready orders. |
| `49644606426f91bdff69109a7f807107df887b2f` | `16f77893ed0ad5aa572c3380a8fcd0d0fa496925` | Reuse the dedicated fulfillment module, its Worker wiring, tests and architecture contract. |

The production fulfillment module is byte-identical to the original PBE-182
candidate. No old branch snapshot or unrelated gallery/native changes were
merged. Current one-use OAuth transactions, refund download denial, Real Estate
delivery verification and local loopback security remain intact.

The extraction had one conflict: `package.json`. The prepared checkout's
version was retained in full because the artifact/CI sibling owns that path.
This intentionally leaves the original PBE-182 `pretest` registration pending
for that owner: include `worker/paid-order-fulfillment.test.mjs` in the required
test invocation. The command was run directly here, so the new module's tests
are covered by this receipt even though `npm test` alone does not yet run them.

Latest Workers best-practice guidance and
`@cloudflare/workers-types@5.20261117.1` were inspected. The latter confirms
`ImageTransformer.output()` returns a Promise; its resolved result supplies
`response()`. No Worker compatibility date, binding or provider configuration
was changed.

## Changed paths

- `worker/checkout-worker.mjs`: delegate paid fulfillment and settlement
  reconciliation; retain routing, signature verification, buyer authorization,
  public projections, email/provider adapters and redemption guards.
- `worker/paid-order-fulfillment.mjs`: original explicit-dependency extraction,
  including session/amount validation, rendering, lifecycle fences and
  settlement checks, capabilities, failure persistence and replay recovery.
- `worker/cloudflare-images-renderer.mjs`: required asynchronous-output fix.
- `worker/paid-order-fulfillment.test.mjs`: original six tests plus payment
  validation, dependency construction, settlement hold/unavailability, fence
  races, late revocation, archive policy and replay characterization. Includes
  31 tests/subtests in total.
- `worker/checkout-worker.test.mjs`: prerequisite coverage plus an HTTP-level
  test for buyer recovery, email resend, paid replay, temporary settlement
  holds/unavailability and recovery without another render/email.
- `docs/architecture/paid-order-fulfillment.md`: retained original metrics,
  explicit inputs/authority/failure contract and evidence for deferred seams.
- `docs/sops/BUYER_SUPPORT_SOP.md`: prerequisite's guarded paid-order recovery
  instructions. They do not authorize a live replay in this task.
- `docs/audits/pbe-220-fulfillment-integration.md`: this receipt.

No public UI, theme, SEO, catalog generator, package/release pipeline, native
source, local connector source or database was changed. The public SQLite
artifact and generated native API contract are unchanged by Git blob hash.
`Owner.sqlite` remains private and authoritative; no snapshot was copied,
created or migrated to satisfy validation.

## Validation

Environment: repository lockfile installed with
`npm ci --ignore-scripts --no-audit --no-fund` in the isolated checkout;
Node `v26.8.1`; the package scripts' `python3` resolves to Homebrew Python
`3.14.7`, with Pillow `12.3.0`. No repo-local Python environment is declared
or present in this checkout. No dependency manifests or lockfiles changed.

| Check | Result |
| --- | --- |
| Prepared baseline: checkout, lifecycle deny, non-revocable media and account isolation | 128/128 passed. |
| First integration: same checks plus original PBE-182 focused tests | 135/135 passed. |
| Expanded fulfillment module tests | 31/31 passed. |
| `npm test` | Pretest 32/32 and Node 287/287 passed. Python 487/489 passed; only the two pre-reported native-culling parity assertions failed. This run preceded the additional HTTP hold test; that test and the entire checkout file were then covered in the final focused run below. |
| Final focused suite (command below) | 172/172 passed, including the additional HTTP hold test. |
| `npm run validate` | Generated Owner API contract current: 41 operations, 14 schemas. Publish validation then stopped because no absolute **reviewed** Owner.sqlite snapshot was supplied. No replacement authority was invented. |
| Syntax / diff | `node --check` passed for all five changed JavaScript modules; `git diff --check` clean. |
| Protected inputs | `package.json`, `photos.js`, `photos-data.js`, `catalog-sqlite.js`, `scripts/local_server.py`, public SQLite and generated native API contract match the prepared baseline by blob hash. |

Final focused invocation:

```sh
node --test worker/paid-order-fulfillment.test.mjs \
  worker/checkout-worker.test.mjs worker/lifecycle-deny-store.test.mjs \
  worker/non-revocable-public-assets.test.mjs \
  scripts/public_worker_origin_policy.test.mjs \
  scripts/order_account_isolation.test.mjs \
  scripts/pbe_customer_only_cutover.test.mjs
```

Unrelated full-suite failures, left unchanged:

- `scripts.native_culling_parity_test.NativeCullingParityTest.test_culling_preview_is_bounded_and_collapsible`
- `scripts.native_culling_parity_test.NativeCullingParityTest.test_window_and_preview_layout_persist_between_launches`

The tests exercise in-memory/temp stores, local ZIP output and mocked deployed
bindings. They are not live payment, refund, R2, webhook or email receipts.

## Remaining acceptance and integration boundary

1. Parent integrates these four provenance commits and the final tests/docs
   commit onto its chosen integration branch, preserving newer unrelated
   protections. Parent owns ticket updates, shared logs and final release.
2. Artifact/CI owner registers the focused module tests in required checks and
   excludes this private engineering receipt from storefront output. No
   `package.json` conflict should be resolved by importing the old test script.
3. Parent integrates catalog candidate
   `d884a66a16662ba23c7eff04677a2aa0072c81fe`, SEO candidate
   `45d88cb8c81861752b5f2d1356500ffd35ab017b` and settings/recovery work, then
   reruns combined checks. Those public candidates are not ancestors of this
   branch; Worker source has no new dependency on them.
4. Public bundles ceasing to load demonstrably unused Owner code is deferred
   to the public-module owner with caller evidence. Moving settings, SEO or
   bootstrap here would conflict with the sibling work. The documented native
   bridge imports/host routes still have active callers, so no connector
   extraction or native protocol change is justified in this package.
5. Publish validation still needs the reviewed Owner snapshot. The two known
   native-culling parity failures still prevent a completely green full suite.
   Parent retains those blockers; this branch does not absorb their repair.
6. PBE-221's integrated buyer/mobile verification, deployed release identity,
   rollback evidence and any separately authorized provider rehearsal remain
   outstanding. Source-only tests establish none of those receipts. No visible
   version was advanced; release/version ownership stays with the parent.

No main merge/push, deployment, canonical database change, account/provider
configuration, live payment/refund, webhook replay or customer communication
was performed. This child does not mark PBE-220 Done.
