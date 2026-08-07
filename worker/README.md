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
- Real Estate client login, signed HttpOnly session cookies, originals sessions, and saved-product shelf sync.

Stripe owns only the payment track. The browser proposes a basket, but the Worker recalculates price and availability before creating the checkout session.

## Routes

All routes also work under `/api`, for example `/api/checkout/guest`.

| Route | Trigger | Result |
|---|---|---|
| `GET /` | Direct visit to the Worker/custom auth domain | Redirects to the public site Account sheet instead of exposing raw API JSON |
| `GET /health` | Runtime check | Returns Worker status and fixed currency |
| `POST /checkout/guest` | Buyer chooses guest checkout | Validates selected private R2 files, then creates `pending_payment` order and Stripe Checkout URL |
| `POST /checkout/account` | Buyer chooses account checkout | Same order flow, tagged as `account` |
| `POST /purchases/recent` | Basket checks checkout email plus selected photo/product IDs | Scans paid Worker order records and reports whether each item is covered by the 30-day download allowance |
| `POST /stripe-webhook` | Stripe/mocked Stripe says checkout completed | Verifies payment facts, prepares delivery, marks order `ready` |
| `POST /mock-stripe/pay` | Local mock payment helper | Simulates a paid Stripe event for a Checkout Session |
| `GET /auth/session` | Browser checks optional Google-backed session | Returns the authenticated email, tier, roles, Admin flag, and Real Estate gallery grants when a direct Google OAuth or legacy Access session exists |
| `GET /auth/google/login` | Browser starts direct Google OAuth | Redirects to Google with `prompt=select_account`; falls back to `/auth/login` when direct OAuth secrets are not configured |
| `GET /auth/google/callback` | Google returns an authorization code | Exchanges the code, validates the ID token, sets the signed `pbe_google_session` cookie, and redirects to the allowed `returnTo` URL |
| `GET /auth/login` | Browser starts legacy Google-backed Cloudflare Access login | Lets Access authenticate the browser and redirects back to the allowed `returnTo` URL |
| `GET /auth/logout` or `POST /auth/logout` | Browser signs out of the Google-backed account session | Clears the direct OAuth cookie when configured, otherwise redirects through the Cloudflare Access logout endpoint |
| `GET /owner/session` | Owner checks cloud role authorization | Requires `owner` tier or the configured Admin email |
| `POST /real-estate/access-login` | Real Estate client logs in with Google | Requires a registry grant for the requested gallery key, then issues the existing short-lived signed HttpOnly session cookie |
| `POST /real-estate/login` | Real Estate client username/password login | Verifies an ACS-managed D1 password first, falls back to a Worker-held migration credential, and issues a short-lived signed HttpOnly session cookie |
| `GET /real-estate/session` | Real Estate client checks current auth | Validates the signed session cookie |
| `POST /real-estate/logout` | Real Estate client logs out | Clears the signed session cookie |
| `POST /real-estate/originals/preflight` | Real Estate client or Backstage Owner checks selected originals | Accepts the signed client session cookie or native Owner Bearer session and returns read-only private-R2 availability without creating tokens, orders, or email; Owner Bearer access does not extend to download-session creation |
| `POST /real-estate/originals/session` | Real Estate client requests selected originals | Requires the signed session cookie, checks private R2 originals, and returns per-file private download tokens |
| `POST /real-estate/deliverables` | Real Estate client or assembler saves a product record | Requires the signed session cookie and stores the small product/job manifest in private R2 |
| `POST /real-estate/deliverables/jobs` | Real Estate client queues cloud PDF/video assembly from a saved selection manifest | Requires the signed session cookie, persists pending job records in private R2, and records video source-audio ducking under the guitar bed |
| `POST /real-estate/deliverables/list` | Real Estate client opens the product shelf | Requires the signed session cookie and lists saved selection/job/product manifests from private R2 |
| `GET /real-estate/deliverables/:id/view` | Real Estate client opens a completed cloud PDF/video product | Requires the signed session cookie and streams the private output inline |
| `GET /real-estate/deliverables/:id/download` | Real Estate client downloads a completed cloud PDF/video product | Requires the signed session cookie and streams the private output as an attachment |
| `GET /orders/:orderId?email=...` | Buyer checks delivery state | Returns order status when email matches |
| `GET /download/:token` | Buyer clicks download | Streams the private delivery file or returns a mock signed R2 URL in mock mode |

`worker/local-server.mjs` also provides `GET /download-order/:orderId` for local-only mock testing. It serves the generated ZIP directly from `deliveries/` by order ID, which keeps downloads working after the in-memory mock Worker state has been restarted.

## Public Checkout

`worker/deployed-worker.mjs` is the Cloudflare Worker entrypoint for public checkout. It uses durable Cloudflare bindings:

- `ORDERS_KV` stores orders, Checkout Session indexes, download tokens, and first-party analytics keys under `pbe:analytics:*` unless an `ANALYTICS_KV` binding is supplied. Recent-purchase allowance checks use these Worker order records as the purchase/download history source.
- `PUBLIC_MEDIA` serves public preview JPEGs from the `photosbyelie-public` R2 bucket under the custom `https://download.photos-by-elie.com/media/...` route.
- `PRIVATE_MEDIA` reads private developed masters from R2.
- `DELIVERY_MEDIA` serves private buyer downloads. It can point at the same private R2 bucket for the mock phase.
- `IMAGES` binds Cloudflare Images so the Worker can render unwatermarked JPG 1 MP, 3 MP, and 6 MP buyer files from private masters on demand.

The public static site points checkout, Real Estate login, originals delivery, Real Estate product shelf sync, Real Estate cloud assembly job submission, and first-party analytics to the deployed Worker through `window.photosByElieMediaConfig.checkoutWorkerBaseUrl`/`analyticsWorkerBaseUrl` and points public preview media to the custom Worker media route through `window.photosByElieMediaConfig.publicBaseUrl`. Use `?workerBase=https://...` for alternate cloud Workers, `?workerBase=http://localhost:8787` while testing locally, and `?mediaBase=https://...` for alternate public media bases. Analytics events are disabled on localhost, Owner pages, OAuth callbacks, Do Not Track, and Global Privacy Control; they use per-tab session IDs and do not include buyer email, order IDs, IP addresses, or user agents. The R2 delivery adapter validates selected private files before creating Stripe Checkout, passes full-resolution masters through unchanged from `masters/<photo-id>.<format>`, and treats JPG 6 MP, 3 MP, and 1 MP products as cached render objects under flat private R2 keys like `renders/<photo-id>_6mp.jpg`. If a cached JPG render is missing but the private master exists, the deployed Worker uses Cloudflare Images to generate the unwatermarked JPG, writes it back to private R2, and then delivers it. On-demand render checkout is limited to JPG/JPEG, PNG, and WEBP masters; preexisting cached render files can still be delivered for any source format. The old nested master/render migration fallback is retired; missing flat keys no longer block supported JPG checkout when the private master is present. Real Estate originals use keys under `real-estate/<gallery-key>/masters/<album-slug>/<photo-id>.jpg`, client selection/job records use `real-estate/<gallery-key>/deliverables/<product-id>.json`, and completed cloud PDF/video products are streamed from private output keys through authenticated Worker view/download routes. Public cloud delivery intentionally avoids assembling one large ZIP in the Worker; each purchased file or Real Estate original gets its own download token, repeat downloads are allowed up to the configured limit, and successful downloads are appended to the order event history.

The current checkout Worker is live at:

```text
https://download.photos-by-elie.com
```

The legacy workers.dev host remains enabled as a fallback while Stripe webhooks
and cached clients transition:

```text
https://photosbyelie-checkout-mock.ec92009.workers.dev
```

Stripe sandbox checkout has been manually proven against this Worker, including successful payment, declined card, 3D Secure/authentication-required payment, verified webhook delivery, order recovery, per-file downloads, and download-all behavior.

Live Stripe dashboard state as of 2026-05-22:

- Account: `acct_1TWCksPuO9o6fOp6`.
- Successful-payment customer receipts are enabled; refund emails remain off.
- Branding is saved with `assets/branding/photosbyelie-camera-tripod-logo-512.png`, `assets/branding/photosbyelie-camera-tripod-wordmark.png`, brand color `#5B341E`, and accent color `#D86A3E`.
- Webhook destination `we_1TZmoVPuO9o6fOp6JkBENiyV` posts `checkout.session.completed` to `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook` on Stripe API version `2026-04-22.dahlia`; the first-party `https://download.photos-by-elie.com/stripe-webhook` endpoint is also live and can become the Stripe destination after a dashboard update.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git. Do not commit or document the secret values.
- Live proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming after Stripe fees, order status `ready`, and a private R2 JPEG download of `401,035` bytes.

Real Stripe is selected automatically when `STRIPE_SECRET_KEY` is present. Required Stripe configuration:

- `STRIPE_SECRET_KEY`: test or live secret key used to create Checkout Sessions.
- `STRIPE_WEBHOOK_SECRET`: endpoint secret for `/stripe-webhook`; required for real Stripe webhook verification.
- `STRIPE_API_VERSION`: optional pinned Stripe API version.
- `CHECKOUT_SESSION_TTL_DAYS`: optional KV retention for Checkout Session lookup entries; default is 90.
- `DOWNLOAD_TOKEN_TTL_DAYS`: optional buyer download-token availability window; default is 30.
- `DOWNLOAD_TOKEN_MAX_DOWNLOADS`: optional successful-download limit per token; default is 100.
- `ANALYTICS_ENABLED`: optional first-party analytics flag; default is enabled. Set `false` to no-op `/analytics/events` and server-side analytics writes.
- `ANALYTICS_RETENTION_DAYS`: optional analytics KV retention; default is 400.
- `ANALYTICS_PERSIST_EVENTS`: optional detailed-event retention flag; the deployed config defaults to `false`, so analytics batches write aggregated count rows without retaining one KV event row per visit. Set `true` only when event-level detail is needed; local `createAnalyticsStore` tests default to persistence for inspection.
- `STRIPE_STATEMENT_DESCRIPTOR_SUFFIX`: optional card statement descriptor suffix for Checkout PaymentIntents; default is `DOWNLOAD`, producing `PHOTOSELIE* DOWNLOAD` with the current shortened descriptor prefix. The Stripe Dashboard still owns the business descriptor prefix, logo, color, support details, and public receipt branding.
- `WORKER_PUBLIC_URL`: absolute public Worker base used when composing direct download links in buyer delivery emails if direct links are enabled.
- `REAL_ESTATE_GALLERIES_JSON`: JSON array/object of Real Estate galleries with `key`, `username`/`email`, private prefixes, and either Worker-held `accessCode` or `accessCodeHash` plus `accessCodeSalt`.
- `REAL_ESTATE_SESSION_SECRET`: required secret for signing short-lived Real Estate session cookies.
- `REAL_ESTATE_SESSION_SECONDS`: optional Real Estate session TTL in seconds; default is 7200.
- `ACCESS_ADMIN_EMAIL`: the only Admin bootstrap email; currently `ec92009@gmail.com`. Admin is not grantable through registry records.
- `ACCESS_TEAM_NAME`: Cloudflare Access team name/domain for Google-backed login.
- `ACCESS_AUD`: Cloudflare Access application audience, installed as a Worker secret.
- Access user tier records live in KV under `pbe:access-users:<email>` unless a dedicated `ACCESS_USERS_KV` binding is added later. See `docs/architecture/access-tiers.md`.
- `ORDER_EMAIL_FROM`: sender used for buyer delivery emails, for example `Photos By Elie <orders@photos-by-elie.com>`.
- `ORDER_EMAIL_REPLY_TO`: optional reply-to mailbox for buyer delivery emails.
- `ORDER_EMAIL_INCLUDE_DIRECT_DOWNLOAD_LINKS`: optional flag; currently disabled in production so buyer emails send the first-party order recovery page without direct token links that can trip spam heuristics or depend on a newly propagated download subdomain.
- `RESEND_API_KEY`: Cloudflare secret enabling Resend delivery emails after paid fulfillment. Install with `npx wrangler secret put RESEND_API_KEY` after the sending domain is authenticated in Resend.

Without `STRIPE_SECRET_KEY`, the Worker stays in mock mode and `/mock-stripe/pay` remains available. With real Stripe enabled, `/mock-stripe/pay` is disabled.

### KV write budget

The deployed Worker uses the shared `ORDERS_KV` binding unless a dedicated analytics or owner-action binding is supplied. The main write sources are:

- orders and Checkout Session indexes during checkout and fulfillment;
- download-token creation and successful-download counters;
- account profiles and the KV fallback for access-user records;
- owner action/device records and their listing indexes;
- Real Estate deliverable metadata and download-token records; and
- analytics count rows.

Analytics is the highest-volume request-driven source. With `ANALYTICS_PERSIST_EVENTS=false`, a client batch is sanitized, grouped by day and event, and writes one count row per distinct day/event instead of one event row plus one count update for every event. This reduces local write pressure without changing the accepted-event response or the aggregate counters. It does not establish a Cloudflare account-level quota measurement; verify usage separately before changing billing or bindings.

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
- `order.originalSubtotalAmount`, in cents
- `order.discountCode`, when a server-validated code was accepted
- `order.discountAmount`, in cents
- `order.amountExpected`, in cents
- `checkout.url`, a Stripe Checkout URL
- `checkout.sessionId`, used by the mock payment helper

Product rows keep their catalog `amount`. When a server discount is accepted,
`product.checkoutAmount` records that product line's prorated Checkout amount.

## Guarded Discount Codes

Live rehearsal discounts are validated only by the Worker. The browser may send
`discountCode`, but it does not decide whether the code is valid or how much it
discounts.

Configure owner-only codes outside git with a Worker secret or environment
variable:

```bash
npx wrangler secret put CHECKOUT_DISCOUNT_CODES_JSON
```

Expected JSON:

```json
[
  {
    "code": "OWNER-LIVE-REHEARSAL",
    "type": "target_total",
    "targetTotalAmount": 50,
    "label": "Owner live rehearsal"
  }
]
```

Amounts are cents. The Worker caps every discount so the payable total cannot
fall below Stripe's $0.50 minimum charge.

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
