import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import deployedWorker from "./deployed-worker.mjs";
import { createLocalZipDelivery } from "./local-zip-delivery.mjs";
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

const sourcePathForPhoto = (catalog, photoId) => catalog.photos.get(photoId).photo.sourceFiles[0].path;

const createFakeKv = () => {
  const values = new Map();
  return {
    get: async (key, options = {}) => {
      const value = values.get(key) ?? null;
      if (value == null) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    put: async (key, value) => {
      values.set(key, String(value));
    },
    _debug: values,
  };
};

const createFakeR2 = (initial = {}) => {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, {
    body: value.body instanceof Uint8Array ? value.body : new Uint8Array(value.body),
    httpMetadata: value.httpMetadata || {},
    customMetadata: value.customMetadata || {},
  }]));
  return {
    get: async (key) => {
      const value = values.get(key);
      if (!value) return null;
      return {
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        arrayBuffer: async () => value.body.buffer.slice(value.body.byteOffset, value.body.byteOffset + value.body.byteLength),
        body: value.body,
      };
    },
    put: async (key, body, options = {}) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      values.set(key, {
        body: bytes,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      });
    },
    _debug: values,
  };
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

test("local ZIP delivery creates a real ZIP from preview fallback", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const outputDir = fs.mkdtempSync("/tmp/photosbyelie-deliveries-");
  const worker = createPhotosByElieWorker({
    catalog,
    stripe,
    now,
    randomUUID,
    delivery: createLocalZipDelivery({
      repoRoot: new URL("..", import.meta.url).pathname,
      outputDir,
      now,
    }),
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const checkout = await checkoutResponse.json();
  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.match(paid.order.delivery.zipKey, /photosbyelie-order-PBE-20260507-.*\.zip$/);
  const zip = fs.readFileSync(paid.order.delivery.zipKey);
  assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304");
  assert.ok(zip.includes(Buffer.from("ORDER.txt")));

  fs.rmSync(outputDir, { recursive: true, force: true });
});

test("deployed Worker mock checkout writes and downloads a private R2 ZIP", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const sourcePath = sourcePathForPhoto(catalog, photoId);
  const privateKey = `masters/${photoId}/${sourcePath.split(/[\\/]/).pop()}`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: new TextEncoder().encode("private developed master bytes"),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: privateR2,
    DELIVERY_MEDIA: privateR2,
    PUBLIC_SITE_URL: "https://ec92009.github.io/PhotosByElie",
  };

  const checkoutResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }), env);
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }), env);
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.match(paid.order.delivery.zipKey, /^deliveries\/photosbyelie-order-PBE-/);

  const token = paid.order.delivery.downloadUrl.split("/").pop();
  const downloadResponse = await deployedWorker.fetch(new Request(`https://worker.test/download/${token}`), env);
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "application/zip");
  const zip = Buffer.from(await downloadResponse.arrayBuffer());
  assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304");
  assert.ok(zip.includes(Buffer.from("ORDER.txt")));
  assert.ok(zip.includes(Buffer.from("private developed master bytes")));
});

test("deployed Worker serves public R2 previews through the media route", async () => {
  const publicR2 = createFakeR2({
    "expo/france/sample_900.jpg": {
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    PUBLIC_MEDIA: publicR2,
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://ec92009.github.io/PhotosByElie",
  };

  const response = await deployedWorker.fetch(new Request("https://worker.test/media/expo/france/sample_900.jpg"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("hex"), "ffd8ffd9");
});
