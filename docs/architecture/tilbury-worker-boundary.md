# Tilbury Worker source boundary

`worker/tilbury-shops.mjs` restores the source retained at
`c00ef4d538b4908c012ff6b3a0945c85ef74bdbe`: namespace integration from
`2b42fa1f`, historical free entitlements and letter consent from `7c948c03`,
and the fixed USD 0.99 offer from `356fed3b`. The matching Stripe SDK is pinned
to 23.0.0. These are source identities, not current provider configuration proof.

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
by the existing connector credential. Restoring their code does not authorize
running them. Regression tests use the real SDK with an intercepted fetch,
synthetic signatures and disposable KV/R2 objects. No real provider, payment,
email, subscription, private product or business report is read or changed.

`wstCommerceSnapshot()` remains an independent private service-binding RPC.
There is no new HTTP analytics endpoint here. PBE-225 owns `wstFunnelSnapshot()`.
