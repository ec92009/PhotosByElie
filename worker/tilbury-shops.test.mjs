import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import Stripe from "stripe";
import { handleTilbury } from "./tilbury-shops.mjs";

const SITE = "https://web-by-elie.com";
const BACKEND = "https://worker.test";
const SESSION = "cs_live_synthetic_01234567890123456789";
const ATTEMPT = "synthetic-checkout-attempt-0123456789";
const OFFERS = { "easier-week": ["June Rowan", "june.rowan", 1500],
  "before-you-spend": ["Nora Vela", "nora.vela", 1900], "tech-proof": ["Alex Ward", "alex.ward", 99],
  "say-it-clearly": ["Elena Brooks", "elena.brooks", 1500] };
const post = (route, body, headers = {}) => new Request(BACKEND + route, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

/** Real Stripe SDK, synthetic fetch transport and isolated namespaced KV/R2. */
function fixture(t, overrides = {}) {
  const products = Object.fromEntries(Object.keys(OFFERS).map((sku) => [sku, {
    product: "prod_synthetic", price: "price_099", amount: 99,
    standard_price: "price_standard", previous_prices: [{ price: "price_free", amount: 0 }],
  }]));
  const rows = new Map([["tilbury:configuration", JSON.stringify({ products, current_offer: { active: true }, webhook: "synthetic" })]]);
  const writes = [], requests = [], reads = [];
  const session = {
    id: SESSION, status: "complete", payment_status: "paid", currency: "usd", amount_subtotal: 99, amount_total: 99,
    created: Math.floor(Date.now() / 1000), metadata: { tilbury: "v1", sku: "easier-week", order_id: "tilbury-synthetic" },
    payment_intent: { latest_charge: { refunded: false, amount_refunded: 0, disputed: false } },
    ...overrides,
  };
  const line = { quantity: 1, price: { id: "price_099", product: "prod_synthetic" } };
  const env = {
    STRIPE_SECRET_KEY: "sk_test_synthetic_offline", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_offline",
    ORDERS_KV: {
      async get(key, type) {
        reads.push(key);
        const raw = rows.get(key) ?? null;
        return type === "json" || type?.type === "json" ? JSON.parse(raw) : raw;
      },
      async put(key, value, options) { writes.push({ key, options }); rows.set(key, value); },
    },
    PRIVATE_MEDIA: { async get(key) { reads.push(key); return { body: new Uint8Array([80, 75, 3, 4]) }; } },
  };
  t.mock.method(globalThis, "fetch", async (address, options) => {
    const url = new URL(address);
    requests.push({ url, options });
    assert.equal(url.origin, "https://api.stripe.com");
    if (url.pathname === "/v1/checkout/sessions" && options.method === "POST") {
      return Response.json({ id: SESSION, url: "https://checkout.stripe.test/synthetic", created: session.created });
    }
    assert.equal(options.method, "GET");
    if (url.pathname === `/v1/checkout/sessions/${SESSION}`) return Response.json(session);
    assert.equal(url.pathname, `/v1/checkout/sessions/${SESSION}/line_items`);
    return Response.json({ data: [line] });
  });
  return { env, rows, writes, requests, reads, session, line };
}

test("Tilbury falls through without configuration or I/O for all PBE namespaces", async (t) => {
  const f = fixture(t);
  for (const route of ["/health", "/checkout/guest", "/api/v1/lifecycle/reconcile", "/media/expo/photo.jpg",
    "/download/token", "/wstCommerceSnapshot", "/tilbury", "/tilbury-other/catalog"]) {
    assert.equal(await handleTilbury(new Request(BACKEND + route), {}), null);
  }
  for (const value of [{ type: "checkout.session.completed", data: { object: { metadata: { order_id: "PBE-synthetic" } } } }, {}, null, 42, "text", []]) {
    const request = post("/stripe-webhook", value);
    assert.equal(await handleTilbury(request, {}), null);
    assert.deepEqual(await request.json(), value, "namespace inspection must preserve the PBE signature body");
  }
  const malformed = new Request(BACKEND + "/stripe-webhook", { method: "POST", body: "invalid" });
  assert.equal(await handleTilbury(malformed, {}), null);
  assert.equal(await malformed.text(), "invalid");
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.reads, []);
});

test("actual Worker entrypoint intercepts Tilbury and delegates unchanged PBE requests", async (t) => {
  const f = fixture(t);
  const source = fs.readFileSync(new URL("./cloud-worker.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export default class PhotosByElieWorker extends WorkerEntrypoint");
  const delegated = [];
  const Worker = vm.runInNewContext(source.slice(start).replace("export default class", "class") + "\nPhotosByElieWorker;", {
    WorkerEntrypoint: class { constructor(env) { this.env = env; } }, handleTilbury,
    worker: { fetch(request, env) { delegated.push({ request, env }); return new Response("PBE"); } },
  });
  const worker = new Worker(f.env);
  const request = post("/stripe-webhook", { type: "checkout.session.completed", data: { object: { metadata: {} } } });
  assert.equal(await (await worker.fetch(request)).text(), "PBE");
  assert.equal(delegated[0].request, request);
  assert.equal(delegated[0].env, f.env);
  const catalog = await worker.fetch(new Request(BACKEND + "/tilbury/catalog"));
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).products["easier-week"].amount, 99);
  assert.equal(delegated.length, 1);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.writes, []);
});

test("Tilbury checkout and provisioning reject missing authority/consent without provider mutations", async (t) => {
  const f = fixture(t);
  const valid = { sku: "easier-week", digitalConsent: true, termsConsent: true, email: "buyer@example.test" };
  const headers = { origin: SITE, "idempotency-key": ATTEMPT };
  for (const [body, requestHeaders, expected] of [
    [valid, { ...headers, origin: "https://photos-by-elie.com" }, 403],
    [{ ...valid, sku: "unknown" }, headers, 400], [{ ...valid, digitalConsent: false }, headers, 400],
    [{ ...valid, termsConsent: false }, headers, 400], [{ ...valid, email: "invalid" }, headers, 400],
    [valid, { ...headers, "idempotency-key": "short" }, 400],
  ]) assert.equal((await handleTilbury(post("/tilbury/checkout", body, requestHeaders), f.env)).status, expected);
  for (const route of ["/tilbury/setup", "/tilbury/setup-tech-proof", "/tilbury/price-099"]) {
    assert.equal((await handleTilbury(post(route, {}), f.env)).status, 401);
  }
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.writes, []);
});

test("Tilbury checkout keeps server-selected 99-cent price, consent and namespace idempotency", async (t) => {
  const f = fixture(t);
  const request = () => post("/tilbury/checkout", {
    sku: "easier-week", digitalConsent: true, termsConsent: true, email: "buyer@example.test",
    amount: 1, price: "caller-price", letterOptIn: false,
  }, { origin: SITE, "idempotency-key": ATTEMPT });
  for (let replay = 0; replay < 2; replay++) assert.equal((await handleTilbury(request(), f.env)).status, 200);
  for (const { options } of f.requests) {
    const params = new URLSearchParams(options.body);
    assert.equal(params.get("line_items[0][price]"), "price_099");
    assert.equal(params.get("metadata[letter_opt_in]"), "no");
    assert.equal(params.get("metadata[offer]"), "usd-099");
    assert.equal(new Headers(options.headers).get("idempotency-key"), `tilbury-usd099-checkout-easier-week-${ATTEMPT}`);
    assert.equal(params.get("amount"), null);
  }
  assert.ok(f.writes.every(({ key }) => key === `tilbury:order:${SESSION}`));
  assert.ok(f.writes.every(({ options }) => options.expirationTtl <= 30 * 86400));
});

test("Tilbury common webhook validates its own signature and never claims photo fulfillment", async (t) => {
  const f = fixture(t);
  const payload = JSON.stringify({ id: "evt_synthetic", type: "checkout.session.completed",
    data: { object: { metadata: { tilbury: "v1" } } } });
  const signed = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: f.env.STRIPE_WEBHOOK_SECRET,
    cryptoProvider: Stripe.createSubtleCryptoProvider() });
  const request = (signature) => new Request(BACKEND + "/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": signature }, body: payload,
  });
  assert.equal((await handleTilbury(request("invalid"), f.env)).status, 400);
  const accepted = await handleTilbury(request(signed), f.env);
  assert.deepEqual(await accepted.json(), { received: true, namespace: "tilbury" });
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.writes, []);
});

test("dedicated Tilbury webhook requires its separate signature and safely replays fulfillment", async (t) => {
  const f = fixture(t);
  const secret = "whsec_synthetic_tilbury_only";
  f.rows.set("tilbury:webhook-secret", secret);
  const payload = JSON.stringify({ id: "evt_synthetic", type: "checkout.session.async_payment_succeeded", data: { object: f.session } });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, cryptoProvider: Stripe.createSubtleCryptoProvider() });
  const request = (signed) => new Request(BACKEND + "/tilbury/webhook", {
    method: "POST", headers: { "stripe-signature": signed }, body: payload,
  });
  assert.equal((await handleTilbury(request("invalid"), f.env)).status, 400);
  assert.deepEqual(f.writes, []);
  for (let replay = 0; replay < 2; replay++) assert.equal((await handleTilbury(request(signature), f.env)).status, 200);
  assert.equal(JSON.parse(f.rows.get(`tilbury:order:${SESSION}`)).status, "paid");
  assert.ok(f.writes.every(({ key }) => key === `tilbury:order:${SESSION}`));
  assert.ok(f.requests.every(({ options }) => options.method === "GET"));
});

test("Tilbury missing configuration fails closed without disrupting PBE fallthrough", async (t) => {
  const f = fixture(t);
  t.mock.method(console, "error", () => {});
  assert.equal((await handleTilbury(new Request(BACKEND + "/tilbury/catalog"), {})).status, 502);
  assert.equal(await handleTilbury(new Request(BACKEND + "/health"), {}), null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.requests, []);
});

test("Tilbury paid, historical free and standard-price downloads retain isolated entitlements", async (t) => {
  for (const [price, amount] of [["price_099", 99], ["price_free", 0], ["price_standard", 1500]]) {
    await t.test(price, async (t) => {
      const f = fixture(t, { amount_subtotal: amount, amount_total: amount,
        ...(amount === 0 ? { payment_intent: null, payment_status: "no_payment_required" } : {}) });
      f.line.price.id = price;
      const response = await handleTilbury(new Request(`${BACKEND}/tilbury/download?session_id=${SESSION}`), f.env);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/zip");
      assert.match(response.headers.get("cache-control"), /private, no-store/);
      assert.equal((await response.arrayBuffer()).byteLength, 4);
      assert.ok(f.writes.every(({ key }) => key === `tilbury:order:${SESSION}`));
      assert.equal(f.requests.length, 2);
      assert.ok(f.requests.every(({ options }) => options.method === "GET"));
      assert.equal(f.reads.filter((key) => key.startsWith("tilbury/products/")).length, 1);
    });
  }
});

test("Tilbury downloads fail closed for expired, unpaid, refunded, disputed and mismatched orders", async (t) => {
  for (const [label, change] of [
    ["expired", (f) => { f.session.created -= 31 * 86400; }],
    ["unpaid", (f) => { f.session.payment_status = "unpaid"; }],
    ["currency", (f) => { f.session.currency = "eur"; }],
    ["amount", (f) => { f.session.amount_subtotal = 98; }],
    ["refunded", (f) => { f.session.payment_intent.latest_charge.refunded = true; }],
    ["partial refund", (f) => { f.session.payment_intent.latest_charge.amount_refunded = 1; }],
    ["disputed", (f) => { f.session.payment_intent.latest_charge.disputed = true; }],
    ["product", (f) => { f.line.price.product = "other-product"; }],
    ["quantity", (f) => { f.line.quantity = 2; }],
  ]) await t.test(label, async (t) => {
    const f = fixture(t); change(f);
    const response = await handleTilbury(new Request(`${BACKEND}/tilbury/download?session_id=${SESSION}`), f.env);
    assert.equal(response.status, 403);
    assert.deepEqual(f.writes, []);
    assert.equal(f.reads.some((key) => key.startsWith("tilbury/products/")), false);
  });
});

test("Tilbury unsubscribe GET is read-only and explicit POST changes only its consent record", async (t) => {
  const f = fixture(t);
  const token = "00000000-0000-4000-8000-000000000001";
  f.rows.set(`tilbury:letter-token:${token}`, "synthetic-digest");
  f.rows.set("tilbury:letter:synthetic-digest", JSON.stringify({ status: "subscribed" }));
  const url = `${BACKEND}/tilbury/unsubscribe?token=${token}`;
  assert.equal((await handleTilbury(new Request(url), f.env)).status, 200);
  assert.deepEqual(f.writes, []);
  assert.equal((await handleTilbury(new Request(url, { method: "POST" }), f.env)).status, 200);
  assert.deepEqual(f.writes.map(({ key }) => key), ["tilbury:letter:synthetic-digest"]);
  assert.equal(JSON.parse(f.rows.get("tilbury:letter:synthetic-digest")).status, "unsubscribed");
  assert.deepEqual(f.requests, []);
});

for (const [sku, [host, page, standardAmount]] of Object.entries(OFFERS)) {
  test(`live Tilbury offer ${sku} retains checkout, delivery and historical price`, async (t) => {
    const f = fixture(t, { metadata: { tilbury: "v1", sku, order_id: "tilbury-synthetic" } });
    const catalog = await (await handleTilbury(new Request(BACKEND + "/tilbury/catalog"), f.env)).json();
    assert.deepEqual(Object.keys(catalog.products), Object.keys(OFFERS));
    assert.deepEqual(catalog.products[sku], { name: catalog.products[sku].name, host, page, amount: 99, standard_amount: standardAmount });
    const response = await handleTilbury(post("/tilbury/checkout", {
      sku, digitalConsent: true, termsConsent: true, email: "buyer@example.test",
      attribution: { version: "v1", platform: "youtube", scope: "synthetic" },
    }, { origin: SITE, "idempotency-key": ATTEMPT }), f.env);
    assert.equal(response.status, 200);
    const params = new URLSearchParams(f.requests[0].options.body);
    assert.equal(params.get("metadata[sku]"), sku);
    assert.equal(params.get("cancel_url"), `${SITE}/${page}#shop`);
    assert.equal(params.get("metadata[funnel_version]"), null, "post-deployment upstream attribution is outside this restoration");
    const order = await (await handleTilbury(new Request(`${BACKEND}/tilbury/order?session_id=${SESSION}`), f.env)).json();
    assert.equal(order.paid, true); assert.equal(order.host, host); assert.equal(order.page, page);
    f.line.price.id = "price_standard";
    f.session.amount_subtotal = standardAmount; f.session.amount_total = standardAmount;
    const zip = await handleTilbury(new Request(`${BACKEND}/tilbury/download?session_id=${SESSION}`), f.env);
    assert.equal(zip.status, 200); assert.equal(zip.headers.get("content-disposition"), `attachment; filename="${sku}.zip"`);
    assert.ok(f.reads.includes(`tilbury/products/${sku}.zip`));
  });
}

test("Alex delivery retains email idempotency, explicit letter consent and later refund denial", async (t) => {
  const f = fixture(t, { metadata: { tilbury: "v1", sku: "tech-proof", order_id: "tilbury-synthetic", letter_opt_in: "yes" },
    customer_email: "buyer@example.test" });
  f.env.RESEND_API_KEY = "synthetic-resend"; f.env.ORDER_EMAIL_FROM = "shop@example.test";
  const stripeFetch = globalThis.fetch, emails = [];
  t.mock.method(globalThis, "fetch", async (address, options) => {
    if (new URL(address).origin !== "https://api.resend.com") return stripeFetch(address, options);
    emails.push({ options, body: JSON.parse(options.body) });
    return Response.json({ id: "synthetic-email" });
  });
  const url = `${BACKEND}/tilbury/order?session_id=${SESSION}`;
  for (let replay = 0; replay < 2; replay++) assert.equal((await handleTilbury(new Request(url), f.env)).status, 200);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].options.headers["idempotency-key"], `tilbury-delivery-${SESSION}`);
  assert.match(emails[0].body.subject, /The Tech Proof Kit/); assert.match(emails[0].body.text, /Alex Ward/);
  assert.match(emails[0].body.text, /30 days/);
  assert.equal([...f.rows.keys()].filter((key) => key.startsWith("tilbury:letter:")).length, 1);
  assert.ok(f.writes.every(({ key }) => key.startsWith("tilbury:")));
  f.session.payment_intent.latest_charge.refunded = true;
  assert.equal((await handleTilbury(new Request(url), f.env)).status, 403);
  assert.equal(emails.length, 1);
});
