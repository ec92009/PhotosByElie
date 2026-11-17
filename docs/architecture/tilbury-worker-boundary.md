# Tilbury Worker source boundary

`worker/tilbury-shops.mjs` preserves the application in the captured active
Worker version `ebcb81cb-8b48-41aa-9b35-a8d7b0296d9d` (2026-10-21), including
all four USD 0.99 offers, Alex Ward's Tech Proof Kit and its guarded setup route.
The source-to-bundle relationship, retained PBE dispatch adaptation and bounded
main-Worker comparison are documented in
[the live-source preservation audit](../audits/pbe-live-worker-source-preservation.md).
The Stripe SDK remains pinned to 23.0.0. This source candidate is not a new
deployment or proof of provider transactions.

The entrypoint calls this handler before the photo Worker. Only `/tilbury/`
and metadata-tagged Tilbury events at `/stripe-webhook` are intercepted. Common
webhook inspection clones the request and defers Stripe construction until its
namespace is known, preserving the photo signature body and mock/unconfigured
PBE fallthrough. Tilbury errors stay inside its handler.

Photo order and download state remains separate from `tilbury:` KV keys and
`tilbury/products/` private ZIPs. Checkout uses the fixed server configuration,
required purchase consent and namespaced Stripe idempotency. Current USD 0.99,
historical free and standard-price entitlements retain their original checks.
Every delivery rechecks session, age, currency, product, quantity, amount and
current refund/dispute state. Letter GET is read-only; unsubscribe requires POST.

The source includes administrative setup and price-activation routes, protected
by the existing connector credential. `/tilbury/setup-tech-proof` additionally
requires the exact approved ZIP checksum, verifies its private R2 metadata,
checks the fixed one-time price and fences adoption against concurrent shop
configuration changes. Its product update retains the seven-lesson description.
Restoring these routes does not authorize running them in production.
Regression tests use the real SDK with an intercepted fetch,
synthetic signatures and disposable KV/R2 objects. No real provider, payment,
email, subscription, private product or business report is read or changed.

`wstCommerceSnapshot()` remains an independent private service-binding RPC.
There is no new HTTP analytics endpoint here. PBE-225 owns `wstFunnelSnapshot()`.
