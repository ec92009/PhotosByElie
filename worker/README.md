# PhotosByElie Worker

This folder contains the first Worker-track implementation for checkout and fulfillment. Stripe is mocked for now, but the Worker keeps the same boundary we want in production:

```text
browser basket -> Worker order draft -> mock Stripe checkout -> mock paid webhook -> delivery ZIP record
```

## What The Worker Owns

- Order IDs.
- Buyer email for guest checkout.
- USD-only totals.
- Basket snapshots.
- Photo/product validation against the public catalog.
- Mock Stripe Checkout Session creation.
- Mock Stripe webhook verification.
- Order status transitions.
- Delivery ZIP metadata and signed-link-style download tokens.

Stripe owns only the payment track. The browser proposes a basket, but the Worker recalculates price and availability before creating the checkout session.

## Routes

All routes also work under `/api`, for example `/api/checkout/guest`.

| Route | Trigger | Result |
|---|---|---|
| `GET /health` | Runtime check | Returns Worker status and fixed currency |
| `POST /checkout/guest` | Buyer chooses guest checkout | Creates `pending_payment` order and mock Stripe URL |
| `POST /checkout/account` | Buyer chooses account checkout | Same order flow, tagged as `account` |
| `POST /stripe-webhook` | Stripe/mocked Stripe says checkout completed | Verifies payment facts, prepares delivery, marks order `ready` |
| `POST /mock-stripe/pay` | Local mock payment helper | Simulates a paid Stripe event for a Checkout Session |
| `GET /orders/:orderId?email=...` | Buyer checks delivery state | Returns order status when email matches |
| `GET /download/:token` | Buyer clicks download | Returns a mock signed R2 URL and applies one-download-per-hour throttling |

## Guest Checkout Example

```bash
curl -sS http://localhost:8787/checkout/guest \
  -H 'content-type: application/json' \
  -d '{
    "email": "buyer@example.com",
    "items": [
      {
        "photoId": "20110106-0604-14854-8e7f792f7e",
        "options": [{ "id": "full" }, { "id": "jpg-3mp" }]
      }
    ]
  }'
```

The response includes:

- `order.id`, such as `PBE-20260507-...`
- `order.amountExpected`, in cents
- `checkout.url`, a mock Stripe Checkout URL
- `checkout.sessionId`, used by the mock payment helper

## Mock Payment Example

```bash
curl -sS http://localhost:8787/mock-stripe/pay \
  -H 'content-type: application/json' \
  -d '{ "checkoutSessionId": "cs_mock_..." }'
```

That simulates the paid webhook and moves the order to `ready`. The resulting delivery record contains:

```text
deliveries/photosbyelie-order-<orderId>.zip
```

In production the mock Stripe client gets replaced by a real Stripe client, and the mock delivery object becomes real R2/ZIP work.

## Tests

Run from the repo root:

```bash
node --test worker/checkout-worker.test.mjs
```
