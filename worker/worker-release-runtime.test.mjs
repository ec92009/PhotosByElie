import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import fs from "node:fs";
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
