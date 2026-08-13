import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { createD1AccessUserRegistry, createKvAccessUserRegistry } from "./access-user-registry.mjs";
import { createAnalyticsStore } from "./analytics-store.mjs";
import { createCloudflareImagesRenderer } from "./cloudflare-images-renderer.mjs";
import { createCloudflareMediaVideoTranscoder } from "./cloudflare-media-video-transcoder.mjs";
import { createKvStore } from "./kv-store.mjs";
import { createD1LifecycleDenyStore } from "./lifecycle-deny-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { isNonRevocablePublicAsset } from "./non-revocable-public-assets.mjs";
import { createGoogleOAuthAuth } from "./google-oauth-auth.mjs";
import { createKvOwnerActionStore } from "./owner-action-store.mjs";
import { createKvOwnerDeviceAuthStore } from "./owner-device-auth-store.mjs";
import { createOwnerConnectorAuth } from "./owner-connector-auth.mjs";
import { createR2OwnerConnectorPackage } from "./owner-connector-package.mjs";
import { createOwnerAccessAuth } from "./owner-access-auth.mjs";
import { createRealEstateAuth } from "./real-estate-auth.mjs";
import { createRealEstateDeliverables } from "./real-estate-deliverables.mjs";
import { canonicalRealEstateGalleryKey } from "./real-estate-gallery-key.mjs";
import { createRealEstateOriginals } from "./real-estate-originals.mjs";
import { createR2ZipDelivery } from "./r2-zip-delivery.mjs";
import { createResendEmailClient } from "./resend-email-client.mjs";
import { createD1SidecarStateStore } from "./sidecar-state-store.mjs";
import { createStripeClient } from "./stripe-client.mjs";
import { collections, frameOptions, resolutions, storefrontPolicy, videoPriceTiers } from "./photos-catalog.generated.mjs";
import { REAL_ESTATE_GALLERY_RELEASES } from "./real-estate-gallery-releases.generated.mjs";

const catalog = createCatalogIndex({ collections, resolutions, frameOptions, videoPriceTiers, storefrontPolicy });

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

export const realEstateClientContextFor = (gallery = {}) => {
  const candidates = [gallery.clientContext, gallery.customer, gallery.username, gallery.key]
    .map((value) => String(value || "").trim().toLowerCase());
  if (candidates.some((value) => value.includes("corine"))) return "corine";
  if (candidates.some((value) => value.includes("agnes"))) return "agnes";
  return "elie";
};

const checkoutDiscountCodesFor = (env = {}) => {
  const rawJson = String(env.CHECKOUT_DISCOUNT_CODES_JSON || "").trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.codes)) return parsed.codes;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Invalid discount JSON should fail closed by returning no active codes.
      return [];
    }
  }
  const code = String(env.CHECKOUT_REHEARSAL_DISCOUNT_CODE || "").trim();
  if (!code) return [];
  return [{
    code,
    type: "target_total",
    targetTotalAmount: positiveInt(env.CHECKOUT_REHEARSAL_TARGET_AMOUNT, 50),
    label: "Owner live rehearsal",
  }];
};

const ownerAccessAuthFor = (env = {}) => {
  if (!env.ACCESS_TEAM_NAME || !env.ACCESS_AUD) return null;
  return createOwnerAccessAuth({
    teamName: env.ACCESS_TEAM_NAME,
    audience: env.ACCESS_AUD,
    allowedEmails: env.ACCESS_LOGIN_EMAIL_ALLOWLIST || "",
  });
};

const googleOAuthAuthFor = (env = {}) => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_SESSION_SECRET) return null;
  return createGoogleOAuthAuth({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    sessionSecret: env.GOOGLE_OAUTH_SESSION_SECRET,
    sessionSeconds: positiveInt(env.GOOGLE_OAUTH_SESSION_SECONDS, 7 * 24 * 60 * 60),
  });
};

const authAllowedReturnOriginsFor = (_env = {}, publicSiteUrl = "") => [publicSiteUrl];

const accessUserRegistryFor = (env = {}) => env.ACCESS_DB
  ? createD1AccessUserRegistry({ database: env.ACCESS_DB })
  : createKvAccessUserRegistry({
    namespace: env.ACCESS_USERS_KV || requiredBinding(env, "ORDERS_KV"),
    prefix: env.KV_PREFIX || "pbe",
  });

const ownerConnectorAuthFor = (env = {}) => {
  const raw = String(env.OWNER_CONNECTOR_TOKENS_JSON || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return createOwnerConnectorAuth({ credentials: parsed });
  } catch {
    return null;
  }
};

const cleanRealEstateGallery = (gallery = {}) => {
  const key = String(gallery.key || "").trim();
  if (!key) return null;
  return {
    key,
    username: String(gallery.username || gallery.customer || "").trim(),
    accessCode: String(gallery.accessCode || gallery.password || "").trim(),
    accessCodeHash: String(gallery.accessCodeHash || "").trim().toLowerCase(),
    accessCodeSalt: String(gallery.accessCodeSalt || "").trim(),
    privateMasterPrefix: String(gallery.privateMasterPrefix || `real-estate/${key}/masters`).replace(/^\/+|\/+$/g, ""),
    email: String(gallery.email || gallery.clientEmail || "").trim(),
    customer: String(gallery.customer || gallery.username || "").trim(),
    propertyTitle: String(gallery.propertyTitle || gallery.property || "").trim(),
    maxItems: Number(gallery.maxItems || 300) || 300,
    privateMasterLayout: String(gallery.privateMasterLayout || "nested").trim().toLowerCase(),
    allowedPhotoIds: Array.isArray(gallery.allowedPhotoIds)
      ? [...new Set(gallery.allowedPhotoIds.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
  };
};

const withVerifiedRealEstateRelease = (gallery) => {
  const release = REAL_ESTATE_GALLERY_RELEASES[
    canonicalRealEstateGalleryKey(gallery?.key).toLowerCase()
  ];
  if (!release) return gallery;
  return cleanRealEstateGallery({ ...gallery, ...release });
};

const AGNES_COMMON_GALLERY_KEY = "agnes-la-concha-common";

const withScopedRealEstateGalleries = (galleries = []) => {
  if (galleries.some((gallery) => gallery.key === AGNES_COMMON_GALLERY_KEY)) return galleries;
  const source = galleries.find((gallery) => gallery.key === "Corine-gallery")
    || galleries.find((gallery) => gallery.key === "corine-real-estate");
  if (!source) return galleries;
  return [
    ...galleries,
    {
      ...source,
      key: AGNES_COMMON_GALLERY_KEY,
      username: "Agnes",
      customer: "Agnes",
      email: "",
      accessCode: "",
      accessCodeHash: "",
      accessCodeSalt: "",
      propertyTitle: "La Concha / Common",
      maxItems: 14,
      privateMasterLayout: "nested",
      allowedPhotoIds: [],
    },
  ];
};

export const realEstateGalleriesFor = (env = {}) => {
  const rawJson = String(env.REAL_ESTATE_GALLERIES_JSON || "").trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.galleries) ? parsed.galleries : [];
      const galleries = source.map(cleanRealEstateGallery).filter((gallery) => gallery?.username);
      if (galleries.length) return withScopedRealEstateGalleries(galleries).map(withVerifiedRealEstateRelease);
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
  return legacy?.username ? withScopedRealEstateGalleries([legacy]).map(withVerifiedRealEstateRelease) : [];
};

export const realEstateDeliverablesFor = (env = {}, { assemblyDispatcher = null } = {}) => {
  const lifecycleDenyStore = createD1LifecycleDenyStore({
    database: requiredBinding(env, "ACCESS_DB"),
  });
  return createRealEstateDeliverables({
    privateBucket: requiredBinding(env, "PRIVATE_MEDIA"),
    galleries: realEstateGalleriesFor(env),
    emailClient: null,
    publicSiteUrl: String(env.PUBLIC_SITE_URL || "https://photos-by-elie.com").replace(/\/+$/, ""),
    assemblyDispatcher,
    videoTranscoder: createCloudflareMediaVideoTranscoder({ media: env.MEDIA }),
    assertAssetsAllowed: (mediaIds, context, expectedFence) => lifecycleDenyStore.assertAllowed(mediaIds, context, expectedFence),
  });
};

const mediaHeaders = (object = null, extraHeaders = {}) => ({
  "access-control-allow-origin": "*",
  "accept-ranges": "bytes",
  "cache-control": "private, no-store, max-age=0",
  "cdn-cache-control": "no-store",
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
  const unavailableHeaders = () => mediaHeaders(null, { "content-type": "text/plain; charset=utf-8" });
  const lifecycleUnavailable = (error) => new Response("Media unavailable", {
    status: error?.code === "asset_lifecycle_denied" ? 410 : 503,
    headers: unavailableHeaders(),
  });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: unavailableHeaders(),
    });
  }

  const url = new URL(request.url);
  let key = "";
  try {
    key = decodeURIComponent(url.pathname.replace(/^\/media\/?/, "")).replace(/^\/+/, "");
  } catch {
    return new Response("Malformed media key", {
      status: 400,
      headers: unavailableHeaders(),
    });
  }
  if (!key) {
    return new Response("Missing media key", {
      status: 400,
      headers: unavailableHeaders(),
    });
  }

  if (key.startsWith("assets/music/") && !isNonRevocablePublicAsset(key)) {
    return new Response("Media not found", {
      status: 404,
      headers: unavailableHeaders(),
    });
  }
  let assertObjectAllowed = null;
  if (!isNonRevocablePublicAsset(key)) {
    try {
      const lifecycleDenyStore = createD1LifecycleDenyStore({
        database: requiredBinding(env, "ACCESS_DB"),
      });
      assertObjectAllowed = () => lifecycleDenyStore.assertObjectAllowed({
        bucket: "public",
        objectKey: key,
        context: `media:${request.method.toLowerCase()}`,
      });
      await assertObjectAllowed();
    } catch (error) {
      return lifecycleUnavailable(error);
    }
  }

  const bucket = requiredBinding(env, "PUBLIC_MEDIA");
  const rangeHeader = request.headers.get("range");
  const metadata = typeof bucket.head === "function" ? await bucket.head(key) : null;

  if (rangeHeader) {
    if (!metadata) {
      return new Response("Media not found", {
        status: 404,
        headers: unavailableHeaders(),
      });
    }
    if (assertObjectAllowed) {
      try {
        await assertObjectAllowed();
      } catch (error) {
        return lifecycleUnavailable(error);
      }
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
        headers: unavailableHeaders(),
      });
    }
    if (assertObjectAllowed) {
      try {
        await assertObjectAllowed();
      } catch (error) {
        return lifecycleUnavailable(error);
      }
    }

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 206,
      headers: mediaHeaders(object, {
        "content-length": String(range.length),
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
      }),
    });
  }

  const object = request.method === "HEAD"
    ? metadata || await bucket.get(key)
    : await bucket.get(key);
  if (!object) {
    return new Response("Media not found", {
      status: 404,
      headers: unavailableHeaders(),
    });
  }
  if (assertObjectAllowed) {
    try {
      await assertObjectAllowed();
    } catch (error) {
      return lifecycleUnavailable(error);
    }
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
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      return Response.redirect(`${publicSiteUrl.replace(/\/+$/, "")}/?account=1`, 302);
    }

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
    const analytics = enabledFlag(env.ANALYTICS_ENABLED, true)
      ? createAnalyticsStore({
        namespace: env.ANALYTICS_KV || requiredBinding(env, "ORDERS_KV"),
        prefix: env.KV_PREFIX || "pbe",
        ttlSeconds: daysToSeconds(env.ANALYTICS_RETENTION_DAYS, 400),
        persistEvents: enabledFlag(env.ANALYTICS_PERSIST_EVENTS, false),
      })
      : null;
    const privateBucket = requiredBinding(env, "PRIVATE_MEDIA");
    const realEstateGalleries = realEstateGalleriesFor(env);
    const accessUserRegistry = accessUserRegistryFor(env);
    const emailClient = env.RESEND_API_KEY && env.ORDER_EMAIL_FROM
      ? createResendEmailClient({
        apiKey: env.RESEND_API_KEY,
        from: env.ORDER_EMAIL_FROM,
        replyTo: env.ORDER_EMAIL_REPLY_TO || "",
      })
      : null;
    const lifecycleDenyStore = createD1LifecycleDenyStore({
      database: requiredBinding(env, "ACCESS_DB"),
    });
    const worker = createPhotosByElieWorker({
      catalog,
      store,
      stripe,
      delivery: createR2ZipDelivery({
        privateBucket,
        deliveryBucket: env.DELIVERY_MEDIA || privateBucket,
        renderer: createCloudflareImagesRenderer({
          images: env.IMAGES,
        }),
        assertAssetsAllowed: (mediaIds, context, expectedFence) => lifecycleDenyStore.assertAllowed(mediaIds, context, expectedFence),
      }),
      realEstateOriginals: createRealEstateOriginals({
        privateBucket,
        store,
        galleries: realEstateGalleries,
        emailClient,
        downloadBaseUrl: workerPublicUrl,
        assertAssetsAllowed: (mediaIds, context, expectedFence) => lifecycleDenyStore.assertAllowed(mediaIds, context, expectedFence),
      }),
      realEstateAuth: realEstateGalleries.length && env.REAL_ESTATE_SESSION_SECRET ? createRealEstateAuth({
        galleries: realEstateGalleries,
        credentialStore: accessUserRegistry,
        sessionSecret: env.REAL_ESTATE_SESSION_SECRET,
        sessionSeconds: positiveInt(env.REAL_ESTATE_SESSION_SECONDS, 2 * 60 * 60),
      }) : null,
      realEstateDeliverables: createRealEstateDeliverables({
        privateBucket,
        store,
        galleries: realEstateGalleries,
        emailClient,
        publicSiteUrl,
        downloadBaseUrl: workerPublicUrl,
        deliveryLinkTtlSeconds: downloadTokenTtlSeconds,
        deliveryLinkMaxDownloads: downloadTokenMaxDownloads,
        assemblyDispatcher: env.REAL_ESTATE_RENDER_WORKFLOW ? {
          dispatch: ({ galleryKey, jobId }) => env.REAL_ESTATE_RENDER_WORKFLOW.create({
            id: jobId,
            params: { galleryKey, jobId },
          }),
        } : null,
        videoTranscoder: createCloudflareMediaVideoTranscoder({ media: env.MEDIA }),
        assertAssetsAllowed: (mediaIds, context) => lifecycleDenyStore.assertAllowed(mediaIds, context),
      }),
      googleOAuthAuth: googleOAuthAuthFor(env),
      accessAuth: ownerAccessAuthFor(env),
      accessUserRegistry,
      lifecycleDenyStore,
      accessAdminEmail: env.ACCESS_ADMIN_EMAIL || "ec92009@gmail.com",
      ownerActionStore: createKvOwnerActionStore({
        namespace: env.OWNER_ACTIONS_KV || requiredBinding(env, "ORDERS_KV"),
        prefix: env.KV_PREFIX || "pbe",
      }),
      ownerDeviceAuthStore: createKvOwnerDeviceAuthStore({
        namespace: env.OWNER_ACTIONS_KV || requiredBinding(env, "ORDERS_KV"),
        prefix: env.KV_PREFIX || "pbe",
      }),
      sidecarStateStore: env.ACCESS_DB ? createD1SidecarStateStore({
        database: env.ACCESS_DB,
      }) : undefined,
      ownerConnectorAuth: ownerConnectorAuthFor(env),
      ownerConnectorPackage: createR2OwnerConnectorPackage({
        bucket: privateBucket,
        key: env.OWNER_CONNECTOR_MAC_KEY || "owner-connectors/photosbyelie-mac-connector.zip",
      }),
      authAllowedReturnOrigins: authAllowedReturnOriginsFor(env, publicSiteUrl),
      ordersUrl: `${publicSiteUrl}/order.html`,
      downloadBaseUrl: workerPublicUrl,
      emailClient,
      includeDirectDownloadLinks: enabledFlag(env.ORDER_EMAIL_INCLUDE_DIRECT_DOWNLOAD_LINKS, true),
      successUrl: `${publicSiteUrl}/order.html?id={ORDER_ID}&session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancelUrl: `${publicSiteUrl}/basket.html?checkout=cancelled`,
      mockStripeEnabled: !realStripeEnabled && env.MOCK_STRIPE_ENABLED !== "false",
      downloadTokenTtlSeconds,
      downloadTokenMaxDownloads,
      discountCodes: checkoutDiscountCodesFor(env),
      analytics,
    });
    return worker.fetch(request);
  },
};
