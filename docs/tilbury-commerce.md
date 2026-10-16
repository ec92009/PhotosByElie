# Tilbury digital shops

Owner authorization, 16 October 2026: build the three original digital products,
turn their Web By Elie pages into shops and reuse Photos By Elie's Stripe setup,
without approval pauses.

`worker/tilbury-shops.mjs` adds an isolated `/tilbury/` namespace. The normal
Worker entrypoint delegates other routes to the existing photo worker. The
existing photo webhook acknowledges correctly signed Tilbury sessions; a
separate Tilbury webhook performs delivery for confirmed and asynchronous
payments. Photo catalog, pricing, orders and credentials are not reconfigured.

The extension uses the existing server-side Stripe key, ORDERS_KV,
PRIVATE_MEDIA and verified delivery-email configuration. Stripe credentials
were not extracted or copied to another machine. The three fixed product IDs
start with `tilbury_`, private ZIPs live under `tilbury/products/`, and order and
configuration keys start with `tilbury:`. No paid content belongs in this public
repository. Sources and product builders are in the separate private Tilbury
commerce project.

Provisioning accepts the existing authenticated owner connector only, creates
only the three fixed products/prices and a dedicated webhook, then locks itself
to a read-only configuration response. The catalog is public. Checkout takes
only a fixed SKU and accepted terms, prices on the server, and uses Stripe
idempotency keys. No customer account or subscription is created.

Fulfillment verifies session payment, current refund/dispute state, currency,
price and quantity with Stripe. Private downloads expire 30 days from purchase.
Delivery emails use the verified sender already configured for Photos By Elie,
clearly identify Web By Elie and link to its private recovery page. The storefront
explains the Photos By Elie bank-statement name. Automatic tax is enabled only
when the existing account has a readable active registration; it is not silently
assumed from the presence of Stripe Tax.

Deployment initially wrapped the exact live bundle to preserve all unrelated
production code and bindings. This source integration keeps future normal PBE
builds from dropping the new routes. The private commerce runtime retains the
pre-change bundle for rollback; never commit that runtime or secret values.

Web pages: https://web-by-elie.com/june.rowan,
https://web-by-elie.com/nora.vela, https://web-by-elie.com/elena.brooks.
No charge or paid checkout was performed during this build.
