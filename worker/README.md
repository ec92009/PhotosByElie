# PhotosByElie Worker

This folder contains the Worker-track implementation for checkout and fulfillment. It supports real Stripe Checkout when Stripe secrets are configured, and keeps a mock Stripe path for local/testing work:

```text
browser basket -> Worker availability check -> Stripe Checkout -> signed paid webhook -> private file downloads
```

## What The Worker Owns

- Order IDs.
- Buyer email for guest checkout.
- USD-only totals.
- Basket snapshots.
- Photo/product validation against the public catalog.
- Private R2 delivery availability validation before Stripe opens.
- Stripe Checkout Session creation.
- Stripe webhook verification from the raw request body and `Stripe-Signature` header.
- Order status transitions.
- Per-file delivery metadata, local mock ZIP generation, signed-link-style download tokens, token expiry, and download event counts.
- Real Estate originals sessions that mint private download tokens for browser-built ZIPs.

Stripe owns only the payment track. The browser proposes a basket, but the Worker recalculates price and availability before creating the checkout session.

## Routes

All routes also work under `/api`, for example `/api/checkout/guest`.

| Route | Trigger | Result |
|---|---|---|
| `GET /health` | Runtime check | Returns Worker status and fixed currency |
| `POST /checkout/guest` | Buyer chooses guest checkout | Validates selected private R2 files, then creates `pending_payment` order and Stripe Checkout URL |
| `POST /checkout/account` | Buyer chooses account checkout | Same order flow, tagged as `account` |
| `POST /stripe-webhook` | Stripe/mocked Stripe says checkout completed | Verifies payment facts, prepares delivery, marks order `ready` |
| `POST /mock-stripe/pay` | Local mock payment helper | Simulates a paid Stripe event for a Checkout Session |
| `POST /real-estate/originals/session` | Real Estate client requests selected originals | Validates the client password, checks private R2 originals, and returns per-file private download tokens |
| `POST /real-estate/deliverables` | Real Estate client saves a PDF/video product | Validates the client password and stores the small product manifest in private R2 |
| `POST /real-estate/deliverables/list` | Real Estate client opens the product shelf | Validates the client password and lists saved PDF/video manifests from private R2 |
| `GET /orders/:orderId?email=...` | Buyer checks delivery state | Returns order status when email matches |
| `GET /download/:token` | Buyer clicks download | Streams the private delivery file or returns a mock signed R2 URL in mock mode |

`worker/local-server.mjs` also provides `GET /download-order/:orderId` for local-only mock testing. It serves the generated ZIP directly from `deliveries/` by order ID, which keeps downloads working after the in-memory mock Worker state has been restarted.

## Public Checkout

`worker/deployed-worker.mjs` is the Cloudflare Worker entrypoint for public checkout. It uses durable Cloudflare bindings:

- `ORDERS_KV` stores orders, Checkout Session indexes, and download tokens.
- `PUBLIC_MEDIA` can still serve public preview JPEGs from the `photosbyelie-public` R2 bucket under `/media/...`, but the public static site no longer uses that bridge for browsing previews.
- `PRIVATE_MEDIA` reads private developed masters from R2.
- `DELIVERY_MEDIA` serves private buyer downloads. It can point at the same private R2 bucket for the mock phase.

The public static site points checkout, Real Estate originals delivery, and Real Estate product shelf sync to the deployed Worker through `window.photosByElieMediaConfig.checkoutWorkerBaseUrl` and points public preview media directly to the public R2 media base through `window.photosByElieMediaConfig.publicBaseUrl`. Use `?workerBase=https://...` for alternate cloud Workers, `?workerBase=http://localhost:8787` while testing locally, and `?mediaBase=https://...` for alternate public media bases. The R2 delivery adapter validates selected private files before creating Stripe Checkout, passes full-resolution masters through unchanged from `masters/<photo-id>.<format>`, and reads JPG 6 MP, 3 MP, and 1 MP products from flat private R2 keys like `renders/<photo-id>_6mp.jpg`. The old nested master/render migration fallback is retired; missing flat keys now block checkout/delivery instead of trying legacy paths. Real Estate originals use keys under `real-estate/<gallery-key>/masters/<album-slug>/<photo-id>.jpg`, and client-created PDF/video shelf manifests use `real-estate/<gallery-key>/deliverables/<product-id>.json`. Those generated JPG buyer files are unwatermarked, generated/uploaded by the media pipeline on the machine with developed masters, and reused by later per-file downloads. Public cloud delivery intentionally avoids assembling one large ZIP in the Worker; each purchased file or Real Estate original gets its own download token, repeat downloads are allowed up to the configured limit, and successful downloads are appended to the order event history.

The current checkout Worker is live at:

```text
https://photosbyelie-checkout-mock.ec92009.workers.dev
```

Stripe sandbox checkout has been manually proven against this Worker, including successful payment, declined card, 3D Secure/authentication-required payment, verified webhook delivery, order recovery, per-file downloads, and download-all behavior.

Live Stripe dashboard state as of 2026-05-22:

- Account: `acct_1TWCksPuO9o6fOp6`.
- Successful-payment customer receipts are enabled; refund emails remain off.
- Branding is saved with `assets/branding/photosbyelie-camera-tripod-logo-512.png`, `assets/branding/photosbyelie-camera-tripod-wordmark.png`, brand color `#5B341E`, and accent color `#D86A3E`.
- Webhook destination `we_1TZmoVPuO9o6fOp6JkBENiyV` posts `checkout.session.completed` to `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook` on Stripe API version `2026-04-22.dahlia`.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git. Do not commit or document the secret values.
- Live proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming after Stripe fees, order status `ready`, and a private R2 JPEG download of `401,035` bytes.

Real Stripe is selected automatically when `STRIPE_SECRET_KEY` is present. Required Stripe configuration:

- `STRIPE_SECRET_KEY`: test or live secret key used to create Checkout Sessions.
- `STRIPE_WEBHOOK_SECRET`: endpoint secret for `/stripe-webhook`; required for real Stripe webhook verification.
- `STRIPE_API_VERSION`: optional pinned Stripe API version.
- `CHECKOUT_SESSION_TTL_DAYS`: optional KV retention for Checkout Session lookup entries; default is 90.
- `DOWNLOAD_TOKEN_TTL_DAYS`: optional buyer download-token availability window; default is 30.
- `DOWNLOAD_TOKEN_MAX_DOWNLOADS`: optional successful-download limit per token; default is 100.
- `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX`: optional card statement descriptor suffix for Checkout PaymentIntents; default is `DOWNLOAD`, producing `PHOTOSELIE* DOWNLOAD` with the current shortened descriptor prefix. The Stripe Dashboard still owns the business descriptor prefix, logo, color, support details, and public receipt branding.
- `WORKER_PUBLIC_URL`: absolute public Worker base used when composing direct download links in buyer delivery emails.
- `ORDER_EMAIL_FROM`: sender used for buyer delivery emails, for example `Photos By Elie <orders@photos-by-elie.com>`.
- `ORDER_EMAIL_REPLY_TO`: optional reply-to mailbox for buyer delivery emails.
- `ORDER_EMAIL_INCLUDE_DIRECT_DOWNLOAD_LINKS`: optional flag; defaults to direct token links in the email when enabled.
- `RESEND_API_KEY`: Cloudflare secret enabling Resend delivery emails after paid fulfillment. Install with `npx wrangler secret put RESEND_API_KEY` after the sending domain is authenticated in Resend.

Without `STRIPE_SECRET_KEY`, the Worker stays in mock mode and `/mock-stripe/pay` remains available. With real Stripe enabled, `/mock-stripe/pay` is disabled.

Live payment proof checklist completed on 2026-05-22:

- Worker `/health` reports real Stripe and fixed `usd`.
- A successful live card payment reaches `checkout.session.completed`.
- The live webhook returns `200 OK`.
- Successful-payment receipts are enabled and the Stripe receipt is available from the payment record.
- The order page recovers by order ID and email.
- Private R2 per-file downloads and download-all work.
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
