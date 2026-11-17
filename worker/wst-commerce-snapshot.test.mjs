import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { buildWstCommerceSnapshot } from "./wst-commerce-snapshot.mjs";
import { createStripeClient } from "./stripe-client.mjs";

test("WST commerce snapshot exports only verified daily aggregates", async () => {
  const pages = [
    {
      data: [
        { id: "pi_live_ready", status: "succeeded", amount_received: 3200, currency: "usd", created: Date.parse("2026-09-04T20:00:00Z") / 1000 },
        { id: "pi_live_pending", status: "succeeded", amount_received: 800, currency: "usd", created: Date.parse("2026-09-04T21:00:00Z") / 1000 },
        { id: "pi_not_paid", status: "requires_payment_method", amount: 5000, currency: "usd", created: Date.parse("2026-09-04T22:00:00Z") / 1000 },
      ],
      has_more: true,
    },
    {
      data: [{ id: "pi_live_eur", status: "succeeded", amount_received: 1000, currency: "eur", created: Date.parse("2026-09-05T08:00:00Z") / 1000 }],
      has_more: false,
    },
  ];
  const stripe = {
    async listPaymentIntents({ startingAfter }) {
      assert.equal(startingAfter, pages.length === 2 ? "" : "pi_not_paid");
      return pages.shift();
    },
    async listRefunds({ paymentIntentId }) {
      return { data: paymentIntentId === "pi_live_pending" ? [{ status: "succeeded", amount: 300 }] : [] };
    },
  };
  const store = {
    async listOrders() {
      return [
        { paymentIntentId: "pi_live_ready", status: "ready", buyerEmail: "private@example.test", delivery: { readyAt: "2026-09-04T20:01:00Z" } },
        { paymentIntentId: "pi_live_pending", status: "preparing" },
        { paymentIntentId: "pi_mock_old", status: "ready", amountPaid: 999999 },
      ];
    },
  };
  const snapshot = await buildWstCommerceSnapshot({ store, stripe, now: () => new Date("2026-09-06T09:00:00Z") });
  assert.deepEqual(snapshot.days, [
    { day: "2026-09-04", currency: "USD", accepted_conversions: 2, confirmed_revenue: 3700, delivery_ready: 1 },
    { day: "2026-09-05", currency: "EUR", accepted_conversions: 1, confirmed_revenue: 1000, delivery_ready: 0 },
  ]);
  assert.equal(JSON.stringify(snapshot).includes("private@example.test"), false);
  assert.equal(JSON.stringify(snapshot).includes("pi_live"), false);
  assert.equal(JSON.stringify(snapshot).includes("999999"), false);
});

test("private commerce RPC retains its live-configuration gate and existing HTTP delegation", async () => {
  const source = fs.readFileSync(new URL("./cloud-worker.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export default class PhotosByElieWorker extends WorkerEntrypoint");
  assert.ok(start > 0);
  const namespace = {};
  const env = { ORDERS_KV: namespace, KV_PREFIX: "test-prefix", STRIPE_SECRET_KEY: "synthetic-secret", STRIPE_WEBHOOK_SECRET: "synthetic-webhook" };
  const calls = [];
  const store = { listOrders: async () => [] };
  const stripe = { listPaymentIntents: async () => ({ data: [] }), listRefunds: async () => ({ data: [] }) };
  const Worker = vm.runInNewContext(source.slice(start).replace("export default class", "class") + "\nPhotosByElieWorker;", {
    WorkerEntrypoint: class { constructor(environment) { this.env = environment; } },
    handleTilbury: async () => null,
    worker: { fetch: (request, environment) => { calls.push({ request, environment }); return "existing-http-handler"; } },
    createKvStore(options) { assert.equal(options.namespace, namespace); assert.equal(options.prefix, "test-prefix"); return store; },
    createStripeClient(options) { assert.equal(options.secretKey, "synthetic-secret"); assert.equal(options.webhookSecret, "synthetic-webhook"); return stripe; },
    buildWstCommerceSnapshot,
  });
  assert.throws(() => new Worker({}).wstCommerceSnapshot(), /Live Stripe is unavailable/);
  const worker = new Worker(env);
  const request = new Request("https://example.test/wstCommerceSnapshot");
  assert.equal(await worker.fetch(request), "existing-http-handler");
  assert.equal(calls[0].request, request);
  assert.equal(calls[0].environment, env);
  const snapshot = await worker.wstCommerceSnapshot();
  assert.equal(snapshot.schema_version, "wst.pbe-commerce.v1");
  assert.equal(snapshot.site_id, "photosbyelie");
  assert.deepEqual(snapshot.days, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /synthetic-secret|synthetic-webhook|test-prefix/);
});

test("commerce Stripe readers use bounded GET requests and retain provider failure handling", async () => {
  const requests = [];
  const client = createStripeClient({
    secretKey: "synthetic-secret", webhookSecret: "synthetic-webhook",
    fetchImpl: async (url, options) => { requests.push({ url, options }); return Response.json({ data: [], has_more: false }); },
  });
  await client.listPaymentIntents({ startingAfter: "pi_test", limit: 1000 });
  await client.listRefunds({ paymentIntentId: "pi_test" });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].url).searchParams.get("limit"), "100");
  assert.equal(new URL(requests[0].url).searchParams.get("starting_after"), "pi_test");
  assert.equal(new URL(requests[1].url).searchParams.get("payment_intent"), "pi_test");
  for (const { options } of requests) { assert.equal(options.method, "GET"); assert.equal(options.body, undefined); }
  const failing = createStripeClient({
    secretKey: "synthetic-secret", webhookSecret: "synthetic-webhook",
    fetchImpl: async () => Response.json({ error: { message: "synthetic upstream failure" } }, { status: 503 }),
  });
  await assert.rejects(failing.listPaymentIntents(), { code: "stripe_request_failed", status: 502 });
});
