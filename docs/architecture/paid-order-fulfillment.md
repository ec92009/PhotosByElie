# Paid-order fulfillment boundary

`worker/paid-order-fulfillment.mjs` owns the transition from a validated paid
Stripe session to a durable ready order. HTTP routing, webhook signature
verification, public response shaping, checkout creation, and provider client
construction remain in `worker/checkout-worker.mjs`.

## Explicit dependency allowlist

The module may depend only on these injected seams, also enforced by
`PAID_ORDER_FULFILLMENT_DEPENDENCIES` and its focused test:

- `orderStore`: order lookup/persistence and download-capability persistence
- `deliveryRenderer`: asynchronous private delivery creation
- `lifecycleFence`: deny checks, settlement reconciliation, ready commit, and
  download-capability authorization
- `email`: idempotent ready-email handoff
- `analytics`: non-blocking payment-completion recording
- `time`: timestamp source
- `downloadPolicy`: expiry and download-limit policy
- `applyDownloadPolicy`: policy projection onto rendered files
- `mediaIdsForOrder`: canonical asset identity projection

The module must not own Worker `Request`/`Response` objects, route paths, fetch
calls, Stripe client construction, or webhook signature verification.

## Inputs, authority and failure contract

`createPaidOrderFulfillment(dependencies)` returns two asynchronous operations:

- `fulfillPaidSession(session)` accepts the session from an **already verified**
  Stripe event (or the explicitly enabled local mock). It resolves the stored
  order from `metadata.order_id`, falling back to `client_reference_id`. The
  stored Checkout Session ID, paid status, amount in cents and currency must
  match before any fulfillment write, render, email or analytics handoff. A
  ready-order replay still validates payment and lifecycle authority, but does
  not re-render files, reissue capabilities or record another payment event.
- `reconcileOrder(order, { throwOnRevocation = false })` reads the authoritative
  settlement. An armed `blocked_pending_lifecycle` hold rejects with
  `paid_asset_lifecycle_pending` (409) without rewriting the order. A terminal
  `manual_refund_review` settlement clears its delivery projection and stays
  blocked on replay. With `throwOnRevocation`, it also rejects with
  `paid_asset_revoked` (409). Authority lookup failures propagate; they cannot
  authorize delivery or send an email.

Both return internal order records, never buyer response objects. The Worker
retains email/account ownership checks, private/no-store response shaping,
refund-based download denial, redemption counters and Real Estate asset
verification. Internal bucket/object/ZIP keys must not reach a buyer through
the module's internal return value; the Worker applies `publicOrder` first.

| Seam | Required contract |
| --- | --- |
| `orderStore` | Async `getOrder(id)`, `putOrder(order)` and `putDownload(record)`. These are durable projections, not lifecycle authority. |
| `deliveryRenderer` | Async `createDelivery(preparingOrder)` returns private per-file descriptors or the retained archive descriptor. Cloudflare Images `output()` must resolve before its response is read. |
| `lifecycleFence` | `assertAllowed(ids, context, expectedFence)` returns the lifecycle fence; `fulfillmentFor(id)` reconciles settlement; `commitFulfillmentReady` and `authorizeDownloadCapability` retain the existing authoritative ordering. |
| `email` | `sendReady(order)` returns the updated order. The Worker adapter retains provider idempotency, sent-email suppression, lifecycle email-dispatch claims and email failure persistence. |
| `analytics` | `record(event)` uses the Worker's error-isolating adapter; analytics failure cannot fail checkout or delivery. |
| `time` | `now()` returns a `Date`. |
| Download policy and identity | `downloadPolicy()` supplies expiry/limit, `applyDownloadPolicy(file, policy)` projects it, and `mediaIdsForOrder(order)` supplies canonical media IDs. |

Missing mandatory functions fail at construction. Lifecycle methods remain
optional for the existing in-process/local harnesses. This is **not** permission
to omit deployed authority: `deployed-worker.mjs` still constructs the existing
D1 lifecycle store. No authority, schema, binding or provider setup is changed
by the extraction.

Fences are checked before preparation, after rendering and before the ready
commit. Settlement is checked around capability writes, the final order write,
email handoff and final return. Revocation produces durable manual review;
renderer failure produces `delivery_failed`. Retrying that same paid session
can recover delivery without creating another Stripe Checkout Session. A
successful retry clears its old delivery error, and `publicOrder` also suppresses
stale errors on historical ready records.

An email dispatch already claimed while the authoritative settlement was ready
may reach the provider before a later deny. Final reconciliation rejects that
ready response; redemption still consults current authority. A local/mock test
does not prove provider delivery, production webhook ordering or a live refund.
Ready replay idempotency does not introduce a new cross-request lock or change
the existing D1/provider serialization contracts.

## Preserved behavior

- Stripe order ID, session ID, paid status, amount, and currency validation
- ready-order replay idempotency
- lifecycle fences before rendering, after rendering, and before ready commit
- durable `delivery_failed` and `manual_refund_review` states
- retry of the same paid session from `delivery_failed` to `ready`
- per-file and legacy archive download capabilities
- ready-email and payment-completion analytics handoffs

## Original PBE-182 extraction metrics

Measured against baseline commit `524af00c95fb8d072613536ae37aeafddaff6b23`:

| Metric | Before | After |
| --- | ---: | ---: |
| `worker/checkout-worker.mjs` lines | 4,375 | 4,189 |
| `createPhotosByElieWorker` span | 2,961 | 2,774 |
| Inline fulfillment functions in the Worker factory | 3 | 0 |
| Inline fulfillment-function source span | 199 lines | 0 lines |
| Dedicated fulfillment module | 0 | 256 lines |

The dedicated module has one public factory. It exposes only
`fulfillPaidSession` and `reconcileOrder`; its lifecycle and persistence helpers
remain private.

## PBE-220 integration and deferred seams

PBE-220 reuses source commit `49644606426f91bdff69109a7f807107df887b2f`
and its three small fulfillment prerequisites; see the
[integration receipt](../audits/pbe-220-fulfillment-integration.md). Compared
with prepared baseline `618f9da211810a09fbc0aed88f6283ec0ba536aa`, the Worker
changes from 4,362 to 4,177 lines, the three inline fulfillment functions move
behind this factory, and the extracted production module remains 256 lines.
These are review-scope measurements, not a reason for further splitting.

Public bootstrap/lifecycle batching belongs to PBE-217's candidate
`d884a66a16662ba23c7eff04677a2aa0072c81fe`; SEO belongs to PBE-218's
`45d88cb8c81861752b5f2d1356500ffd35ab017b`; settings/recovery belongs to
PBE-219. None changes the fulfillment dependency contract. Those candidates
must be integrated and tested together by the parent; this branch does not
copy their public modules or remove embedded Owner branches from `photos.js`.
Public-bundle Owner-code elimination therefore remains a separate acceptance
item, requiring caller evidence and the public-module owner's implementation.

Retained local connector responsibilities have concrete native callers:

- `OwnerActionRunner.swift` launches the sealed `scripts/new_owner_connector.py`
  runtime against the enrolled data root and its private `Owner.sqlite`.
- `new_owner_connector._load_local_modules` imports
  `local_server.new_owner_connector_result`,
  `new_owner_sidecar_decision_result`, `apply_public_photo_moderation` and the
  retained preview helpers from the sealed runtime. Fixture, review,
  publication, metadata and lifecycle tests call these functions directly.
- `PBEOwnerNativeHostContract.swift` explicitly lists the authenticated native
  host/session/action/source-preview routes. The local HTTP security mixin
  and session handlers guard those routes; the remaining function names do
  not imply anonymous customer access.

Moving this bridge dispatcher would change installed runtime packaging and
native/import contracts without evidence of a fulfillment dependency. PBE-220
therefore preserves it, including its SQLite writer and capability boundaries.
It creates no JSON authority or second connector writer. Removing retired
local HTTP handlers or shared public Owner branches requires a separately
scoped caller/packaging audit, not a file-length target.
