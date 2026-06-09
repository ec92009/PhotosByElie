import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createKvStore } from "./kv-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createRealEstateDeliverables } from "./real-estate-deliverables.mjs";
import { createRealEstateOriginals } from "./real-estate-originals.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
import { createResendEmailClient } from "./resend-email-client.mjs";
import { createStripeClient } from "./stripe-client.mjs";
import { collections, frameOptions, resolutions, videoPriceTiers } from "./photos-catalog.generated.mjs";

const catalog = createCatalogIndex({ collections, resolutions, frameOptions, videoPriceTiers });

const requiredBinding = (env, key) => {
  if (!env?.[key]) throw new Error(`Missing Worker binding: ${key}`);
  return env[key];
};

const positiveInt = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
};

const daysToSeconds = (value, fallbackDays) => positiveInt(value, fallbackDays) * 24 * 60 * 60;

const enabledFlag = (value, defaultValue = true) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  return !["0", "false", "no", "off"].includes(normalized);
};

const cleanRealEstateGallery = (gallery = {}) => {
  const key = String(gallery.key || "").trim();
  if (!key) return null;
  return {
    key,
    username: String(gallery.username || gallery.customer || "").trim(),
    accessCode: String(gallery.accessCode || gallery.password || "").trim(),
    privateMasterPrefix: String(gallery.privateMasterPrefix || `real-estate/${key}/masters`).replace(/^\/+|\/+$/g, ""),
    maxItems: Number(gallery.maxItems || 300) || 300,
  };
};

const realEstateGalleriesFor = (env = {}) => {
  const rawJson = String(env.REAL_ESTATE_GALLERIES_JSON || "").trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.galleries) ? parsed.galleries : [];
      const galleries = source.map(cleanRealEstateGallery).filter((gallery) => gallery?.username && gallery?.accessCode);
      if (galleries.length) return galleries;
    } catch {
      // Fall through to the legacy single-gallery environment variables.
    }
  }
  const legacy = cleanRealEstateGallery({
    key: "corine-real-estate",
    username: env.REAL_ESTATE_CORINE_USERNAME || "",
    accessCode: env.REAL_ESTATE_CORINE_ACCESS_CODE || "",
    privateMasterPrefix: env.REAL_ESTATE_CORINE_PRIVATE_MASTER_PREFIX || "real-estate/corine-real-estate/masters",
  });
  return legacy?.username && legacy?.accessCode ? [legacy] : [];
};

const mediaHeaders = (object = null, extraHeaders = {}) => ({
  "access-control-allow-origin": "*",
  "accept-ranges": "bytes",
  "cache-control": "public, max-age=31536000, immutable",
  "content-type": object?.httpMetadata?.contentType || "image/jpeg",
  ...extraHeaders,
});

const parseSingleByteRange = (rangeHeader, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || "").trim());
  if (!match || !Number.isFinite(size) || size < 1) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return null;
    const length = Math.min(suffixLength, size);
    const start = size - length;
    return { offset: start, length, start, end: size - 1 };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return null;
  }

  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1, start, end };
};

const publicMediaResponse = async (request, env) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "access-control-allow-origin": "*" },
    });
  }

  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/media\/?/, "")).replace(/^\/+/, "");
  if (!key) {
    return new Response("Missing media key", {
      status: 400,
      headers: { "access-control-allow-origin": "*" },
    });
  }

  const bucket = requiredBinding(env, "PUBLIC_MEDIA");
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const metadata = typeof bucket.head === "function" ? await bucket.head(key) : await bucket.get(key);
    if (!metadata) {
      return new Response("Media not found", {
        status: 404,
        headers: { "access-control-allow-origin": "*" },
      });
    }

    const size = Number(metadata.size);
    const range = parseSingleByteRange(rangeHeader, size);
    if (!range) {
      return new Response("Requested range not satisfiable", {
        status: 416,
        headers: mediaHeaders(metadata, {
          "content-range": Number.isFinite(size) ? `bytes */${size}` : "bytes */*",
        }),
      });
    }

    const object = request.method === "HEAD" ? metadata : await bucket.get(key, { range: { offset: range.offset, length: range.length } });
    if (!object) {
      return new Response("Media not found", {
        status: 404,
        headers: { "access-control-allow-origin": "*" },
      });
    }

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 206,
      headers: mediaHeaders(object, {
        "content-length": String(range.length),
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
      }),
    });
  }

  const object = await bucket.get(key);
  if (!object) {
    return new Response("Media not found", {
      status: 404,
      headers: { "access-control-allow-origin": "*" },
    });
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: mediaHeaders(object),
  });
};

export default {
  fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/media/")) {
      return publicMediaResponse(request, env);
    }

    const publicSiteUrl = env.PUBLIC_SITE_URL || "https://photos-by-elie.com";
    const workerPublicUrl = env.WORKER_PUBLIC_URL || url.origin;
    const downloadTokenTtlSeconds = daysToSeconds(env.DOWNLOAD_TOKEN_TTL_DAYS, 30);
    const downloadTokenMaxDownloads = positiveInt(env.DOWNLOAD_TOKEN_MAX_DOWNLOADS, 100);
    const realStripeEnabled = Boolean(env.STRIPE_SECRET_KEY);
    const stripe = realStripeEnabled
      ? createStripeClient({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        statementDescriptorSuffix: env.STRIPE_STATEMENT_DESCRIPTOR_SUFFIX || "DOWNLOAD",
        apiVersion: env.STRIPE_API_VERSION,
      })
      : createMockStripeClient({
        checkoutBaseUrl: env.MOCK_STRIPE_CHECKOUT_BASE_URL || `${publicSiteUrl}/order.html?mockStripeSession=`,
        webhookSecret: env.MOCK_STRIPE_WEBHOOK_SECRET || "mock_whsec_photosbyelie",
      });
    const store = createKvStore({
      namespace: requiredBinding(env, "ORDERS_KV"),
      prefix: env.KV_PREFIX || "pbe",
      checkoutSessionTtlSeconds: daysToSeconds(env.CHECKOUT_SESSION_TTL_DAYS, 90),
      downloadTtlSeconds: downloadTokenTtlSeconds + (24 * 60 * 60),
    });
    const privateBucket = requiredBinding(env, "PRIVATE_MEDIA");
    const realEstateGalleries = realEstateGalleriesFor(env);
    const emailClient = env.RESEND_API_KEY && env.ORDER_EMAIL_FROM
      ? createResendEmailClient({
        apiKey: env.RESEND_API_KEY,
        from: env.ORDER_EMAIL_FROM,
        replyTo: env.ORDER_EMAIL_REPLY_TO || "",
      })
      : null;
    const worker = createPhotosByElieWorker({
      catalog,
      store,
      stripe,
      delivery: createR2ZipDelivery({
        privateBucket,
        deliveryBucket: env.DELIVERY_MEDIA || privateBucket,
      }),
      realEstateOriginals: createRealEstateOriginals({
        privateBucket,
        store,
        galleries: realEstateGalleries,
      }),
      realEstateDeliverables: createRealEstateDeliverables({
        privateBucket,
        galleries: realEstateGalleries,
      }),
      ordersUrl: `${publicSiteUrl}/order.html`,
      downloadBaseUrl: workerPublicUrl,
      emailClient,
      includeDirectDownloadLinks: enabledFlag(env.ORDER_EMAIL_INCLUDE_DIRECT_DOWNLOAD_LINKS, true),
      successUrl: `${publicSiteUrl}/order.html?id={ORDER_ID}&session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancelUrl: `${publicSiteUrl}/basket.html?checkout=cancelled`,
      mockStripeEnabled: !realStripeEnabled && env.MOCK_STRIPE_ENABLED !== "false",
      downloadTokenTtlSeconds,
      downloadTokenMaxDownloads,
    });
    return worker.fetch(request);
  },
};
