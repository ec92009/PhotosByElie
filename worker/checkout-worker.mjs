import { createMemoryStore } from "./memory-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";

const ORDER_CURRENCY = "usd";
const MINIMUM_CHARGE_AMOUNT = 50;
const MINIMUM_CHARGE_PRODUCT_ID = "minimum-charge-adjustment";
const RAW_SOURCE_TYPES = new Set(["DNG", "NEF", "CR2", "CR3", "ARW", "RAF", "ORF", "RW2", "RAW", "PEF", "SRW", "RWL"]);
const DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_DOWNLOAD_TOKEN_MAX_DOWNLOADS = 100;

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

const normalizedExtension = (value, fallback = "jpg") => {
  const extension = String(value || fallback).trim().toLowerCase().replace(/^\./, "");
  if (extension === "jpeg" || extension === "jpe") return "jpg";
  if (extension === "tiff") return "tif";
  if (extension === "m4v") return "mp4";
  return extension || fallback;
};

const sourceExtension = (source) =>
  normalizedExtension(source?.type || basename(source?.path).split(".").pop() || "jpg");

const privateMasterKeyFor = (photo, source) => `masters/${photo.id}.${sourceExtension(source)}`;

const legacyPrivateMasterKeyFor = (photo, source) => `masters/${photo.id}/${basename(source.path)}`;

const photoOriginFor = (photo, collectionKey) => {
  const origin = String(photo?.sourceOrigin || photo?.origin || "").toLowerCase();
  if (origin === "ai" || origin === "camera") return origin;
  if (String(photo?.pricingTier || "").toLowerCase() === "ai") return "ai";
  return collectionKey === "ai" ? "ai" : "camera";
};

const pricingTierFor = (photo, collectionKey) => photoOriginFor(photo, collectionKey) === "ai" ? "ai" : "original";

const optionPriceFor = (photo, collectionKey, option) =>
  Number(option?.prices?.[pricingTierFor(photo, collectionKey)] ?? option?.price ?? 0);

const mediaTypeFor = (photo) => String(photo?.media?.type || photo?.type || "photo").toLowerCase();

const videoTierFor = (photo) => {
  const duration = Number(photo?.media?.video?.duration || photo?.duration || 0);
  if (duration < 10) return "video_short";
  if (duration < 30) return "video_medium";
  if (duration < 60) return "video_long";
  if (duration < 180) return "video_extended";
  return "video_premium";
};

const videoDownloadOptionFor = (photo, videoPriceTiers = {}) => {
  const tier = videoTierFor(photo);
  const priceTier = videoPriceTiers?.[tier] || { price: 20 };
  return {
    id: "video-original",
    type: "video",
    label: "Original video download",
    detail: "Private original video file after purchase",
    price: Number(priceTier.price) || 0,
    priceKey: tier,
  };
};

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const defaultNow = () => new Date();

const defaultRandomUUID = () => crypto.randomUUID();

const orderDate = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");

const createOrderId = (now, randomUUID) => `PBE-${orderDate(now())}-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const sourceType = (source) => String(source?.type || basename(source?.path).split(".").pop() || "").toUpperCase();

const checkoutLineName = (title, label, maxLength = 180) => {
  const value = `${title || "Photo"} - ${label || "Digital asset"}`.replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
};

const minimumChargeAdjustmentFor = (subtotalAmount) =>
  subtotalAmount > 0 && subtotalAmount < MINIMUM_CHARGE_AMOUNT ? MINIMUM_CHARGE_AMOUNT - subtotalAmount : 0;

const originalSize = (photo) => {
  const fromMetadata = (photo?.metadata || []).find((item) => item.label === "Original size")?.value;
  return fromMetadata || (photo?.megapixels ? `${photo.megapixels} MP source` : "Source size unverified");
};

const originalDimensions = (photo) => {
  const value = originalSize(photo);
  const match = String(value).match(/(\d+)\s*x\s*(\d+)/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};

const metadataValue = (photo, label) =>
  (photo?.metadata || []).find((item) => item.label === label)?.value || "";

const splitKeywords = (value) => {
  if (Array.isArray(value)) return value.flatMap(splitKeywords);
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const keywordsForPhoto = (photo) => {
  const seen = new Set();
  return splitKeywords(photo?.keywords || metadataValue(photo, "Keywords")).filter((keyword) => {
    const normalized = keyword.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
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
  videoPriceTiers = {},
  physicalProductsEnabled = false,
} = {}) => {
  const photos = new Map();
  const options = new Map([
    ...resolutions.map((option) => [option.id, option]),
    ["video-original", { id: "video-original", type: "video", label: "Original video download" }],
  ]);

  Object.entries(publicCatalogOnly(collections)).forEach(([collectionKey, collection]) => {
    (collection.photos || []).forEach((photo) => {
      photos.set(photo.id, { photo, collectionKey, collectionTitle: collection.title || collectionKey });
    });
  });

  const availableOptionsFor = (photo) => {
    if (mediaTypeFor(photo) === "video") return [videoDownloadOptionFor(photo, videoPriceTiers)];
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
    videoPriceTiers,
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
    const sourceOrigin = photoOriginFor(photo, collectionKey);
    const availableOptions = catalog.availableOptionsFor(photo);
    const availableById = new Map(availableOptions.map((option) => [option.id, option]));
    const availableIds = new Set(availableById.keys());
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
      const catalogOption = availableById.get(optionId) || catalog.options.get(optionId);
      if (!catalogOption || !availableIds.has(optionId) || seenOptions.has(optionId)) continue;
      seenOptions.add(optionId);
      if (!["digital", "video"].includes(catalogOption.type)) {
        throw Object.assign(new Error(`Product ${optionId} is not supported by digital ZIP delivery yet.`), {
          status: 409,
          code: "unsupported_product_type",
        });
      }
      const optionPrice = catalogOption.type === "video"
        ? Number(catalogOption.price) || 0
        : optionPriceFor(photo, collectionKey, catalogOption);
      options.push({
        id: catalogOption.id,
        type: catalogOption.type === "video" ? "video" : "digital",
        label: catalogOption.label,
        detail: catalogOption.id === "full" ? `Original: ${originalSize(photo)}` : catalogOption.detail,
        quantity: 1,
        unitAmount: cents(optionPrice),
        amount: cents(optionPrice),
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
      keywords: keywordsForPhoto(photo),
      collectionKey,
      collectionTitle,
      sourceOrigin,
      source: {
        type: sourceType(source),
        path: source.path,
        privateMasterKey: privateMasterKeyFor(photo, source),
        privateMasterKeys: [
          privateMasterKeyFor(photo, source),
          legacyPrivateMasterKeyFor(photo, source),
        ].filter((key, index, keys) => key && keys.indexOf(key) === index),
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
  subtotalAmount: order.subtotalAmount ?? order.amountExpected,
  minimumChargeAdjustment: order.minimumChargeAdjustment || 0,
  amountExpected: order.amountExpected,
  amountPaid: order.amountPaid || 0,
  items: order.items.map((item) => ({
    photoId: item.photoId,
    title: item.title,
    keywords: item.keywords || [],
    collection: item.collectionTitle,
    sourceOrigin: item.sourceOrigin || "camera",
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
    files: (order.delivery.files || []).map((file) => ({
      photoId: file.photoId,
      productId: file.productId,
      productLabel: file.productLabel,
      name: file.name,
      downloadUrl: file.downloadUrl,
      bytes: file.bytes || 0,
      contentType: file.contentType || "application/octet-stream",
      cacheHit: file.cacheHit,
      expiresAt: file.expiresAt || null,
      downloadLimit: Number(file.downloadLimit || 0) || null,
    })),
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

const boundedPositiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
};

const isoAfterSeconds = (date, seconds) =>
  new Date(date.getTime() + (boundedPositiveInteger(seconds, 0) * 1000)).toISOString();

const isExpiredAt = (value, nowDate) => {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= nowDate.getTime();
};

const downloadLimitReached = (record) => {
  const limit = Number(record?.downloadLimit || 0);
  return Number.isFinite(limit) && limit > 0 && Number(record.downloadCount || 0) >= limit;
};

const withDownloadPolicy = (file, { expiresAt, downloadLimit }) => ({
  ...file,
  expiresAt,
  downloadLimit,
});

const appendDownloadEvent = (order, record, downloadedAt) => {
  const event = {
    token: record.token,
    photoId: record.photoId || null,
    productId: record.productId || null,
    filename: record.filename || null,
    downloadedAt,
    downloadCount: Number(record.downloadCount || 0) + 1,
  };
  const downloadEvents = [...(Array.isArray(order.downloadEvents) ? order.downloadEvents : []), event].slice(-100);
  const next = {
    ...order,
    downloadEvents,
    updatedAt: downloadedAt,
  };
  if (next.delivery?.files?.length && record.photoId && record.productId) {
    next.delivery = {
      ...next.delivery,
      files: next.delivery.files.map((file) =>
        file.photoId === record.photoId && file.productId === record.productId
          ? {
            ...file,
            downloadCount: event.downloadCount,
            lastDownloadAt: downloadedAt,
          }
          : file
      ),
    };
  }
  return next;
};

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
  realEstateOriginals = null,
  downloadTokenTtlSeconds = DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
  downloadTokenMaxDownloads = DEFAULT_DOWNLOAD_TOKEN_MAX_DOWNLOADS,
} = {}) => {
  if (!catalog) throw new Error("createPhotosByElieWorker requires a catalog index.");
  const deliveryClient = delivery || defaultDelivery({ now, randomUUID });
  const stripeProvider = stripe.provider || "stripe";
  const downloadPolicy = () => {
    const nowDate = now();
    const ttlSeconds = boundedPositiveInteger(downloadTokenTtlSeconds, DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS);
    return {
      expiresAt: isoAfterSeconds(nowDate, ttlSeconds),
      downloadLimit: boundedPositiveInteger(downloadTokenMaxDownloads, DEFAULT_DOWNLOAD_TOKEN_MAX_DOWNLOADS),
    };
  };

  const createCheckout = async (request, checkoutMode) => {
    const payload = await parseJson(request);
    const buyerEmail = String(payload.email || payload.buyerEmail || "").trim().toLowerCase();
    if (!validEmail(buyerEmail)) {
      return errorJson(400, "invalid_email", "Checkout requires a valid buyer email.");
    }

    const items = normalizeOrderItems(catalog, payload.items || payload.basket || []);
    const subtotalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    const minimumChargeAdjustment = minimumChargeAdjustmentFor(subtotalAmount);
    const amountExpected = subtotalAmount + minimumChargeAdjustment;
    const createdAt = now().toISOString();
    const orderId = createOrderId(now, randomUUID);
    if (typeof deliveryClient.validateOrder === "function") {
      await deliveryClient.validateOrder({
        id: orderId,
        checkoutMode,
        buyerEmail,
        currency: ORDER_CURRENCY,
        subtotalAmount,
        minimumChargeAdjustment,
        amountExpected,
        amountPaid: 0,
        items,
        createdAt,
        updatedAt: createdAt,
      });
    }
    const receiptDescription = `Photos By Elie order ${orderId}. Download or recover files at ${ordersUrl} with this order number and checkout email.`;

    const lineItems = items.flatMap((item) => item.products.map((product) => ({
      photoId: item.photoId,
      name: checkoutLineName(item.title, product.label),
      quantity: 1,
      unit_amount: product.unitAmount,
      amount: product.amount,
    })));
    if (minimumChargeAdjustment) {
      lineItems.push({
        photoId: MINIMUM_CHARGE_PRODUCT_ID,
        name: "Photos By Elie - Minimum checkout charge",
        quantity: 1,
        unit_amount: minimumChargeAdjustment,
        amount: minimumChargeAdjustment,
      });
    }

    const checkoutSession = await stripe.createCheckoutSession({
      orderId,
      buyerEmail,
      amountTotal: amountExpected,
      currency: ORDER_CURRENCY,
      lineItems,
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
      subtotalAmount,
      minimumChargeAdjustment,
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
        provider: stripeProvider,
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
    const policy = downloadPolicy();
    const deliveryFiles = Array.isArray(deliveryResult.files)
      ? deliveryResult.files.map((file) => withDownloadPolicy(file, policy))
      : [];
    const ready = {
      ...preparing,
      status: "ready",
      delivery: {
        zipKey: deliveryResult.zipKey,
        downloadUrl: deliveryResult.downloadUrl,
        readyAt: deliveryResult.readyAt || readyAt,
        files: deliveryFiles,
        items: deliveryResult.items || [],
      },
      updatedAt: readyAt,
    };
    await store.putOrder(ready);
    if (deliveryFiles.length) {
      await Promise.all(deliveryFiles.map((file) => store.putDownload({
        token: file.token,
        orderId: ready.id,
        bucket: file.bucket,
        objectKey: file.objectKey,
        filename: file.name,
        contentType: file.contentType,
        bytes: file.bytes || 0,
        photoId: file.photoId,
        productId: file.productId,
        createdAt: readyAt,
        expiresAt: file.expiresAt,
        downloadLimit: file.downloadLimit,
        downloadCount: 0,
      })));
    } else if (deliveryResult.token) {
      await store.putDownload({
        token: deliveryResult.token,
        orderId: ready.id,
        zipKey: deliveryResult.zipKey,
        createdAt: readyAt,
        expiresAt: policy.expiresAt,
        downloadLimit: policy.downloadLimit,
        downloadCount: 0,
      });
    }
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

  const getOrderByCheckoutSession = async (_request, sessionId) => {
    if (!sessionId) return errorJson(400, "missing_session_id", "Checkout session id is required.");
    const order = await store.getOrderByCheckoutSessionId?.(sessionId);
    if (!order) return errorJson(404, "unknown_order", "Order was not found for this checkout session.");
    return json({ order: publicOrder(order) });
  };

  const download = async (_request, token) => {
    const downloadRecord = await store.getDownload(token);
    if (!downloadRecord) return errorJson(404, "unknown_download", "Download link was not found.");
    const nowDate = now();
    if (isExpiredAt(downloadRecord.expiresAt, nowDate)) {
      return errorJson(410, "download_expired", "This download link has expired. Use your order email and order number to request a fresh delivery link.");
    }
    if (downloadLimitReached(downloadRecord)) {
      return errorJson(429, "download_limit_reached", "This download link has reached its download limit. Contact Photos By Elie for help with the order.");
    }
    let response;
    if (typeof deliveryClient.getDownloadResponse === "function") {
      response = await deliveryClient.getDownloadResponse(downloadRecord);
    } else {
      response = json({
        download: {
          orderId: downloadRecord.orderId,
          zipKey: downloadRecord.zipKey,
          localZipPath: String(downloadRecord.zipKey || "").startsWith("/") ? downloadRecord.zipKey : null,
          expiresAt: downloadRecord.expiresAt || null,
          expiresInSeconds: 900,
          mockSignedUrl: `mock-r2://${downloadRecord.zipKey}?token=${encodeURIComponent(token)}`,
        },
      });
    }
    if (response.status < 400) {
      const downloadedAt = nowDate.toISOString();
      const updatedDownload = await store.recordDownload(token, downloadedAt);
      if (updatedDownload?.orderId && typeof store.updateOrder === "function") {
        await store.updateOrder(updatedDownload.orderId, (order) => appendDownloadEvent(order, downloadRecord, downloadedAt));
      }
    }
    return response;
  };

  const createRealEstateOriginalsSession = async (request) => {
    if (!realEstateOriginals || typeof realEstateOriginals.createSession !== "function") {
      return errorJson(503, "real_estate_originals_unavailable", "Real-estate originals delivery is not configured.");
    }
    const payload = await parseJson(request);
    const originals = await realEstateOriginals.createSession(payload);
    return json({ originals }, 201);
  };

  const fetch = async (request) => {
    if (request.method === "OPTIONS") return json({ ok: true });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, "");

    try {
      if (request.method === "GET" && path === "/health") {
        return json({ ok: true, service: "photosbyelie-worker", stripe: stripeProvider, currency: ORDER_CURRENCY });
      }
      if (request.method === "POST" && path === "/checkout/guest") return await createCheckout(request, "guest");
      if (request.method === "POST" && path === "/checkout/account") return await createCheckout(request, "account");
      if (request.method === "POST" && path === "/stripe-webhook") return await stripeWebhook(request);
      if (request.method === "POST" && path === "/mock-stripe/pay") return await mockPay(request);
      if (request.method === "POST" && path === "/real-estate/originals/session") return await createRealEstateOriginalsSession(request);
      const orderSessionMatch = path.match(/^\/orders\/by-session\/([^/]+)$/);
      if (request.method === "GET" && orderSessionMatch) return await getOrderByCheckoutSession(request, decodeURIComponent(orderSessionMatch[1]));
      const orderMatch = path.match(/^\/orders\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) return await getOrder(request, decodeURIComponent(orderMatch[1]));
      const downloadMatch = path.match(/^\/download\/([^/]+)$/);
      if (request.method === "GET" && downloadMatch) return await download(request, decodeURIComponent(downloadMatch[1]));
    } catch (error) {
      return errorJson(error.status || 500, error.code || "worker_error", error.message, error.details);
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
