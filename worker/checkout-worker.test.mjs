import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";

const loadCatalog = () => {
  const sandbox = { window: {}, console, Intl };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../photos-data.js", import.meta.url), "utf8"), sandbox);
  return createCatalogIndex({
    collections: sandbox.window.photosByElieData,
    resolutions: sandbox.window.photosByElieResolutions,
    frameOptions: sandbox.window.photosByElieFrameOptions,
  });
};

const deterministicIds = () => {
  let count = 0;
  return () => {
    count += 1;
    return `${String(count).padStart(12, "0")}-aaaa-bbbb-cccc-${String(count).padStart(12, "0")}`;
  };
};

const jsonRequest = (url, body, headers = {}) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const testWorker = () => {
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe,
    now,
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });
  return { worker, stripe, store };
};

const firstDeliverablePhotoId = (catalog) => {
  for (const [photoId, entry] of catalog.photos.entries()) {
    const options = catalog.availableOptionsFor(entry.photo).map((option) => option.id);
    if (entry.photo.sourceFiles?.length && options.includes("full") && options.includes("jpg-3mp")) {
      return photoId;
    }
  }
  throw new Error("Could not find a deliverable test photo.");
};

test("guest checkout creates a pending order and mock Stripe session", async () => {
  const catalog = loadCatalog();
  const { worker } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-3mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.match(body.order.id, /^PBE-20260507-/);
  assert.equal(body.order.status, "pending_payment");
  assert.equal(body.order.currency, "usd");
  assert.equal(body.order.amountExpected, 5500);
  assert.equal(body.order.items[0].products.length, 2);
  assert.match(body.checkout.url, /^https:\/\/mock\.stripe\.local\/checkout\/cs_mock_/);
});

test("mock Stripe payment moves the order to ready and records a delivery ZIP", async () => {
  const catalog = loadCatalog();
  const { worker } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.amountPaid, 4500);
  assert.match(paid.order.delivery.zipKey, /^deliveries\/photosbyelie-order-PBE-20260507-/);
  assert.match(paid.order.delivery.downloadUrl, /^\/download\/dl_/);

  const lookupResponse = await worker.fetch(new Request(`https://worker.test/orders/${paid.order.id}?email=buyer@example.com`));
  assert.equal(lookupResponse.status, 200);
  const lookup = await lookupResponse.json();
  assert.equal(lookup.order.status, "ready");
});

test("webhook rejects paid sessions whose amount does not match the order", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const event = stripe.paidEventForSession(checkout.checkout.sessionId, { amount_total: 9999 });

  const webhookResponse = await worker.fetch(jsonRequest("https://worker.test/stripe-webhook", event, {
    "x-mock-stripe-signature": stripe.signatureForPayload(),
  }));
  assert.equal(webhookResponse.status, 409);
  const body = await webhookResponse.json();
  assert.equal(body.error.code, "amount_mismatch");
});

test("download endpoint returns a mock signed R2 URL and rate-limits repeat downloads", async () => {
  const catalog = loadCatalog();
  const { worker } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);
  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  const paid = await payResponse.json();
  const token = paid.order.delivery.downloadUrl.split("/").pop();

  const downloadResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(downloadResponse.status, 200);
  const download = await downloadResponse.json();
  assert.match(download.download.mockSignedUrl, /^mock-r2:\/\/deliveries\//);

  const repeatedResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(repeatedResponse.status, 429);
});
