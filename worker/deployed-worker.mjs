import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createKvStore } from "./kv-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
import { createStripeClient } from "./stripe-client.mjs";
import { collections, frameOptions, resolutions } from "./photos-catalog.generated.mjs";

const catalog = createCatalogIndex({ collections, resolutions, frameOptions });

const requiredBinding = (env, key) => {
  if (!env?.[key]) throw new Error(`Missing Worker binding: ${key}`);
  return env[key];
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
    const worker = createPhotosByElieWorker({
      catalog,
      store: createKvStore({
        namespace: requiredBinding(env, "ORDERS_KV"),
        prefix: env.KV_PREFIX || "pbe",
      }),
      stripe,
      delivery: createR2ZipDelivery({
        privateBucket: requiredBinding(env, "PRIVATE_MEDIA"),
        deliveryBucket: env.DELIVERY_MEDIA || env.PRIVATE_MEDIA,
      }),
      ordersUrl: `${publicSiteUrl}/order.html`,
      successUrl: `${publicSiteUrl}/order.html?id={ORDER_ID}&session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancelUrl: `${publicSiteUrl}/basket.html?checkout=cancelled`,
      mockStripeEnabled: !realStripeEnabled && env.MOCK_STRIPE_ENABLED !== "false",
    });
    return worker.fetch(request);
  },
};
