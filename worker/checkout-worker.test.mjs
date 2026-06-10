import assert from "node:assert/strict";
import fs from "node:fs";
import jpeg from "jpeg-js";
import test from "node:test";
import catalogTsv from "../scripts/catalog_tsv.cjs";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import deployedWorker from "./deployed-worker.mjs";
import { createLocalZipDelivery } from "./local-zip-delivery.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createRealEstateDeliverables } from "./real-estate-deliverables.mjs";
import { createRealEstateOriginals } from "./real-estate-originals.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
import { createStripeClient, createStripeWebhookSignature } from "./stripe-client.mjs";

const loadCatalog = () => {
  const catalogWindow = catalogTsv.loadCatalogWindow(new URL("..", import.meta.url).pathname);
  return createCatalogIndex({
    collections: catalogWindow.photosByElieData,
    resolutions: catalogWindow.photosByElieResolutions,
    frameOptions: catalogWindow.photosByElieFrameOptions,
    videoPriceTiers: catalogWindow.photosByElieVideoPriceTiers,
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

const firstDeliverablePhotoId = (catalog, collectionKey = null) => {
  for (const [photoId, entry] of catalog.photos.entries()) {
    if (collectionKey && entry.collectionKey !== collectionKey) continue;
    const options = catalog.availableOptionsFor(entry.photo).map((option) => option.id);
    if (entry.photo.sourceFiles?.length && options.includes("full") && options.includes("jpg-3mp")) {
      return photoId;
    }
  }
  throw new Error("Could not find a deliverable test photo.");
};

const sourcePathForPhoto = (catalog, photoId) => catalog.photos.get(photoId).photo.sourceFiles[0].path;

const orderProductTotal = (orderItem) => (orderItem.products || [])
  .reduce((sum, product) => sum + Number(product.amount || 0), 0);

const catalogOptionCents = (catalog, photoId, optionId) => {
  const entry = catalog.photos.get(photoId);
  const option = catalog.options.get(optionId);
  const origin = String(entry?.photo?.sourceOrigin || entry?.photo?.origin || "").toLowerCase();
  const tier = origin === "ai" || entry?.collectionKey === "ai" ? "ai" : "original";
  return Math.round((Number(option?.prices?.[tier] ?? option?.price ?? 0)) * 100);
};

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

const createFakeEmailClient = ({ fail = false } = {}) => {
  const sent = [];
  return {
    provider: "fake-email",
    sent,
    send: async (email) => {
      sent.push(email);
      if (fail) {
        throw Object.assign(new Error("Email provider unavailable."), {
          code: "fake_email_failed",
        });
      }
      return {
        provider: "fake-email",
        messageId: `msg_${String(sent.length).padStart(3, "0")}`,
        idempotencyKey: email.idempotencyKey,
      };
    },
  };
};

const createPerFileTestDelivery = (now = () => new Date("2026-05-07T12:00:00.000Z")) => ({
  validateOrder: async () => ({ ok: true }),
  createDelivery: async (order) => ({
    readyAt: now().toISOString(),
    files: order.items.flatMap((item) => item.products.map((product) => {
      const safeProduct = String(product.id).replace(/[^A-Za-z0-9_-]+/g, "-");
      const token = `dl_test_${safeProduct}`;
      return {
        token,
        photoId: item.photoId,
        title: item.title,
        productId: product.id,
        productLabel: product.label,
        bucket: "private",
        objectKey: item.source.privateMasterKey,
        name: `${item.photoId}-${safeProduct}.jpg`,
        downloadUrl: `/download/${token}`,
        bytes: 123,
        contentType: "image/jpeg",
      };
    })),
    items: [],
  }),
});

const createFakeR2 = (initial = {}) => {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, {
    body: value.body instanceof Uint8Array ? value.body : new Uint8Array(value.body),
    httpMetadata: value.httpMetadata || {},
    customMetadata: value.customMetadata || {},
  }]));
  return {
    head: async (key) => {
      const value = values.get(key);
      if (!value) return null;
      return {
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        size: value.body.byteLength,
      };
    },
    get: async (key, options = {}) => {
      const value = values.get(key);
      if (!value) return null;
      const range = options.range || null;
      const start = Number.isInteger(range?.offset) ? Math.max(0, range.offset) : 0;
      const end = Number.isInteger(range?.length) ? Math.min(value.body.byteLength, start + range.length) : value.body.byteLength;
      const body = value.body.slice(start, end);
      return {
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        size: value.body.byteLength,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        body,
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
    delete: async (key) => {
      values.delete(key);
    },
    list: async ({ prefix = "", limit = 1000 } = {}) => {
      const objects = [...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit)
        .map(([key, value]) => ({
          key,
          size: value.body.byteLength,
          httpMetadata: value.httpMetadata,
          customMetadata: value.customMetadata,
        }));
      return { objects, truncated: false };
    },
    _debug: values,
  };
};

const createTestJpeg = (width = 64, height = 48) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = Math.round((x / width) * 255);
      data[index + 1] = Math.round((y / height) * 255);
      data[index + 2] = 120;
      data[index + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 90).data;
};

const createFakeImagesBinding = ({ output = createTestJpeg(32, 24), info = { width: 64, height: 48 } } = {}) => {
  const calls = [];
  return {
    calls,
    info: async () => info,
    input: () => {
      const call = { transforms: [], output: null };
      calls.push(call);
      return {
        transform(options = {}) {
          call.transforms.push(options);
          return this;
        },
        output(options = {}) {
          call.output = options;
          return {
            response: () => new Response(output, {
              headers: { "content-type": "image/jpeg" },
            }),
          };
        },
      };
    },
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
  assert.equal(body.order.items[0].products.length, 2);
  assert.equal(body.order.amountExpected, orderProductTotal(body.order.items[0]));
  assert.match(body.checkout.url, /^https:\/\/mock\.stripe\.local\/checkout\/cs_mock_/);
});

test("guest checkout uses current 1 MP price and applies the Stripe minimum when needed", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  const oneMpAmount = catalogOptionCents(catalog, photoId, "jpg-1mp");
  const expectedMinimumAdjustment = Math.max(0, 50 - oneMpAmount);
  assert.equal(body.order.items[0].products[0].amount, oneMpAmount);
  assert.equal(body.order.subtotalAmount, oneMpAmount);
  assert.equal(body.order.minimumChargeAdjustment, expectedMinimumAdjustment);
  assert.equal(body.order.amountExpected, oneMpAmount + expectedMinimumAdjustment);
  const session = stripe._debug.sessions.get(body.checkout.sessionId);
  assert.equal(session.amount_total, oneMpAmount + expectedMinimumAdjustment);
  assert.equal(session.line_items.length, expectedMinimumAdjustment > 0 ? 2 : 1);
});

test("guest checkout rejects stale browser subtotal before Stripe session creation", async () => {
  const catalog = loadCatalog();
  const { worker, stripe } = testWorker();
  const photoId = firstDeliverablePhotoId(catalog);

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
    expectedSubtotalAmount: 800,
  }));
  assert.equal(response.status, 409);

  const body = await response.json();
  assert.equal(body.error.code, "checkout_total_mismatch");
  assert.equal(body.error.details.browserSubtotalAmount, 800);
  assert.equal(body.error.details.workerSubtotalAmount, catalogOptionCents(catalog, photoId, "jpg-1mp"));
  assert.equal(stripe._debug.sessions.size, 0);
});

test("AI collection digital products use the AI price tier", async () => {
  const catalog = createCatalogIndex({
    collections: {
      ai: {
        title: "AI",
        photos: [{
          id: "ai-gallery-test-image",
          title: "AI gallery test image",
          sourceOrigin: "ai",
          megapixels: 12,
          sourceFiles: [{ path: "ai-gallery-test.jpg", type: "JPG" }],
          metadata: [{ label: "Original size", value: "JPEG / 4000 x 3000 / 12 MP" }],
        }],
      },
    },
    resolutions: [
      { id: "full", type: "digital", label: "Full resolution", price: 65, prices: { original: 65, ai: 25 } },
      { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", price: 0.1, prices: { original: 0.1, ai: 0.1 }, minMegapixels: 1 },
    ],
  });
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId: "ai-gallery-test-image", options: [{ id: "full" }, { id: "jpg-1mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.order.items[0].collection, "AI");
  assert.equal(body.order.amountExpected, 2510);
  assert.equal(body.order.items[0].products.find((item) => item.id === "full").amount, 2500);
  assert.equal(body.order.items[0].products.find((item) => item.id === "jpg-1mp").amount, 10);
});

test("sourceOrigin controls digital pricing independently of collection", async () => {
  const catalog = createCatalogIndex({
    collections: {
      france: {
        title: "France",
        photos: [{
          id: "ai-origin-in-camera-gallery",
          title: "AI-origin test image",
          sourceOrigin: "ai",
          megapixels: 12,
          sourceFiles: [{ path: "ai-origin-test.jpg", type: "JPG" }],
          metadata: [{ label: "Original size", value: "JPEG / 4000 x 3000 / 12 MP" }],
        }],
      },
    },
    resolutions: [
      { id: "full", type: "digital", label: "Full resolution", price: 65, prices: { original: 65, ai: 25 } },
      { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", price: 0.1, prices: { original: 0.1, ai: 0.1 }, minMegapixels: 1 },
    ],
  });
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId: "ai-origin-in-camera-gallery", options: [{ id: "full" }, { id: "jpg-1mp" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.order.items[0].collection, "France");
  assert.equal(body.order.amountExpected, 2510);
});

test("video checkout uses the shared flat video price tier", async () => {
  const catalog = createCatalogIndex({
    collections: {
      spain: {
        title: "Spain",
        photos: [{
          id: "video-cordoba-test",
          title: "Cordoba video test",
          media: { type: "video", video: { duration: 12 } },
          duration: 12,
          sourceOrigin: "camera",
          megapixels: 8.3,
          sourceFiles: [{ path: "cordoba.mov", type: "MOV" }],
          metadata: [{ label: "Original size", value: "MOV / 3840 x 2160 / 8.3 MP" }],
        }],
      },
    },
    resolutions: [
      { id: "full", type: "digital", label: "Full resolution", price: 65, prices: { original: 65, ai: 25 } },
    ],
    videoPriceTiers: {
      video_medium: { label: "Video 10-30s", price: 20 },
    },
  });
  const randomUUID = deterministicIds();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID,
    ordersUrl: "https://photosbyelie.test/orders",
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId: "video-cordoba-test", options: [{ id: "video-original" }] }],
  }));
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.order.amountExpected, 2000);
  assert.equal(body.order.items[0].products[0].id, "video-original");
  assert.equal(body.order.items[0].products[0].amount, 2000);
});

test("real Stripe client creates hosted Checkout Sessions with order metadata", async () => {
  let stripeRequest;
  const stripe = createStripeClient({
    secretKey: "sk_test_photosbyelie",
    webhookSecret: "whsec_photosbyelie",
    apiVersion: "2025-12-17",
    fetchImpl: async (url, init) => {
      stripeRequest = { url, init, params: new URLSearchParams(init.body) };
      return new Response(JSON.stringify({
        id: "cs_test_123",
        object: "checkout.session",
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
        payment_intent: "pi_test_123",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const session = await stripe.createCheckoutSession({
    orderId: "PBE-20260508-TEST",
    buyerEmail: "buyer@example.com",
    amountTotal: 5500,
    currency: "usd",
    lineItems: [{
      photoId: "photo-1",
      name: "Photo One - Full resolution",
      quantity: 1,
      unit_amount: 5500,
    }],
    successUrl: "https://photosbyelie.test/order.html?id=PBE-20260508-TEST",
    cancelUrl: "https://photosbyelie.test/basket.html",
    receiptDescription: "PhotosByElie order PBE-20260508-TEST.",
  });

  assert.equal(session.id, "cs_test_123");
  assert.equal(stripeRequest.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(stripeRequest.init.method, "POST");
  assert.match(stripeRequest.init.headers.authorization, /^Basic /);
  assert.equal(stripeRequest.init.headers["stripe-version"], "2025-12-17");
  assert.equal(stripeRequest.init.headers["idempotency-key"], "photosbyelie-checkout-PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("mode"), "payment");
  assert.equal(stripeRequest.params.get("client_reference_id"), "PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("metadata[order_id]"), "PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("payment_intent_data[receipt_email]"), "buyer@example.com");
  assert.equal(stripeRequest.params.get("payment_intent_data[statement_descriptor_suffix]"), "DOWNLOAD");
  assert.equal(stripeRequest.params.get("payment_intent_data[metadata][order_id]"), "PBE-20260508-TEST");
  assert.equal(stripeRequest.params.get("line_items[0][price_data][unit_amount]"), "5500");
  assert.equal(stripeRequest.params.get("line_items[0][price_data][product_data][metadata][photo_id]"), "photo-1");
});

test("real Stripe client verifies raw webhook signatures", async () => {
  const timestamp = 1778241600;
  const payload = JSON.stringify({
    id: "evt_test_123",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_123", metadata: { order_id: "PBE-TEST" } } },
  });
  const signature = await createStripeWebhookSignature({
    payload,
    secret: "whsec_photosbyelie",
    timestamp,
  });
  const stripe = createStripeClient({
    secretKey: "sk_test_photosbyelie",
    webhookSecret: "whsec_photosbyelie",
    fetchImpl: async () => new Response("{}"),
    now: () => new Date(timestamp * 1000),
  });

  const event = await stripe.constructEvent(new Request("https://worker.test/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  }));

  assert.equal(event.id, "evt_test_123");
  assert.equal(event.type, "checkout.session.completed");
  assert.equal(event.data.object.metadata.order_id, "PBE-TEST");
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
  assert.equal(paid.order.amountPaid, checkout.order.amountExpected);
  assert.match(paid.order.delivery.zipKey, /^deliveries\/photosbyelie-order-PBE-20260507-/);
  assert.match(paid.order.delivery.downloadUrl, /^\/download\/dl_/);

  const lookupResponse = await worker.fetch(new Request(`https://worker.test/orders/${paid.order.id}?email=buyer@example.com`));
  assert.equal(lookupResponse.status, 200);
  const lookup = await lookupResponse.json();
  assert.equal(lookup.order.status, "ready");

  const sessionLookupResponse = await worker.fetch(new Request(`https://worker.test/orders/by-session/${checkout.checkout.sessionId}`));
  assert.equal(sessionLookupResponse.status, 200);
  const sessionLookup = await sessionLookupResponse.json();
  assert.equal(sessionLookup.order.id, paid.order.id);
  assert.equal(sessionLookup.order.status, "ready");
});

test("paid checkout sends per-purchased-item delivery email links", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const emailClient = createFakeEmailClient();
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe,
    now,
    randomUUID,
    delivery: createPerFileTestDelivery(now),
    ordersUrl: "https://photos-by-elie.com/order.html",
    downloadBaseUrl: "https://worker.test",
    emailClient,
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }, { id: "jpg-3mp" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.deliveryEmail.status, "sent");
  assert.equal(paid.order.deliveryEmail.directLinkCount, 2);
  assert.equal(emailClient.sent.length, 1);
  const message = emailClient.sent[0];
  assert.equal(message.to, "buyer@example.com");
  assert.match(message.subject, /downloads are ready/);
  assert.match(message.text, /Purchased downloads:\n- .+ - Full resolution: https:\/\/worker\.test\/download\/dl_test_full/);
  assert.match(message.text, /- .+ - JPG 3 MP: https:\/\/worker\.test\/download\/dl_test_jpg-3mp/);
  assert.match(message.text, /Download page \(backup\): https:\/\/photos-by-elie\.com\/order\.html\?id=PBE-20260507-/);
  assert.match(message.text, /email=buyer%40example\.com/);
  const backupUrl = new URL(message.orderUrl);
  assert.equal(backupUrl.searchParams.get("id"), paid.order.id);
  assert.equal(backupUrl.searchParams.get("email"), "buyer@example.com");
  assert.equal(backupUrl.searchParams.get("lookup"), "order");
  assert.match(backupUrl.searchParams.get("cb") || "", new RegExp(`^${paid.order.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(backupUrl.searchParams.has("session_id"), false);
  assert.ok(message.text.indexOf("Purchased downloads:") < message.text.indexOf("Download page (backup):"));
  assert.match(message.html, /<a href="https:\/\/worker\.test\/download\/dl_test_full">[^<]+ - Full resolution<\/a>/);
  assert.match(message.html, /<a href="https:\/\/worker\.test\/download\/dl_test_jpg-3mp">[^<]+ - JPG 3 MP<\/a>/);

  const retryResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(retryResponse.status, 200);
  assert.equal(emailClient.sent.length, 1);

  const resendResponse = await worker.fetch(jsonRequest(`https://worker.test/orders/${paid.order.id}/resend-email`, {
    email: "buyer@example.com",
  }));
  assert.equal(resendResponse.status, 200);
  const resent = await resendResponse.json();
  assert.equal(resent.deliveryEmail.status, "sent");
  assert.equal(resent.deliveryEmail.resendCount, 1);
  assert.equal(resent.deliveryEmail.directLinkCount, 2);
  assert.equal(emailClient.sent.length, 2);
  assert.match(emailClient.sent[1].idempotencyKey, /-resend-/);
  assert.match(emailClient.sent[1].text, /- .+ - Full resolution: https:\/\/worker\.test\/download\/dl_test_full/);

  const wrongEmailResponse = await worker.fetch(jsonRequest(`https://worker.test/orders/${paid.order.id}/resend-email`, {
    email: "not-buyer@example.com",
  }));
  assert.equal(wrongEmailResponse.status, 403);
  assert.equal(emailClient.sent.length, 2);
});

test("delivery email failure does not block paid delivery", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const emailClient = createFakeEmailClient({ fail: true });
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe,
    now,
    randomUUID,
    delivery: createPerFileTestDelivery(now),
    ordersUrl: "https://photos-by-elie.com/order.html",
    downloadBaseUrl: "https://worker.test",
    emailClient,
  });
  const photoId = firstDeliverablePhotoId(catalog);

  const checkoutResponse = await worker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }));
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await worker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }));
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.files.length, 1);
  assert.equal(paid.order.deliveryEmail.status, "failed");
  assert.equal(paid.order.deliveryEmail.error.code, "fake_email_failed");
  assert.equal(emailClient.sent.length, 1);
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

test("download endpoint returns a mock signed R2 URL and allows repeat downloads", async () => {
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
  assert.equal(repeatedResponse.status, 200);
});

test("download endpoint enforces token expiry and download limits", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  let currentNow = new Date("2026-05-07T12:00:00.000Z");
  const worker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => currentNow,
    randomUUID,
    downloadTokenTtlSeconds: 60,
    downloadTokenMaxDownloads: 2,
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
  const paid = await payResponse.json();
  const token = paid.order.delivery.downloadUrl.split("/").pop();

  const firstDownloadResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(firstDownloadResponse.status, 200);
  const firstDownload = await firstDownloadResponse.json();
  assert.equal(firstDownload.download.expiresAt, "2026-05-07T12:01:00.000Z");
  assert.equal((await worker.fetch(new Request(`https://worker.test/download/${token}`))).status, 200);
  const limitedResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(limitedResponse.status, 429);

  const expiringWorker = createPhotosByElieWorker({
    catalog,
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    now: () => currentNow,
    randomUUID,
    downloadTokenTtlSeconds: 60,
  });
  const expiringCheckoutResponse = await expiringWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }));
  const expiringCheckout = await expiringCheckoutResponse.json();
  const expiringPayResponse = await expiringWorker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: expiringCheckout.checkout.sessionId,
  }));
  const expiringPaid = await expiringPayResponse.json();
  const expiringToken = expiringPaid.order.delivery.downloadUrl.split("/").pop();
  currentNow = new Date("2026-05-07T12:01:01.000Z");
  const expiredResponse = await expiringWorker.fetch(new Request(`https://worker.test/download/${expiringToken}`));
  assert.equal(expiredResponse.status, 410);
});

test("local ZIP delivery creates a real ZIP from a developed source", async () => {
  const catalog = loadCatalog();
  const randomUUID = deterministicIds();
  const now = () => new Date("2026-05-07T12:00:00.000Z");
  const stripe = createMockStripeClient({ randomUUID });
  const outputDir = fs.mkdtempSync("/tmp/photosbyelie-deliveries-");
  const sourceRoot = fs.mkdtempSync("/tmp/photosbyelie-sources-");
  const photoId = firstDeliverablePhotoId(catalog);
  const sourcePath = sourcePathForPhoto(catalog, photoId);
  const sourceFile = `${sourceRoot}/${sourcePath}`;
  fs.mkdirSync(sourceFile.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(sourceFile, jpeg.encode({
    data: Buffer.alloc(24 * 24 * 4, 255),
    width: 24,
    height: 24,
  }, 90).data);
  const worker = createPhotosByElieWorker({
    catalog,
    stripe,
    now,
    randomUUID,
    delivery: createLocalZipDelivery({
      repoRoot: new URL("..", import.meta.url).pathname,
      sourceRoots: [sourceRoot],
      outputDir,
      now,
    }),
  });

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
  assert.ok(zip.includes(Buffer.from(`${photoId}-jpg-1mp.jpg`)));
  assert.ok(!zip.includes(Buffer.from(`${photoId}/${photoId}-jpg-1mp.jpg`)));

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(sourceRoot, { recursive: true, force: true });
});

test("deployed Worker mock checkout writes and downloads private R2 files", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const sourcePath = sourcePathForPhoto(catalog, photoId);
  const privateKey = `masters/${photoId}.jpg`;
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
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
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
  assert.equal(paid.order.delivery.files.length, 1);
  assert.equal(paid.order.delivery.files[0].productId, "full");

  const token = paid.order.delivery.files[0].downloadUrl.split("/").pop();
  const downloadResponse = await deployedWorker.fetch(new Request(`https://worker.test/download/${token}`), env);
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "image/jpeg");
  const fileBytes = Buffer.from(await downloadResponse.arrayBuffer());
  assert.ok(fileBytes.includes(Buffer.from("private developed master bytes")));
});

test("deployed Worker renders missing JPG products with Cloudflare Images and caches them", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const privateKey = `masters/${photoId}.jpg`;
  const renderedBytes = createTestJpeg(40, 30);
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: createTestJpeg(120, 80),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const images = createFakeImagesBinding({ output: renderedBytes });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: privateR2,
    DELIVERY_MEDIA: privateR2,
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
    IMAGES: images,
  };

  const checkoutResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "jpg-1mp" }] }],
  }), env);
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();

  const payResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/mock-stripe/pay", {
    checkoutSessionId: checkout.checkout.sessionId,
  }), env);
  assert.equal(payResponse.status, 200);
  const paid = await payResponse.json();
  const renderKey = `renders/${photoId}_1mp.jpg`;
  assert.equal(paid.order.status, "ready");
  assert.equal(paid.order.delivery.files[0].productId, "jpg-1mp");
  assert.equal(paid.order.delivery.files[0].cacheHit, false);
  assert.equal(privateR2._debug.has(renderKey), true);
  assert.equal(privateR2._debug.get(renderKey).customMetadata.watermark, "none");
  assert.equal(images.calls.length, 1);
  assert.equal(images.calls[0].transforms[0].fit, "scale-down");
  assert.equal(images.calls[0].output.format, "image/jpeg");
  assert.equal(images.calls[0].output.quality, 90);
});

test("real-estate originals endpoint creates private download tokens", async () => {
  const photoId = "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043";
  const videoId = "corine-re-2026-la-concha-1-apt-8ab1-video-001";
  const albumSlug = "re-2026-la-concha-1-apt-8ab1";
  const privateKey = `real-estate/corine-real-estate/masters/${albumSlug}/${photoId}.jpg`;
  const privateVideoKey = `real-estate/corine-real-estate/masters/${albumSlug}/${videoId}.mp4`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: new TextEncoder().encode("real estate original bytes"),
      httpMetadata: { contentType: "image/jpeg" },
    },
    [privateVideoKey]: {
      body: new TextEncoder().encode("real estate video bytes"),
      httpMetadata: { contentType: "video/mp4" },
    },
  });
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe: createMockStripeClient({ randomUUID }),
    now: () => new Date("2026-05-17T12:00:00.000Z"),
    randomUUID,
    delivery: createR2ZipDelivery({
      privateBucket: privateR2,
      deliveryBucket: createFakeR2(),
      randomUUID,
    }),
    realEstateOriginals: createRealEstateOriginals({
      privateBucket: privateR2,
      store,
      randomUUID,
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      galleries: [{
        key: "corine-real-estate",
        username: "Corine",
        accessCode: "LaConcha",
        privateMasterPrefix: "real-estate/corine-real-estate/masters",
      }],
    }),
  });

  const sessionResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/originals/session", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
    items: [
      {
        photoId,
        albumSlug,
        sourceFile: "D5H_3043.JPG",
        title: "La Concha 1 Apt 8AB1 - 01",
        sortIndex: 1,
      },
      {
        photoId: videoId,
        albumSlug,
        sourceFile: "VIDEO_001.mp4",
        title: "La Concha 1 Apt 8AB1 - Video",
        sortIndex: 2,
      },
    ],
  }));
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  assert.equal(session.originals.fileCount, 2);
  assert.equal(session.originals.files[0].photoId, photoId);
  assert.equal(session.originals.files[1].photoId, videoId);
  assert.match(session.originals.files[0].downloadUrl, /^\/download\/re_/);

  const token = session.originals.files[0].downloadUrl.split("/").pop();
  const downloadResponse = await worker.fetch(new Request(`https://worker.test/download/${token}`));
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "image/jpeg");
  const fileBytes = Buffer.from(await downloadResponse.arrayBuffer());
  assert.ok(fileBytes.includes(Buffer.from("real estate original bytes")));

  const videoToken = session.originals.files[1].downloadUrl.split("/").pop();
  const videoResponse = await worker.fetch(new Request(`https://worker.test/download/${videoToken}`));
  assert.equal(videoResponse.status, 200);
  assert.equal(videoResponse.headers.get("content-type"), "video/mp4");
  const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
  assert.ok(videoBytes.includes(Buffer.from("real estate video bytes")));
});

test("real-estate originals endpoint rejects the wrong client password", async () => {
  const randomUUID = deterministicIds();
  const store = createMemoryStore();
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store,
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateOriginals: createRealEstateOriginals({
      privateBucket: createFakeR2(),
      store,
      randomUUID,
      galleries: [{
        key: "corine-real-estate",
        username: "Corine",
        accessCode: "LaConcha",
      }],
    }),
  });

  const response = await worker.fetch(jsonRequest("https://worker.test/real-estate/originals/session", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "Wrong",
    items: [{
      photoId: "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043",
      albumSlug: "re-2026-la-concha-1-apt-8ab1",
      sourceFile: "D5H_3043.JPG",
    }],
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "real_estate_auth_required");
});

test("real-estate deliverables endpoint saves and lists client products", async () => {
  const randomUUID = deterministicIds();
  const privateR2 = createFakeR2();
  const worker = createPhotosByElieWorker({
    catalog: loadCatalog(),
    store: createMemoryStore(),
    stripe: createMockStripeClient({ randomUUID }),
    randomUUID,
    realEstateDeliverables: createRealEstateDeliverables({
      privateBucket: privateR2,
      randomUUID,
      now: () => new Date("2026-05-17T12:00:00.000Z"),
      galleries: [{
        key: "corine-real-estate",
        username: "Corine",
        accessCode: "LaConcha",
      }],
    }),
  });
  const deliverable = {
    id: "local-pdf-20260517T120000Z",
    type: "pdf",
    title: "PDF: La Concha 1 Apt 8AB1",
    createdAt: "2026-05-17T12:00:00.000Z",
    filename: "corine-real-estate-la-concha-a4-20260517T120000Z.pdf",
    bytes: 54321,
    batch: {
      batchId: "20260517T120000Z",
      createdAt: "2026-05-17T12:00:00.000Z",
      galleryKey: "corine-real-estate",
      projects: [{
        projectId: "re-2026-la-concha-1-apt-8ab1",
        projectTitle: "La Concha 1 Apt 8AB1",
        items: [{
          photoId: "corine-re-2026-la-concha-1-apt-8ab1-d5h-3043",
          title: "La Concha 1 Apt 8AB1 - 01",
          sortIndex: 1,
        }],
      }],
    },
  };

  const saveResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
    deliverable,
  }));
  assert.equal(saveResponse.status, 201);
  const saved = await saveResponse.json();
  assert.equal(saved.deliverable.id, deliverable.id);
  assert.equal(saved.deliverable.batch.batchId, deliverable.batch.batchId);

  const listResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
  }));
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.count, 1);
  assert.equal(listed.deliverables[0].id, deliverable.id);
  assert.equal(listed.deliverables[0].filename, deliverable.filename);

  const deleteResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/delete", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
    id: deliverable.id,
  }));
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(deleted.id, deliverable.id);
  assert.equal(deleted.deleted, true);

  const afterDeleteResponse = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "LaConcha",
  }));
  assert.equal(afterDeleteResponse.status, 200);
  const afterDelete = await afterDeleteResponse.json();
  assert.equal(afterDelete.count, 0);

  const wrongPassword = await worker.fetch(jsonRequest("https://worker.test/real-estate/deliverables/list", {
    galleryKey: "corine-real-estate",
    username: "Corine",
    accessCode: "Wrong",
  }));
  assert.equal(wrongPassword.status, 403);
});

test("deployed Worker blocks checkout when private delivery files are missing", async () => {
  const catalog = loadCatalog();
  const photoId = firstDeliverablePhotoId(catalog);
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };

  const checkoutResponse = await deployedWorker.fetch(jsonRequest("https://worker.test/checkout/guest", {
    email: "buyer@example.com",
    items: [{ photoId, options: [{ id: "full" }] }],
  }), env);
  assert.equal(checkoutResponse.status, 409);
  const body = await checkoutResponse.json();
  assert.equal(body.error.code, "delivery_assets_unavailable");
  assert.equal(body.error.details.missing[0].code, "missing_private_master");
});

test("R2 ZIP delivery renders and privately caches JPG products", async () => {
  const photoId = "photo-1";
  const privateKey = `masters/${photoId}.jpg`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: createTestJpeg(),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  let renderCount = 0;
  const delivery = createR2ZipDelivery({
    privateBucket: privateR2,
    deliveryBucket: privateR2,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID: deterministicIds(),
    renderer: {
      canRender: (productId) => productId === "jpg-3mp",
      render: async () => {
        renderCount += 1;
        return createTestJpeg(32, 24);
      },
    },
  });
  const order = {
    id: "PBE-TEST",
    buyerEmail: "buyer@example.com",
    currency: "usd",
    amountPaid: 5500,
    amountExpected: 5500,
    items: [{
      photoId,
      title: "Private source",
      source: {
        path: "source.jpg",
        privateMasterKey: privateKey,
        dimensions: { width: 64, height: 48 },
      },
      products: [
        { id: "full", label: "Full resolution" },
        { id: "jpg-3mp", label: "JPG 3 MP" },
      ],
    }],
  };

  const firstDelivery = await delivery.createDelivery(order);
  const secondDelivery = await delivery.createDelivery({ ...order, id: "PBE-TEST-2" });
  assert.equal(renderCount, 1);
  assert.equal(firstDelivery.items.find((item) => item.products.includes("jpg-3mp")).cacheHit, false);
  assert.equal(secondDelivery.items.find((item) => item.products.includes("jpg-3mp")).cacheHit, true);
  const renderKeys = Array.from(privateR2._debug.keys()).filter((key) => key.startsWith(`renders/${photoId}_`));
  assert.equal(renderKeys.length, 1);
  assert.equal(renderKeys[0], `renders/${photoId}_3mp.jpg`);
  assert.equal(privateR2._debug.get(renderKeys[0]).httpMetadata.contentType, "image/jpeg");
  assert.equal(privateR2._debug.get(renderKeys[0]).customMetadata.watermark, "none");
  assert.deepEqual(firstDelivery.files.map((file) => file.name), [`${photoId}-full.jpg`, `${photoId}-jpg-3mp.jpg`]);
  assert.equal(firstDelivery.files[1].objectKey, renderKeys[0]);
  assert.equal(firstDelivery.files[1].downloadUrl.startsWith("/download/"), true);
});

test("R2 ZIP delivery does not fall back to legacy private masters", async () => {
  const photoId = "photo-legacy";
  const flatKey = `masters/${photoId}.jpg`;
  const legacyKey = `masters/${photoId}/source.jpg`;
  const privateR2 = createFakeR2({
    [legacyKey]: {
      body: createTestJpeg(),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const delivery = createR2ZipDelivery({
    privateBucket: privateR2,
    deliveryBucket: privateR2,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID: deterministicIds(),
  });

  await assert.rejects(() => delivery.createDelivery({
    id: "PBE-LEGACY",
    buyerEmail: "buyer@example.com",
    currency: "usd",
    amountPaid: 6500,
    amountExpected: 6500,
    items: [{
      photoId,
      title: "Legacy source",
      source: {
        path: "source.jpg",
        privateMasterKey: flatKey,
      },
      products: [{ id: "full", label: "Full resolution" }],
    }],
  }), (error) => error?.code === "missing_private_master" && error?.status === 409);
});

test("R2 ZIP delivery reuses cached JPG products without reading the private master", async () => {
  const photoId = "20220506-160631-03403-51426edaac";
  const privateKey = `masters/${photoId}.jpg`;
  const renderKey = `renders/${photoId}_3mp.jpg`;
  const privateR2 = createFakeR2({
    [privateKey]: {
      body: createTestJpeg(120, 80),
      httpMetadata: { contentType: "image/jpeg" },
    },
    [renderKey]: {
      body: createTestJpeg(60, 40),
      httpMetadata: { contentType: "image/jpeg" },
    },
  });
  const originalGet = privateR2.get;
  let masterReads = 0;
  privateR2.get = async (key) => {
    const object = await originalGet(key);
    if (!object || key !== privateKey) return object;
    return {
      ...object,
      arrayBuffer: async () => {
        masterReads += 1;
        return object.arrayBuffer();
      },
    };
  };

  const delivery = createR2ZipDelivery({
    privateBucket: privateR2,
    deliveryBucket: privateR2,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    randomUUID: deterministicIds(),
    renderer: {
      canRender: () => true,
      render: async () => {
        throw new Error("Renderer should not be called for a cached private JPG.");
      },
    },
  });
  const order = {
    id: "PBE-CACHED",
    buyerEmail: "buyer@example.com",
    currency: "usd",
    amountPaid: 1600,
    amountExpected: 1600,
    items: [{
      photoId,
      title: "Les Invalides, Paris",
      source: {
        path: "2022/JPG/05/06/20220506 160631 03403.jpg",
        privateMasterKey: privateKey,
        dimensions: { width: 6000, height: 4000 },
      },
      products: [
        { id: "jpg-3mp", label: "JPG 3 MP" },
      ],
    }],
  };

  const result = await delivery.createDelivery(order);
  assert.equal(masterReads, 0);
  assert.equal(result.items[0].cacheHit, true);
  assert.equal(result.items[0].renderKey, renderKey);
  assert.equal(result.files[0].name, `${photoId}-jpg-3mp.jpg`);
  assert.equal(result.files[0].objectKey, renderKey);
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
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };

  const response = await deployedWorker.fetch(new Request("https://worker.test/media/expo/france/sample_900.jpg"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("hex"), "ffd8ffd9");
});

test("deployed Worker serves public R2 media byte ranges", async () => {
  const publicR2 = createFakeR2({
    "assets/music/slideshow-guitar/pixabay/sample.mp3": {
      body: new Uint8Array([0, 1, 2, 3, 4, 5]),
      httpMetadata: { contentType: "audio/mpeg" },
    },
  });
  const env = {
    ORDERS_KV: createFakeKv(),
    PRIVATE_MEDIA: createFakeR2(),
    PUBLIC_MEDIA: publicR2,
    DELIVERY_MEDIA: createFakeR2(),
    PUBLIC_SITE_URL: "https://photos-by-elie.com",
  };

  const response = await deployedWorker.fetch(new Request("https://worker.test/media/assets/music/slideshow-guitar/pixabay/sample.mp3", {
    headers: { range: "bytes=1-3" },
  }), env);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("content-range"), "bytes 1-3/6");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("hex"), "010203");
});
