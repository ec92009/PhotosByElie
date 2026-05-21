import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createKvStore } from "./kv-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createRealEstateOriginals } from "./real-estate-originals.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
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

const mediaHeaders = (object = null) => ({
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=31536000, immutable",
  "content-type": object?.httpMetadata?.contentType || "image/jpeg",
});

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

  const object = await requiredBinding(env, "PUBLIC_MEDIA").get(key);
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

    const publicSiteUrl = env.PUBLIC_SITE_URL || "https://ec92009.github.io/PhotosByElie";
    const downloadTokenTtlSeconds = daysToSeconds(env.DOWNLOAD_TOKEN_TTL_DAYS, 30);
    const downloadTokenMaxDownloads = positiveInt(env.DOWNLOAD_TOKEN_MAX_DOWNLOADS, 100);
    const realStripeEnabled = Boolean(env.STRIPE_SECRET_KEY);
    const stripe = realStripeEnabled
      ? createStripeClient({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
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
        galleries: realEstateGalleriesFor(env),
      }),
      ordersUrl: `${publicSiteUrl}/order.html`,
      successUrl: `${publicSiteUrl}/order.html?id={ORDER_ID}&session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancelUrl: `${publicSiteUrl}/basket.html?checkout=cancelled`,
      mockStripeEnabled: !realStripeEnabled && env.MOCK_STRIPE_ENABLED !== "false",
      downloadTokenTtlSeconds,
      downloadTokenMaxDownloads,
    });
    return worker.fetch(request);
  },
};
