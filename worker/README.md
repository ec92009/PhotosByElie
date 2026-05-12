# PhotosByElie Worker

This folder contains the Worker-track implementation for checkout and fulfillment. It supports real Stripe Checkout when Stripe secrets are configured, and keeps a mock Stripe path for local/testing work:

```text
browser basket -> Worker order draft -> Stripe Checkout -> signed paid webhook -> delivery ZIP
```

## What The Worker Owns

- Order IDs.
- Buyer email for guest checkout.
- USD-only totals.
- Basket snapshots.
- Photo/product validation against the public catalog.
- Stripe Checkout Session creation.
- Stripe webhook verification from the raw request body and `Stripe-Signature` header.
- Order status transitions.
- Delivery ZIP metadata, local mock ZIP generation, and signed-link-style download tokens.

Stripe owns only the payment track. The browser proposes a basket, but the Worker recalculates price and availability before creating the checkout session.

## Routes

All routes also work under `/api`, for example `/api/checkout/guest`.

| Route | Trigger | Result |
|---|---|---|
| `GET /health` | Runtime check | Returns Worker status and fixed currency |
| `POST /checkout/guest` | Buyer chooses guest checkout | Creates `pending_payment` order and Stripe Checkout URL |
| `POST /checkout/account` | Buyer chooses account checkout | Same order flow, tagged as `account` |
| `POST /stripe-webhook` | Stripe/mocked Stripe says checkout completed | Verifies payment facts, prepares delivery, marks order `ready` |
| `POST /mock-stripe/pay` | Local mock payment helper | Simulates a paid Stripe event for a Checkout Session |
| `GET /orders/:orderId?email=...` | Buyer checks delivery state | Returns order status when email matches |
| `GET /download/:token` | Buyer clicks download | Returns a mock signed R2 URL and applies one-download-per-hour throttling |

`worker/local-server.mjs` also provides `GET /download-order/:orderId` for local-only mock testing. It serves the generated ZIP directly from `deliveries/` by order ID, which keeps downloads working after the in-memory mock Worker state has been restarted.

## Public Checkout

`worker/deployed-worker.mjs` is the Cloudflare Worker entrypoint for public checkout. It uses durable Cloudflare bindings:

- `ORDERS_KV` stores orders, Checkout Session indexes, and download tokens.
- `PUBLIC_MEDIA` can still serve public preview JPEGs from the `photosbyelie-public` R2 bucket under `/media/...`, but the public static site no longer uses that bridge for browsing previews.
- `PRIVATE_MEDIA` reads private developed masters from R2.
- `DELIVERY_MEDIA` serves private buyer downloads. It can point at the same private R2 bucket for the mock phase.

The public static site points checkout to the deployed Worker through `window.photosByElieMediaConfig.checkoutWorkerBaseUrl` and points public preview media directly to the public R2 media base through `window.photosByElieMediaConfig.publicBaseUrl`. Use `?workerBase=https://...` for alternate cloud Workers, `?workerBase=http://localhost:8787` while testing locally, and `?mediaBase=https://...` for alternate public media bases. The R2 delivery adapter passes full-resolution masters through unchanged and reads JPG 6 MP, 3 MP, and 1 MP products from private R2 `renders/...` keys. Those generated JPG buyer files are unwatermarked, generated/uploaded by the media pipeline on the machine with developed masters, and reused by later per-file downloads. Public cloud delivery intentionally avoids assembling one large ZIP in the Worker; each purchased file gets its own download token.

The current checkout Worker is live at:

```text
https://photosbyelie-checkout-mock.ec92009.workers.dev
```

Real Stripe is selected automatically when `STRIPE_SECRET_KEY` is present. Required Stripe configuration:

- `STRIPE_SECRET_KEY`: test or live secret key used to create Checkout Sessions.
- `STRIPE_WEBHOOK_SECRET`: endpoint secret for `/stripe-webhook`; required for real Stripe webhook verification.
- `STRIPE_API_VERSION`: optional pinned Stripe API version.

Without `STRIPE_SECRET_KEY`, the Worker stays in mock mode and `/mock-stripe/pay` remains available. With real Stripe enabled, `/mock-stripe/pay` is disabled.

Live payment is blocked until test mode proves the full flow:

- Successful card payment reaches `checkout.session.completed`.
- 3D Secure/authentication-required payment returns to the order page cleanly.
- Declined card does not mark the order paid.
- A verified webhook builds the private R2 delivery ZIP and exposes the order download.
- Stripe receipts remain payment records only; PhotosByElie delivery links stay in the Worker/order flow.

Stripe's standard successful test Visa is `4242 4242 4242 4242` with any future expiry and any 3-digit CVC. Use Stripe's current test-card list for 3D Secure and decline scenarios.

## Guest Checkout Example

For the full local mock flow, run the static site and the local Worker in separate terminals:

```bash
python3 scripts/local_server.py 8000
node worker/local-server.mjs
```

Then open `http://localhost:8000/basket.html`, enter a buyer email, choose `Pay as guest`, and use `Simulate Stripe payment`. The browser lands on `order.html`, where `Download ZIP` downloads the generated file from the local Worker. Mock delivery ZIPs are also written to `deliveries/photosbyelie-order-<orderId>.zip`, and the order page shows the Local ZIP path plus a copy button for browser shells that hide attachment download feedback. ZIP contents are flat: delivered image files sit at the archive root beside `ORDER.txt`, not inside per-photo folders.

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
- `checkout.url`, a Stripe Checkout URL
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

The local adapter prefers configured developed-master roots from `PBE_DELIVERY_SOURCE_ROOTS` or `PBE_DELIVERY_SOURCE_ROOT`, and falls back to local watermarked previews only for mock testing. The core Worker still returns JSON from `/download/:token`; `worker/local-server.mjs` upgrades local token/order routes into actual ZIP responses when the ZIP path is on disk.

## Tests

Run from the repo root:

```bash
node --test worker/checkout-worker.test.mjs
```
