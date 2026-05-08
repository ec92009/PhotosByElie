import { createMemoryStore } from "./memory-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";

const ORDER_CURRENCY = "usd";
const DOWNLOAD_RATE_LIMIT_MS = 60 * 60 * 1000;
const RAW_SOURCE_TYPES = new Set(["DNG", "NEF", "CR2", "CR3", "ARW", "RAF", "ORF", "RW2", "RAW", "PEF", "SRW", "RWL"]);

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,stripe-signature,x-mock-stripe-signature",
    ...headers,
  },
});

const errorJson = (status, code, message, details = undefined) => json({ error: { code, message, details } }, status);

const parseJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400, code: "invalid_json" });
  }
};

const cents = (dollars) => Math.round(Number(dollars || 0) * 100);

const basename = (value) => String(value || "").split(/[\\/]/).pop();

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const defaultNow = () => new Date();

const defaultRandomUUID = () => crypto.randomUUID();

const orderDate = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");

const createOrderId = (now, randomUUID) => `PBE-${orderDate(now())}-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const sourceType = (source) => String(source?.type || basename(source?.path).split(".").pop() || "").toUpperCase();

const originalSize = (photo) => {
  const fromMetadata = (photo?.metadata || []).find((item) => item.label === "Original size")?.value;
  return fromMetadata || (photo?.megapixels ? `${photo.megapixels} MP source` : "Source size unverified");
};

const originalDimensions = (photo) => {
  const value = originalSize(photo);
  const match = String(value).match(/(\d+)\s*x\s*(\d+)/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};

const verifiedMegapixels = (photo) => {
  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) return Number(photo.megapixels) || 0;
  const preview = (photo?.metadata || []).find((item) => item.label === "Preview file")?.value || "";
  const match = preview.match(/(\d+)\s*x\s*(\d+)/i);
  return match ? Math.round((Number(match[1]) * Number(match[2]) / 1_000_000) * 10) / 10 : 0;
};

const publicCatalogOnly = (collections = {}) => Object.fromEntries(
  Object.entries(collections).filter(([key]) => key !== "unknown")
);

export const createCatalogIndex = ({
  collections = {},
  resolutions = [],
  frameOptions = [],
  physicalProductsEnabled = false,
} = {}) => {
  const photos = new Map();
  const options = new Map(resolutions.map((option) => [option.id, option]));

  Object.entries(publicCatalogOnly(collections)).forEach(([collectionKey, collection]) => {
    (collection.photos || []).forEach((photo) => {
      photos.set(photo.id, { photo, collectionKey, collectionTitle: collection.title || collectionKey });
    });
  });

  const availableOptionsFor = (photo) => {
    const megapixels = verifiedMegapixels(photo);
    if (!megapixels) return [];
    return resolutions.filter((option) =>
      (physicalProductsEnabled || option.type !== "print")
      && (!option.minMegapixels || megapixels >= Number(option.minMegapixels))
    );
  };

  return {
    photos,
    options,
    frameOptions,
    availableOptionsFor,
  };
};

const normalizeOrderItems = (catalog, incomingItems = []) => {
  if (!Array.isArray(incomingItems) || incomingItems.length === 0) {
    throw Object.assign(new Error("Checkout requires at least one basket item."), { status: 400, code: "empty_basket" });
  }

  const byPhoto = new Map();
  incomingItems.forEach((item) => {
    if (!item?.photoId) return;
    const existing = byPhoto.get(item.photoId) || { photoId: item.photoId, options: [] };
    existing.options.push(...(Array.isArray(item.options) ? item.options : []));
    byPhoto.set(item.photoId, existing);
  });

  const orderItems = [];
  for (const item of byPhoto.values()) {
    const entry = catalog.photos.get(item.photoId);
    if (!entry) {
      throw Object.assign(new Error(`Unknown photo id: ${item.photoId}`), { status: 400, code: "unknown_photo" });
    }

    const { photo, collectionKey, collectionTitle } = entry;
    const availableIds = new Set(catalog.availableOptionsFor(photo).map((option) => option.id));
    const source = (photo.sourceFiles || []).find((candidate) => !RAW_SOURCE_TYPES.has(sourceType(candidate)));
    if (!source) {
      throw Object.assign(new Error(`Photo ${photo.id} does not have a developed source master for delivery.`), {
        status: 409,
        code: "missing_developed_master",
      });
    }

    const seenOptions = new Set();
    const options = [];
    for (const rawOption of item.options || []) {
      const optionId = typeof rawOption === "string" ? rawOption : rawOption?.id;
      const catalogOption = catalog.options.get(optionId);
      if (!catalogOption || !availableIds.has(optionId) || seenOptions.has(optionId)) continue;
      seenOptions.add(optionId);
      if (catalogOption.type !== "digital") {
        throw Object.assign(new Error(`Product ${optionId} is not supported by digital ZIP delivery yet.`), {
          status: 409,
          code: "unsupported_product_type",
        });
      }
      options.push({
        id: catalogOption.id,
        type: "digital",
        label: catalogOption.label,
        detail: catalogOption.id === "full" ? `Original: ${originalSize(photo)}` : catalogOption.detail,
        quantity: 1,
        unitAmount: cents(catalogOption.price),
        amount: cents(catalogOption.price),
      });
    }

    if (!options.length) {
      throw Object.assign(new Error(`Photo ${photo.id} has no selected deliverable products.`), {
        status: 400,
        code: "no_deliverable_products",
      });
    }

    orderItems.push({
      photoId: photo.id,
      title: photo.title,
      collectionKey,
      collectionTitle,
      source: {
        type: sourceType(source),
        path: source.path,
        privateMasterKey: `masters/${photo.id}/${basename(source.path)}`,
        dimensions: originalDimensions(photo),
      },
      publicPreview: photo.media?.publicPreview || null,
      products: options,
      subtotal: options.reduce((sum, option) => sum + option.amount, 0),
    });
  }

  return orderItems;
};

const publicOrder = (order) => ({
  id: order.id,
  status: order.status,
  checkoutMode: order.checkoutMode,
  buyerEmail: order.buyerEmail,
  currency: order.currency,
  amountExpected: order.amountExpected,
  amountPaid: order.amountPaid || 0,
  items: order.items.map((item) => ({
    photoId: item.photoId,
    title: item.title,
    collection: item.collectionTitle,
    products: item.products.map((product) => ({
      id: product.id,
      label: product.label,
      amount: product.amount,
    })),
    subtotal: item.subtotal,
  })),
  delivery: order.delivery ? {
    zipKey: order.delivery.zipKey,
    downloadUrl: order.delivery.downloadUrl,
    readyAt: order.delivery.readyAt,
  } : null,
  deliveryError: order.deliveryError ? {
    code: order.deliveryError.code || "delivery_failed",
    message: order.deliveryError.message || "Delivery could not be generated.",
    failedAt: order.deliveryError.failedAt || null,
  } : null,
  stripe: {
    checkoutSessionId: order.checkoutSessionId,
    paymentIntentId: order.paymentIntentId || null,
  },
  createdAt: order.createdAt,
  paidAt: order.paidAt || null,
  updatedAt: order.updatedAt,
});

const defaultDelivery = ({ now, randomUUID } = {}) => ({
  createDelivery: async (order) => {
    const token = `dl_${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const zipKey = `deliveries/photosbyelie-order-${order.id}.zip`;
    return {
      zipKey,
      token,
      downloadUrl: `/download/${token}`,
      readyAt: now().toISOString(),
      items: order.items.map((item) => ({
        photoId: item.photoId,
        products: item.products.map((product) => product.id),
        sourceKey: item.source.privateMasterKey,
      })),
    };
  },
});

export const createPhotosByElieWorker = ({
  catalog,
  store = createMemoryStore(),
  stripe = createMockStripeClient(),
  delivery,
  now = defaultNow,
  randomUUID = defaultRandomUUID,
  ordersUrl = "https://photosbyelie.com/orders",
  successUrl = "https://photosbyelie.com/orders/{ORDER_ID}?checkout=success",
  cancelUrl = "https://photosbyelie.com/basket.html?checkout=cancelled",
  mockStripeEnabled = true,
} = {}) => {
  if (!catalog) throw new Error("createPhotosByElieWorker requires a catalog index.");
  const deliveryClient = delivery || defaultDelivery({ now, randomUUID });

  const createCheckout = async (request, checkoutMode) => {
    const payload = await parseJson(request);
    const buyerEmail = String(payload.email || payload.buyerEmail || "").trim().toLowerCase();
    if (!validEmail(buyerEmail)) {
      return errorJson(400, "invalid_email", "Checkout requires a valid buyer email.");
    }

    const items = normalizeOrderItems(catalog, payload.items || payload.basket || []);
    const amountExpected = items.reduce((sum, item) => sum + item.subtotal, 0);
    const createdAt = now().toISOString();
    const orderId = createOrderId(now, randomUUID);
    const receiptDescription = [
      `PhotosByElie order ${orderId}.`,
      `Your download is usually ready within about 10 minutes at ${ordersUrl}.`,
      `Use order number ${orderId} and the email used at checkout.`,
    ].join(" ");

    const checkoutSession = await stripe.createCheckoutSession({
      orderId,
      buyerEmail,
      amountTotal: amountExpected,
      currency: ORDER_CURRENCY,
      lineItems: items.flatMap((item) => item.products.map((product) => ({
        photoId: item.photoId,
        name: `${item.title} - ${product.label}`,
        quantity: 1,
        unit_amount: product.unitAmount,
        amount: product.amount,
      }))),
      successUrl: successUrl.replace("{ORDER_ID}", encodeURIComponent(orderId)),
      cancelUrl,
      receiptDescription,
    });

    const order = {
      id: orderId,
      status: "pending_payment",
      checkoutMode,
      buyerEmail,
      currency: ORDER_CURRENCY,
      amountExpected,
      amountPaid: 0,
      items,
      checkoutSessionId: checkoutSession.id,
      paymentIntentId: checkoutSession.payment_intent,
      receiptDescription,
      createdAt,
      updatedAt: createdAt,
    };
    await store.putOrder(order);

    return json({
      order: publicOrder(order),
      checkout: {
        provider: "mock-stripe",
        sessionId: checkoutSession.id,
        url: checkoutSession.url,
      },
    }, 201);
  };

  const markOrderPaidAndFulfill = async (session) => {
    const orderId = session.metadata?.order_id || session.client_reference_id;
    if (!orderId) throw Object.assign(new Error("Stripe session did not include an order id."), { status: 400, code: "missing_order_id" });

    const order = await store.getOrder(orderId);
    if (!order) throw Object.assign(new Error(`No order exists for ${orderId}.`), { status: 404, code: "unknown_order" });

    if (order.checkoutSessionId !== session.id) {
      throw Object.assign(new Error("Stripe session does not match the stored order."), { status: 409, code: "checkout_session_mismatch" });
    }
    if (session.payment_status !== "paid") {
      throw Object.assign(new Error("Stripe session is not paid."), { status: 409, code: "payment_not_paid" });
    }
    if (Number(session.amount_total) !== Number(order.amountExpected) || String(session.currency).toLowerCase() !== order.currency) {
      throw Object.assign(new Error("Stripe paid amount/currency does not match the order."), { status: 409, code: "amount_mismatch" });
    }

    if (order.status === "ready") return order;

    const paidAt = now().toISOString();
    const preparing = {
      ...order,
      status: "preparing",
      amountPaid: Number(session.amount_total),
      buyerEmail: String(session.customer_details?.email || order.buyerEmail).toLowerCase(),
      paymentIntentId: session.payment_intent || order.paymentIntentId,
      paidAt,
      updatedAt: paidAt,
    };
    await store.putOrder(preparing);

    let deliveryResult;
    try {
      deliveryResult = await deliveryClient.createDelivery(preparing);
    } catch (error) {
      const failedAt = now().toISOString();
      const failed = {
        ...preparing,
        status: "delivery_failed",
        deliveryError: {
          code: error?.code || "delivery_failed",
          message: error?.message || "Delivery could not be generated.",
          failedAt,
        },
        updatedAt: failedAt,
      };
      await store.putOrder(failed);
      throw error;
    }
    const readyAt = now().toISOString();
    const ready = {
      ...preparing,
      status: "ready",
      delivery: {
        zipKey: deliveryResult.zipKey,
        downloadUrl: deliveryResult.downloadUrl,
        readyAt: deliveryResult.readyAt || readyAt,
        items: deliveryResult.items || [],
      },
      updatedAt: readyAt,
    };
    await store.putOrder(ready);
    await store.putDownload({
      token: deliveryResult.token,
      orderId: ready.id,
      zipKey: deliveryResult.zipKey,
      createdAt: readyAt,
      downloadCount: 0,
    });
    return ready;
  };

  const stripeWebhook = async (request) => {
    let event;
    try {
      event = await stripe.constructEvent(request);
    } catch (error) {
      return errorJson(400, "invalid_webhook_signature", error.message);
    }
    if (event.type !== "checkout.session.completed") {
      return json({ received: true, ignored: true, type: event.type });
    }
    try {
      const order = await markOrderPaidAndFulfill(event.data.object);
      return json({ received: true, order: publicOrder(order) });
    } catch (error) {
      return errorJson(error.status || 500, error.code || "webhook_failed", error.message);
    }
  };

  const mockPay = async (request) => {
    if (!mockStripeEnabled || typeof stripe.paidEventForSession !== "function") {
      return errorJson(404, "not_found", "Mock Stripe payment endpoint is disabled.");
    }
    const payload = await parseJson(request);
    const sessionId = payload.checkoutSessionId || payload.sessionId;
    if (!sessionId) return errorJson(400, "missing_session_id", "Mock payment requires checkoutSessionId.");
    try {
      let event;
      try {
        event = stripe.paidEventForSession(sessionId, payload.overrides || {});
      } catch (error) {
        const order = await store.getOrderByCheckoutSessionId?.(sessionId);
        if (!order) throw error;
        event = {
          id: `evt_mock_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          object: "event",
          type: "checkout.session.completed",
          created: Math.floor(now().getTime() / 1000),
          data: {
            object: {
              id: sessionId,
              object: "checkout.session",
              client_reference_id: order.id,
              metadata: { order_id: order.id },
              payment_status: "paid",
              amount_total: order.amountExpected,
              currency: order.currency,
              customer_details: { email: order.buyerEmail },
              payment_intent: order.paymentIntentId || `pi_mock_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              ...payload.overrides,
            },
          },
        };
      }
      const order = await markOrderPaidAndFulfill(event.data.object);
      return json({ event, order: publicOrder(order) });
    } catch (error) {
      return errorJson(error.status || 500, error.code || "mock_payment_failed", error.message);
    }
  };

  const getOrder = async (request, orderId) => {
    const url = new URL(request.url);
    const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
    const order = await store.getOrder(orderId);
    if (!order) return errorJson(404, "unknown_order", "Order was not found.");
    if (email !== order.buyerEmail) {
      return errorJson(403, "order_email_required", "Enter the email used at checkout to view this order.");
    }
    return json({ order: publicOrder(order) });
  };

  const download = async (_request, token) => {
    const downloadRecord = await store.getDownload(token);
    if (!downloadRecord) return errorJson(404, "unknown_download", "Download link was not found.");
    const nowDate = now();
    if (downloadRecord.lastDownloadAt && nowDate.getTime() - new Date(downloadRecord.lastDownloadAt).getTime() < DOWNLOAD_RATE_LIMIT_MS) {
      return errorJson(429, "download_rate_limited", "This order was downloaded recently. Try again later.");
    }
    await store.recordDownload(token, nowDate.toISOString());
    if (typeof deliveryClient.getDownloadResponse === "function") {
      return deliveryClient.getDownloadResponse(downloadRecord);
    }
    return json({
      download: {
        orderId: downloadRecord.orderId,
        zipKey: downloadRecord.zipKey,
        localZipPath: String(downloadRecord.zipKey || "").startsWith("/") ? downloadRecord.zipKey : null,
        expiresInSeconds: 900,
        mockSignedUrl: `mock-r2://${downloadRecord.zipKey}?token=${encodeURIComponent(token)}`,
      },
    });
  };

  const fetch = async (request) => {
    if (request.method === "OPTIONS") return json({ ok: true });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, "");

    try {
      if (request.method === "GET" && path === "/health") {
        return json({ ok: true, service: "photosbyelie-worker", stripe: "mock", currency: ORDER_CURRENCY });
      }
      if (request.method === "POST" && path === "/checkout/guest") return createCheckout(request, "guest");
      if (request.method === "POST" && path === "/checkout/account") return createCheckout(request, "account");
      if (request.method === "POST" && path === "/stripe-webhook") return stripeWebhook(request);
      if (request.method === "POST" && path === "/mock-stripe/pay") return mockPay(request);
      const orderMatch = path.match(/^\/orders\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) return getOrder(request, decodeURIComponent(orderMatch[1]));
      const downloadMatch = path.match(/^\/download\/([^/]+)$/);
      if (request.method === "GET" && downloadMatch) return download(request, decodeURIComponent(downloadMatch[1]));
    } catch (error) {
      return errorJson(error.status || 500, error.code || "worker_error", error.message);
    }
    return errorJson(404, "not_found", "Worker route was not found.");
  };

  return {
    fetch,
    markOrderPaidAndFulfill,
    store,
    stripe,
  };
};

export default {
  fetch(request, env = {}) {
    const worker = createPhotosByElieWorker(env);
    return worker.fetch(request);
  },
};
