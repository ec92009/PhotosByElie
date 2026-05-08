import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createKvStore } from "./kv-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
import { collections, frameOptions, resolutions } from "./photos-catalog.generated.mjs";

const catalog = createCatalogIndex({ collections, resolutions, frameOptions });

const requiredBinding = (env, key) => {
  if (!env?.[key]) throw new Error(`Missing Worker binding: ${key}`);
  return env[key];
};

export default {
  fetch(request, env = {}) {
    const publicSiteUrl = env.PUBLIC_SITE_URL || "https://ec92009.github.io/PhotosByElie";
    const worker = createPhotosByElieWorker({
      catalog,
      store: createKvStore({
        namespace: requiredBinding(env, "ORDERS_KV"),
        prefix: env.KV_PREFIX || "pbe",
      }),
      stripe: createMockStripeClient({
        checkoutBaseUrl: env.MOCK_STRIPE_CHECKOUT_BASE_URL || `${publicSiteUrl}/order.html?mockStripeSession=`,
        webhookSecret: env.MOCK_STRIPE_WEBHOOK_SECRET || "mock_whsec_photosbyelie",
      }),
      delivery: createR2ZipDelivery({
        privateBucket: requiredBinding(env, "PRIVATE_MEDIA"),
        deliveryBucket: env.DELIVERY_MEDIA || env.PRIVATE_MEDIA,
      }),
      ordersUrl: `${publicSiteUrl}/order.html`,
      successUrl: `${publicSiteUrl}/order.html?id={ORDER_ID}&checkout=success`,
      cancelUrl: `${publicSiteUrl}/basket.html?checkout=cancelled`,
      mockStripeEnabled: env.MOCK_STRIPE_ENABLED !== "false",
    });
    return worker.fetch(request);
  },
};
