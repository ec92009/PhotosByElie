# PhotosByElie Worker

This folder contains the first Worker-track implementation for checkout and fulfillment. Stripe is mocked for now, but the Worker keeps the same boundary we want in production:

```text
browser basket -> Worker order draft -> mock Stripe checkout -> mock paid webhook -> delivery ZIP
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
- Delivery ZIP metadata, local mock ZIP generation, and signed-link-style download tokens.

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

`worker/local-server.mjs` also provides `GET /download-order/:orderId` for local-only mock testing. It serves the generated ZIP directly from `deliveries/` by order ID, which keeps downloads working after the in-memory mock Worker state has been restarted.

## Public Mock Checkout

`worker/deployed-worker.mjs` is the Cloudflare Worker entrypoint for public mock checkout. It is still mock payment, but it uses durable Cloudflare bindings:

- `ORDERS_KV` stores orders, Checkout Session indexes, and download tokens.
- `PRIVATE_MEDIA` reads private developed masters from R2.
- `DELIVERY_MEDIA` writes and serves generated ZIP files. It can point at the same private R2 bucket for the mock phase.

The public static site can point to the deployed Worker through `window.photosByElieMediaConfig.checkoutWorkerBaseUrl` in `media-config.js`, or with `?workerBase=https://...` while testing. The R2 ZIP adapter currently supports full-resolution products only; scaled JPG products still need a production image-resize/export path before they should be enabled for real cloud delivery.

`wrangler.toml` is checked in with placeholder KV ids. Replace the `ORDERS_KV` ids before deploying.

## Guest Checkout Example

For the full local mock flow, run the static site and the local Worker in separate terminals:

```bash
python3 -m http.server 8000
node worker/local-server.mjs
```

Then open `http://localhost:8000/basket.html`, enter a buyer email, choose `Pay as guest`, and use `Simulate Stripe payment`. The browser lands on `order.html`, where `Download ZIP` downloads the generated file from the local Worker. Mock delivery ZIPs are also written to `deliveries/photosbyelie-order-<orderId>.zip`, and the order page shows the Local ZIP path plus a copy button for browser shells that hide attachment download feedback.

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

In production the mock Stripe client gets replaced by a real Stripe client, and the local ZIP adapter becomes real private R2/ZIP work. The local adapter prefers configured developed-master roots from `PBE_DELIVERY_SOURCE_ROOTS` or `PBE_DELIVERY_SOURCE_ROOT`, and falls back to local watermarked previews only for mock testing. The core Worker still returns JSON from `/download/:token`; `worker/local-server.mjs` upgrades local token/order routes into actual ZIP responses when the ZIP path is on disk.

## Tests

Run from the repo root:

```bash
node --test worker/checkout-worker.test.mjs
```
