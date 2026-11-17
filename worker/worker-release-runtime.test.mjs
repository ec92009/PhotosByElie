import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import fs from "node:fs";
import Stripe from "stripe";
import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";

/** Compile the real class entrypoint; every external request is intercepted. */
test("combined workerd entrypoint retains private WST RPC, Tilbury and PBE delegation", async () => {
  const bundle = await build({ entryPoints: ["worker/cloud-worker.mjs"], bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*"] });
  const stripeRequests = [];
  const worker = (name, bindings = {}) => ({ name, script: bundle.outputFiles[0].text, modules: true,
    compatibilityDate: "2026-07-10", compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["ORDERS_KV"], d1Databases: ["ACCESS_DB"], r2Buckets: ["PRIVATE_MEDIA", "PUBLIC_MEDIA"],
    bindings,
    outboundService: async (request) => {
      stripeRequests.push({ url: request.url, method: request.method });
      assert.equal(new URL(request.url).origin, "https://api.stripe.com");
      assert.equal(new URL(request.url).pathname, "/v1/payment_intents");
      assert.equal(request.method, "GET");
      return Response.json({ data: [], has_more: false });
    },
  });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    {
      name: "rpc-test-caller", modules: true, compatibilityDate: "2026-07-10",
      serviceBindings: { PBE: "pbe-combined", UNCONFIGURED: "pbe-unconfigured" },
      script: `export default { async fetch(request, env) {
        if (new URL(request.url).pathname === '/private-rpc') return Response.json(await env.PBE.wstCommerceSnapshot());
        if (new URL(request.url).pathname === '/private-funnel') {
          try { return Response.json(await env.PBE.wstFunnelSnapshot()); }
          catch { return Response.json({blocked:true}, {status:503}); }
        }
        if (new URL(request.url).pathname === '/unconfigured-funnel') {
          try { await env.UNCONFIGURED.wstFunnelSnapshot(); }
          catch { return Response.json({blocked:true}, {status:503}); }
        }
        if (new URL(request.url).pathname === '/unconfigured-rpc') {
          try { await env.UNCONFIGURED.wstCommerceSnapshot(); }
          catch { return Response.json({blocked:true}, {status:503}); }
        }
        const address = new URL(request.url);
        if (address.pathname.startsWith('/unconfigured/')) {
          address.pathname = address.pathname.slice('/unconfigured'.length);
          return env.UNCONFIGURED.fetch(new Request(address, request));
        }
        return env.PBE.fetch(request);
      }};`,
    },
    worker("pbe-combined", { STRIPE_SECRET_KEY: "sk_test_synthetic_offline", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_offline" }),
    worker("pbe-unconfigured"),
  ] }));
  try {
    const snapshot = await mf.dispatchFetch("https://worker.test/private-rpc");
    assert.equal(snapshot.status, 200);
    assert.deepEqual((await snapshot.json()).days, []);
    assert.equal(stripeRequests.length, 1);
    assert.equal((await mf.dispatchFetch("https://worker.test/private-funnel")).status, 503, "empty KV cannot mask unavailable D1 schema");
    const database = await mf.getD1Database("ACCESS_DB", "pbe-combined");
    for (const file of ["0012_lifecycle_deny_plane.sql", "0013_lifecycle_manifest_reconciliation.sql", "0018_paid_refund_settlement.sql"]) {
      await database.exec(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8").replace(/^--.*$/gm, "").replace(/\s+/g, " "));
    }
    const lifecycle = createD1LifecycleDenyStore({ database });
    const members = [{ canonicalAssetId: "synthetic-asset", canonicalMediaId: "synthetic-photo", bindings: [
      { bucket: "public", objectKey: "expo/synthetic-photo_900.jpg" },
    ] }];
    await lifecycle.seedVisibleBatch({ seedId: "runtime-rpc-test", items: members });
    await lifecycle.activate({ activationId: "runtime-rpc-test", ...await summarizeLifecycleManifest(members) });
    const funnel = await mf.dispatchFetch("https://worker.test/private-funnel");
    assert.equal(funnel.status, 200);
    const funnelData = await funnel.json();
    assert.equal(funnelData.schema_version, "wst.pbe-funnel.v1");
    assert.deepEqual(funnelData.days, []);
    assert.equal(stripeRequests.length, 1, "empty retained orders do not trigger provider reads");
    assert.equal((await mf.dispatchFetch("https://worker.test/unconfigured-funnel")).status, 503);
    const blocked = await mf.dispatchFetch("https://worker.test/unconfigured-rpc");
    assert.equal(blocked.status, 503);
    for (const route of ["/wstCommerceSnapshot", "/api/v1/wstCommerceSnapshot", "/wst-commerce-snapshot", "/wstFunnelSnapshot", "/api/v1/wstFunnelSnapshot", "/wst-funnel-snapshot"]) {
      assert.equal((await mf.dispatchFetch("https://worker.test" + route)).status, 404);
    }
    const catalog = await mf.dispatchFetch("https://worker.test/tilbury/catalog");
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).products["easier-week"].amount, 99);
    const photoWebhook = await mf.dispatchFetch("https://worker.test/unconfigured/stripe-webhook", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { object: { metadata: {} } } }),
    });
    assert.equal(photoWebhook.status, 400);
    assert.equal((await photoWebhook.json()).error.code, "invalid_webhook_signature");
    assert.equal(stripeRequests.length, 1, "HTTP dispatch must not perform WST or payment reads");
  } finally { await mf.dispose(); }
});

/** Exercise the shipped wrapper and SDK in workerd, with disposable KV/R2 only. */
test("combined workerd preserves every live Tilbury shop, setup guards and PBE webhook fallthrough", async () => {
  const bundle = await build({ entryPoints: ["worker/cloud-worker.mjs"], bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*"] });
  const skus = ["easier-week", "before-you-spend", "tech-proof", "say-it-clearly"], outbound = [];
  const secret = "whsec_synthetic_tilbury_only", session = (sku) => `cs_live_synthetic_${sku.replaceAll("-", "_")}01234567890123456789`;
  let refunded = false;
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "tilbury-combined", modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-10", compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["ORDERS_KV"], d1Databases: ["ACCESS_DB"], r2Buckets: ["PRIVATE_MEDIA", "PUBLIC_MEDIA"],
    bindings: { STRIPE_SECRET_KEY: "sk_test_synthetic_offline", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_common",
      OWNER_CONNECTOR_TOKENS_JSON: JSON.stringify({ synthetic: "synthetic-owner-token-0123456789" }),
      RESEND_API_KEY: "synthetic-resend", ORDER_EMAIL_FROM: "shop@example.test" },
    outboundService: async (request) => {
      const url = new URL(request.url); outbound.push({ url: request.url, method: request.method });
      if (url.origin === "https://api.resend.com") {
        assert.equal(url.pathname, "/emails"); assert.equal(request.method, "POST");
        assert.match((await request.json()).subject, /The Tech Proof Kit/);
        return Response.json({ id: "synthetic-email" });
      }
      assert.equal(url.origin, "https://api.stripe.com", "all outbound I/O is intercepted");
      if (url.pathname === "/v1/checkout/sessions" && request.method === "POST") {
        const params = new URLSearchParams(await request.text()), sku = params.get("metadata[sku]");
        assert.ok(skus.includes(sku)); assert.equal(params.get("line_items[0][price]"), `price_${sku}`);
        assert.equal(request.headers.get("idempotency-key"), `tilbury-usd099-checkout-${sku}-synthetic-checkout-attempt-0123456789`);
        return Response.json({ id: session(sku), url: "https://checkout.stripe.test/synthetic", created: Math.floor(Date.now() / 1000) });
      }
      assert.equal(request.method, "GET");
      const sku = skus.find((value) => url.pathname.startsWith(`/v1/checkout/sessions/${session(value)}`));
      assert.ok(sku);
      if (url.pathname.endsWith("/line_items")) return Response.json({ data: [{ quantity: 1, price: { id: `price_${sku}`, product: `prod_${sku}` } }] });
      assert.equal(url.pathname, `/v1/checkout/sessions/${session(sku)}`);
      return Response.json({ id: session(sku), status: "complete", payment_status: "paid", currency: "usd",
        amount_subtotal: 99, amount_total: 99, created: Math.floor(Date.now() / 1000),
        metadata: { tilbury: "v1", sku, order_id: `tilbury-${sku}` },
        ...(sku === "tech-proof" ? { customer_email: "buyer@example.test" } : {}),
        payment_intent: { latest_charge: { refunded, amount_refunded: 0, disputed: false } } });
    },
  }] }));
  try {
    const kv = await mf.getKVNamespace("ORDERS_KV"), bucket = await mf.getR2Bucket("PRIVATE_MEDIA");
    await kv.put("tilbury:configuration", JSON.stringify({ setup_locked: true, webhook: "we_synthetic", current_offer: { active: true },
      products: Object.fromEntries(skus.map((sku) => [sku, { product: `prod_${sku}`, price: `price_${sku}`, amount: 99 }])) }));
    await kv.put("tilbury:webhook-secret", secret);
    for (const sku of skus) await bucket.put(`tilbury/products/${sku}.zip`, new Uint8Array([80, 75, 3, 4]));
    const send = (route, options) => mf.dispatchFetch("https://worker.test" + route, options);
    const catalog = await (await send("/tilbury/catalog")).json();
    assert.deepEqual(Object.keys(catalog.products), skus); assert.equal(catalog.products["tech-proof"].host, "Alex Ward");
    for (const route of ["/tilbury/setup", "/tilbury/setup-tech-proof", "/tilbury/price-099"]) {
      assert.equal((await send(route, { method: "POST" })).status, 401);
    }
    const owner = { authorization: "Bearer synthetic-owner-token-0123456789" };
    assert.equal((await send("/tilbury/setup-tech-proof", { method: "POST", headers: owner, body: "wrong" })).status, 415);
    assert.equal((await send("/tilbury/setup-tech-proof", { method: "POST", headers: { ...owner, "content-type": "application/zip" }, body: "wrong" })).status, 400);
    assert.equal((await send("/tilbury/setup-tech-proof", { method: "GET" })).status, 404);
    assert.equal((await send("/tilbury/unknown", { method: "OPTIONS" })).status, 204);
    for (const value of ["null", "42", '"text"', "[]", "{}", "invalid"]) {
      const response = await send("/stripe-webhook", { method: "POST", body: value });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, "invalid_webhook_signature");
    }
    assert.equal(outbound.length, 0, "invalid setup and unrelated/malformed PBE webhooks do no provider I/O");
    for (const sku of skus) {
      assert.equal((await send("/tilbury/checkout", { method: "POST", headers: { origin: "https://web-by-elie.com",
        "content-type": "application/json", "idempotency-key": "synthetic-checkout-attempt-0123456789" },
        body: JSON.stringify({ sku, digitalConsent: true, termsConsent: true, email: "buyer@example.test" }) })).status, 200);
      const order = await (await send(`/tilbury/order?session_id=${session(sku)}`)).json();
      assert.equal(order.paid, true); assert.equal(order.host, catalog.products[sku].host);
      const zip = await send(`/tilbury/download?session_id=${session(sku)}`);
      assert.equal(zip.status, 200); assert.equal(zip.headers.get("content-disposition"), `attachment; filename="${sku}.zip"`);
      assert.deepEqual(new Uint8Array(await zip.arrayBuffer()), new Uint8Array([80, 75, 3, 4]));
    }
    const payload = JSON.stringify({ id: "evt_synthetic_alex", type: "checkout.session.completed", data: { object: {
      id: session("tech-proof"), payment_status: "paid", metadata: { tilbury: "v1", sku: "tech-proof" },
    } } });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, cryptoProvider: Stripe.createSubtleCryptoProvider() });
    assert.equal((await send("/tilbury/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload })).status, 200);
    assert.equal(outbound.filter((row) => row.url.startsWith("https://api.resend.com/")).length, 1);
    refunded = true;
    assert.equal((await send(`/tilbury/download?session_id=${session("tech-proof")}`)).status, 403);
    assert.ok((await kv.list()).keys.every(({ name }) => name.startsWith("tilbury:")));
  } finally { await mf.dispose(); }
});
