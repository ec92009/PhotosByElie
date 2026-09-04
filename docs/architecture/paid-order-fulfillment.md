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

## Preserved behavior

- Stripe order ID, session ID, paid status, amount, and currency validation
- ready-order replay idempotency
- lifecycle fences before rendering, after rendering, and before ready commit
- durable `delivery_failed` and `manual_refund_review` states
- retry of the same paid session from `delivery_failed` to `ready`
- per-file and legacy archive download capabilities
- ready-email and payment-completion analytics handoffs

## Extraction metrics

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
