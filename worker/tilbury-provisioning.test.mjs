import assert from "node:assert/strict";
import test from "node:test";
import { handleTilbury } from "./tilbury-shops.mjs";

const ORIGIN = "https://worker.test";
const TOKEN = "synthetic-owner-token-0123456789";
const APPROVED_SHA = "6140174d891acd121113dd5bf4fa7769c319c3f63e80ea7bac9df5e89a2ea433";
const ZIP = new Uint8Array([80, 75, 3, 4, 115, 121, 110, 116, 104, 101, 116, 105, 99]);
const SKUS = ["easier-week", "before-you-spend", "tech-proof", "say-it-clearly"];
const request = (route = "/tilbury/setup-tech-proof", body = ZIP, headers = {}) => new Request(ORIGIN + route, {
  method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/zip", ...headers }, body,
});

/** Real SDK transport with no network fallback and exclusively synthetic stores. */
function fixture(t) {
  const state = { config: { setup_locked: true, webhook: "we_synthetic_existing", current_offer: { active: true },
    products: Object.fromEntries(SKUS.filter((sku) => sku !== "tech-proof").map((sku) => [sku, {
      product: `tilbury_${sku.replaceAll("-", "_")}_v1`, price: `price_old_${sku}`, amount: 99,
    }])) }, requests: [], writes: [], file: null, price: null, reads: 0 };
  const env = { STRIPE_SECRET_KEY: "sk_test_synthetic_offline", OWNER_CONNECTOR_TOKENS_JSON: JSON.stringify({ synthetic: TOKEN }),
    ORDERS_KV: {
      async get(key, type) {
        if (key === "tilbury:webhook-secret") return "whsec_synthetic";
        assert.equal(key, "tilbury:configuration"); assert.equal(type, "json");
        state.reads++; return structuredClone(state.config);
      },
      async put(key, value) { assert.equal(key, "tilbury:configuration"); state.writes.push(key); state.config = JSON.parse(value); },
    },
    PRIVATE_MEDIA: {
      async put(key, bytes, metadata) {
        assert.equal(key, "tilbury/products/tech-proof.zip"); assert.deepEqual(new Uint8Array(bytes), ZIP);
        state.file = { size: bytes.byteLength, ...metadata };
      },
      async head(key) { assert.match(key, /^tilbury\/products\/[a-z-]+\.zip$/); return state.file; },
    },
  };
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (address, options) => {
    const url = new URL(address), params = new URLSearchParams(options.body);
    assert.equal(url.origin, "https://api.stripe.com", "never allow an outbound network fallback");
    state.requests.push({ url, method: options.method, params, headers: new Headers(options.headers) });
    if (url.pathname.startsWith("/v1/products/")) {
      const id = url.pathname.split("/").at(-1);
      if (options.method === "POST") state.onUpdate?.();
      return Response.json({ id });
    }
    if (url.pathname === "/v1/prices" && options.method === "GET") return Response.json({ data: state.price ? [state.price] : [] });
    if (url.pathname === "/v1/prices" && options.method === "POST") {
      state.price = { id: "price_synthetic_alex", active: true, currency: params.get("currency"),
        unit_amount: Number(params.get("unit_amount")), product: params.get("product") };
      return Response.json(state.price);
    }
    throw Error(`Unexpected synthetic Stripe operation: ${options.method} ${url.pathname}`);
  });
  return { state, env };
}

/** Substitute only the approved digest for one synthetic ZIP, never other inputs.
 * Real SHA rejection is tested separately; private acceptance also uses the exact
 * pinned ZIP with real crypto in both captured and candidate workerd modules.
 */
function allowSyntheticZip(t) {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (algorithm, bytes) => {
    if (Buffer.from(bytes).equals(Buffer.from(ZIP))) {
      assert.equal(algorithm, "SHA-256"); return Uint8Array.from(Buffer.from(APPROVED_SHA, "hex")).buffer;
    }
    return digest(algorithm, bytes);
  });
}

test("Alex setup rejects unauthorized, wrong MIME, size and unapproved bytes before side effects", async (t) => {
  const { env, state } = fixture(t);
  for (const [body, headers, expected] of [
    [ZIP, { authorization: "" }, 401], [ZIP, { authorization: "Bearer wrong" }, 401],
    [ZIP, { "content-type": "application/json" }, 415],
    [ZIP, { "content-length": "500001" }, 413],
    [new Uint8Array(500001), {}, 413], [null, {}, 400], [ZIP, {}, 400],
  ]) assert.equal((await handleTilbury(request(undefined, body, headers), env)).status, expected);
  assert.deepEqual(state.requests, []); assert.deepEqual(state.writes, []); assert.equal(state.file, null);
  assert.equal(state.reads, 0, "invalid ZIPs never read product configuration");
});

test("Alex setup provisions the exact seven-lesson one-time offer and replays without a new price", async (t) => {
  const { env, state } = fixture(t); allowSyntheticZip(t);
  const prior = structuredClone(state.config);
  for (let replay = 0; replay < 2; replay++) {
    const response = await handleTilbury(request(), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ready: true, sku: "tech-proof", product: "tilbury_tech_proof_v1",
      price: "price_synthetic_alex", amount: 99, currency: "usd", recurring: false,
      zip_bytes: ZIP.byteLength, sha256: APPROVED_SHA, webhook: prior.webhook });
  }
  for (const [sku, entry] of Object.entries(prior.products)) assert.deepEqual(state.config.products[sku], entry);
  assert.equal(state.config.webhook, prior.webhook); assert.deepEqual(state.config.current_offer, prior.current_offer);
  assert.equal(state.requests.filter((row) => row.url.pathname === "/v1/prices" && row.method === "POST").length, 1);
  const price = state.requests.find((row) => row.url.pathname === "/v1/prices" && row.method === "POST");
  assert.equal(price.params.get("unit_amount"), "99"); assert.equal(price.params.get("currency"), "usd");
  assert.equal(price.params.has("recurring[interval]"), false);
  assert.equal(price.headers.get("idempotency-key"), "tilbury-usd-099-tech-proof-v1");
  const updates = state.requests.filter((row) => row.url.pathname === "/v1/products/tilbury_tech_proof_v1" && row.method === "POST");
  assert.equal(updates.length, 2);
  assert.match(updates[0].params.get("description"), /eight-page seven-lesson field guide, seven-page workbook, offline calculator and two CSV checklists/);
  assert.equal(state.file.customMetadata.sha256, APPROVED_SHA);
  assert.equal(state.file.httpMetadata.contentType, "application/zip");
});

for (const [label, change] of [
  ["unready shop", (s) => { s.config.current_offer.active = false; }],
  ["inactive price", (s) => { s.price.active = false; }],
  ["recurring price", (s) => { s.price.recurring = { interval: "month" }; }],
  ["wrong amount", (s) => { s.price.unit_amount = 100; }],
  ["wrong currency", (s) => { s.price.currency = "eur"; }],
  ["wrong product", (s) => { s.price.product = "another_product"; }],
  ["existing conflict", (s) => { s.config.products["tech-proof"] = { product: "another_product" }; }],
  ["concurrent webhook", (s) => { s.onUpdate = () => { s.config.webhook = "we_changed"; }; }],
  ["concurrent Alex config", (s) => { s.onUpdate = () => { s.config.products["tech-proof"] = { product: "other" }; }; }],
]) test(`Alex setup retains its provisioning fence: ${label}`, async (t) => {
  const { env, state } = fixture(t); allowSyntheticZip(t);
  state.price = { id: "price_synthetic_alex", active: true, currency: "usd", unit_amount: 99, product: "tilbury_tech_proof_v1" };
  change(state);
  const response = await handleTilbury(request(), env);
  assert.equal(response.status, label === "unready shop" ? 409 : 502);
  assert.deepEqual(state.writes, [], "a conflict must not adopt a configuration");
  assert.ok(state.requests.every((row) => row.url.pathname !== "/v1/prices" || row.method === "GET"));
});

test("Alex setup verifies stored bytes and checksum before provider provisioning", async (t) => {
  const { env, state } = fixture(t); allowSyntheticZip(t);
  env.PRIVATE_MEDIA.head = async () => ({ size: ZIP.byteLength, customMetadata: { sha256: "0".repeat(64) } });
  assert.equal((await handleTilbury(request(), env)).status, 502);
  assert.deepEqual(state.requests, []); assert.deepEqual(state.writes, []);
});

test("fixed-price activation covers every live offer and retains historical entitlements", async (t) => {
  const { env, state } = fixture(t);
  state.config.products["tech-proof"] = { product: "tilbury_tech_proof_v1", price: "price_old_tech-proof", amount: 0 };
  const prior = structuredClone(state.config.products);
  const firstFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (address, options) => {
    const url = new URL(address);
    if (url.pathname === "/v1/prices" && options.method === "GET") {
      const lookup = url.searchParams.get("lookup_keys[0]");
      return Response.json({ data: [{ id: `price_new_${lookup}`, product: lookup.replace(/_usd_099_v1$/, ""),
        unit_amount: 99, currency: "usd", active: true }] });
    }
    if (url.pathname === "/v1/checkout/sessions") return Response.json({ data: [
      { id: "cs_alex_old", metadata: { tilbury: "v1", sku: "tech-proof", offer: "free" } },
      { id: "cs_pbe", metadata: { order_id: "pbe-synthetic" } },
      { id: "cs_alex_current", metadata: { tilbury: "v1", sku: "tech-proof", offer: "usd-099" } },
    ], has_more: false });
    if (url.pathname.endsWith("/expire")) {
      assert.equal(url.pathname, "/v1/checkout/sessions/cs_alex_old/expire");
      return Response.json({ id: "cs_alex_old", status: "expired" });
    }
    return firstFetch(address, options);
  });
  const response = await handleTilbury(request("/tilbury/price-099", null), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).expired_old_checkouts, 1);
  for (const sku of SKUS) {
    assert.equal(state.config.products[sku].amount, 99);
    assert.deepEqual(state.config.products[sku].previous_prices, [{ price: prior[sku].price, amount: prior[sku].amount }]);
  }
  assert.equal(state.config.intro_offer.active, false); assert.equal(state.config.current_offer.active, true);
  assert.equal(state.requests.filter((row) => row.method === "POST").length, 4);
});

test("initial setup retains four product checks, dedicated webhook events and durable configuration", async (t) => {
  const { env, state } = fixture(t), inspected = [], provider = [], stored = new Map();
  state.config = { products: {} };
  env.PRIVATE_MEDIA.head = async (key) => { inspected.push(key); return { size: 4 }; };
  const get = env.ORDERS_KV.get;
  env.ORDERS_KV.get = async (key, type) => key === "tilbury:webhook-secret" ? stored.get(key) : get(key, type);
  env.ORDERS_KV.put = async (key, value, options) => {
    stored.set(key, { value, options });
    if (key === "tilbury:configuration") state.config = JSON.parse(value);
  };
  t.mock.method(globalThis, "fetch", async (address, options) => {
    const url = new URL(address), params = new URLSearchParams(options.body);
    assert.equal(url.origin, "https://api.stripe.com"); provider.push({ url, params, method: options.method });
    if (url.pathname.startsWith("/v1/products/")) return Response.json({ id: url.pathname.split("/").at(-1) });
    if (url.pathname === "/v1/prices") {
      const product = url.searchParams.get("lookup_keys[0]").replace(/_usd$/, "");
      return Response.json({ data: [{ id: `price_${product}`, product, unit_amount: 99, currency: "usd" }] });
    }
    if (url.pathname === "/v1/webhook_endpoints" && options.method === "GET") return Response.json({ data: [] });
    if (url.pathname === "/v1/webhook_endpoints" && options.method === "POST") {
      assert.deepEqual([0, 1, 2, 3].map((i) => params.get(`enabled_events[${i}]`)), [
        "checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "charge.dispute.created",
      ]);
      assert.equal(params.get("url"), "https://photosbyelie-checkout-mock.ec92009.workers.dev/tilbury/webhook");
      return Response.json({ id: "we_synthetic_new", secret: "whsec_synthetic_new" });
    }
    if (url.pathname === "/v1/tax/registrations") return Response.json({ data: [] });
    assert.equal(url.pathname, "/v1/account"); return Response.json({ id: "acct_synthetic", charges_enabled: true });
  });
  const response = await handleTilbury(request("/tilbury/setup", null), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).ready, true);
  assert.deepEqual(Object.keys(state.config.products), SKUS);
  assert.deepEqual(inspected, SKUS.map((sku) => `tilbury/products/${sku}.zip`));
  assert.equal(state.config.setup_locked, true); assert.equal(state.config.webhook, "we_synthetic_new");
  assert.equal(stored.get("tilbury:configuration").options, undefined, "final configuration must not expire with an order TTL");
  assert.equal(stored.get("tilbury:webhook-secret").value, "whsec_synthetic_new");
  assert.equal(provider.filter((row) => row.method === "POST").length, 1);
});
