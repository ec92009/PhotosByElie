import { ACCESS_CAPABILITIES, createMemoryAccessUserRegistry } from "./access-user-registry.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createMockStripeClient } from "./mock-stripe.mjs";
import { createMemoryOwnerActionStore } from "./owner-action-store.mjs";
import { createMemorySidecarStateStore } from "./sidecar-state-store.mjs";
import { canonicalRealEstateGalleryKey } from "./real-estate-gallery-key.mjs";

const ORDER_CURRENCY = "usd";
const MINIMUM_CHARGE_AMOUNT = 50;
const MINIMUM_CHARGE_PRODUCT_ID = "minimum-charge-adjustment";
const RAW_SOURCE_TYPES = new Set(["DNG", "NEF", "CR2", "CR3", "ARW", "RAF", "ORF", "RW2", "RAW", "PEF", "SRW", "RWL"]);
const DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_DOWNLOAD_TOKEN_MAX_DOWNLOADS = 100;
const PURCHASE_ALLOWANCE_SOURCE = "photosbyelie-worker-order-ledger";
const PURCHASE_ALLOWANCE_SOURCE_DETAIL = "PhotosByElie checkout Worker order records in ORDERS_KV";
const SECONDS_PER_DAY = 60 * 60 * 24;
const ACCESS_CONSOLE_ROLE_OPTIONS = [
  {
    id: "user",
    label: "Regular user",
    description: "Default Google-authenticated account with public browsing and account/order recovery.",
    grantable: true,
    capabilities: ["view_public", "buy_downloads", "redownload_purchases_30d"],
  },
  {
    id: "re_client",
    label: "RE client",
    description: "Regular user plus assigned real-estate gallery permissions.",
    grantable: true,
    capabilities: ["view_gallery", "view_watermarked", "pdf", "video", "view_originals"],
  },
  {
    id: "owner",
    label: "Owner",
    description: "Owner workflow access without bootstrap admin recovery powers.",
    grantable: true,
    capabilities: ["view_all_galleries", "view_originals", "manage_access"],
  },
  {
    id: "admin",
    label: "Bootstrap admin",
    description: "Break-glass admin identity configured outside D1.",
    grantable: false,
    capabilities: ["view_all_galleries", "view_originals", "manage_access"],
  },
];

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,stripe-signature,x-mock-stripe-signature",
    ...headers,
  },
});

const errorJson = (status, code, message, details = undefined) => json({ error: { code, message, details } }, status);

const credentialedCorsHeaders = (request, extraHeaders = {}) => {
  const origin = request.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,stripe-signature,x-mock-stripe-signature",
    "access-control-allow-credentials": "true",
    vary: "Origin",
    ...extraHeaders,
  };
};

const credentialedJson = (request, body, status = 200, headers = {}) =>
  json(body, status, credentialedCorsHeaders(request, headers));

const credentialedErrorJson = (request, status, code, message, details = undefined, headers = {}) =>
  credentialedJson(request, { error: { code, message, details } }, status, headers);

const redirect = (location, status = 302, headers = {}) => new Response(null, {
  status,
  headers: { location, ...headers },
});

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

const normalizeDiscountCode = (value) => String(value || "")
  .trim()
  .toUpperCase()
  .replace(/\s+/g, "");

const integerCents = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
};

const normalizeEmailAllowlist = (emails) => {
  if (!Array.isArray(emails)) return [];
  return emails
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(validEmail);
};

const normalizeAccessConsoleRoles = (roles = []) => {
  const source = Array.isArray(roles) ? roles : String(roles || "").split(/[\s,;]+/);
  const cleaned = new Set(source
    .map((role) => String(role || "").trim().toLowerCase().replace(/[-\s]+/g, "_"))
    .filter((role) => ["user", "re_client", "owner"].includes(role)));
  cleaned.add("user");
  return [...cleaned];
};

const ACCESS_CONSOLE_CAPABILITY_IDS = new Set(ACCESS_CAPABILITIES.map((capability) => capability.id));

const normalizeAccessConsoleCapabilities = (capabilities = []) => {
  const source = Array.isArray(capabilities) ? capabilities : String(capabilities || "").split(/[\s,;]+/);
  return [...new Set(source
    .map((capability) => String(capability || "").trim().toLowerCase().replace(/[-\s]+/g, "_"))
    .filter((capability) => ACCESS_CONSOLE_CAPABILITY_IDS.has(capability)))];
};

const accessConsolePayloadRequestsAdmin = (roles = []) => {
  const source = Array.isArray(roles) ? roles : String(roles || "").split(/[\s,;]+/);
  return source
    .map((role) => String(role || "").trim().toLowerCase().replace(/[-\s]+/g, "_"))
    .includes("admin");
};

const tierFromAccessConsoleRoles = (roles = []) => {
  const set = new Set(roles);
  if (set.has("owner")) return "owner";
  if (set.has("re_client")) return "re_client";
  return "user";
};

const normalizeOriginList = (origins) => {
  const source = Array.isArray(origins) ? origins : String(origins || "").split(/[\s,;]+/);
  return source.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return "";
    }
  }).filter(Boolean);
};

const normalizeAdminEmail = (value) => {
  const email = String(value || "").trim().toLowerCase();
  return validEmail(email) ? email : "";
};

const rolesForTier = (tier, admin = false) => {
  const roles = ["user"];
  if (tier === "re_client") roles.push("re_client");
  if (tier === "owner" || admin) roles.push("owner");
  if (admin) roles.push("admin");
  return roles;
};

const sessionForAccessIdentity = async (identity, { accessUserRegistry, adminEmail }) => {
  const email = String(identity?.email || "").trim().toLowerCase();
  const record = email && accessUserRegistry?.getUser ? await accessUserRegistry.getUser(email) : null;
  const admin = Boolean(email && adminEmail && email === adminEmail);
  const effectiveRealEstateClients = Array.isArray(record?.effectiveAccess?.scopes)
    ? record.effectiveAccess.scopes
      .filter((scope) => scope?.galleryKind === "real_estate" && scope.galleryKey)
      .map((scope) => String(scope.galleryKey || "").trim())
      .filter(Boolean)
    : [];
  const realEstateClients = [...new Set([
    ...(Array.isArray(record?.realEstateClients) ? record.realEstateClients : []),
    ...effectiveRealEstateClients,
  ])];
  const registryTier = String(record?.tier || "user").trim().toLowerCase();
  const tier = admin ? "admin" : (registryTier === "user" && realEstateClients.length ? "re_client" : registryTier);
  const roles = rolesForTier(tier, admin);
  if (realEstateClients.length && !roles.includes("re_client")) roles.push("re_client");
  return {
    authenticated: Boolean(email),
    email,
    provider: identity?.provider || "",
    roles,
    tier,
    admin,
    realEstateClients,
    accessRecord: record,
    expiresAt: identity?.expiresAt || null,
    sessionSeconds: Number(identity?.sessionSeconds || 0),
  };
};

const accessConsoleRoleCapabilities = (roleId) =>
  ACCESS_CONSOLE_ROLE_OPTIONS.find((role) => role.id === roleId)?.capabilities || [];

const normalizePolicyGalleryKind = (value) => {
  const kind = String(value || "public").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ["event", "real_estate", "public", "custom"].includes(kind) ? kind : "custom";
};

const normalizePolicyGalleryKey = (value) => String(value || "").trim();

const boolParam = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const fallbackGalleryDefaultsFor = (galleryKind) => ({
  watermarked: true,
  saleEnabled: galleryKind !== "real_estate",
  downloads: false,
  pdf: galleryKind === "real_estate",
  video: galleryKind === "real_estate",
  memberOriginals: false,
  ownerOriginals: false,
});

const accessScopeMatchesGallery = (scope, galleryKind, galleryKey) =>
  scope?.galleryKind === galleryKind && String(scope.galleryKey || "") === galleryKey;

const galleryDefaultsForPolicy = ({ galleryKind, galleryKey, scopes = [], audienceGroups = [] }) => {
  const scope = scopes.find((item) => accessScopeMatchesGallery(item, galleryKind, galleryKey));
  if (scope?.galleryDefaults) return scope.galleryDefaults;
  const group = audienceGroups.find((item) => item.galleryKind === galleryKind && item.galleryKey === galleryKey);
  return group?.galleryDefaults || fallbackGalleryDefaultsFor(galleryKind);
};

const galleryAccessDecisionFor = ({
  viewer = null,
  mode = "visitor",
  galleryKind = "public",
  galleryKey = "",
  audienceGroups = [],
  ownerOriginals = false,
} = {}) => {
  const roles = Array.isArray(viewer?.roles) && viewer.roles.length ? viewer.roles : ["user"];
  const scopes = Array.isArray(viewer?.effectiveAccess?.scopes) ? viewer.effectiveAccess.scopes : [];
  const matchingScopes = scopes.filter((scope) => accessScopeMatchesGallery(scope, galleryKind, galleryKey));
  const scopeCapabilities = new Set(matchingScopes.flatMap((scope) => scope.capabilities || []));
  const capabilities = new Set(accessConsoleRoleCapabilities("user"));
  roles.forEach((role) => accessConsoleRoleCapabilities(role).forEach((capability) => capabilities.add(capability)));
  scopes.forEach((scope) => (scope.capabilities || []).forEach((capability) => capabilities.add(capability)));
  const defaults = galleryDefaultsForPolicy({ galleryKind, galleryKey, scopes, audienceGroups });
  const canViewAll = capabilities.has("view_all_galleries") || roles.includes("admin");
  const canViewPublic = galleryKind === "public" && capabilities.has("view_public");
  const canViewAssigned = scopeCapabilities.has("view_gallery");
  const canView = Boolean(canViewAll || canViewPublic || canViewAssigned);
  const memberOriginals = canView && scopeCapabilities.has("view_originals") && defaults.memberOriginals === true;
  const ownerOriginalsActive = canView && canViewAll && (ownerOriginals || defaults.ownerOriginals === true);
  const originals = Boolean(memberOriginals || ownerOriginalsActive);
  const watermarked = canView && !originals && (defaults.watermarked === true || scopeCapabilities.has("view_watermarked"));
  const previewMode = !canView ? "blocked" : (originals ? "originals" : (watermarked ? "watermarked" : "compressed"));
  const reasons = [];
  if (canViewAll) reasons.push("view_all_galleries");
  if (canViewPublic) reasons.push("view_public");
  if (canViewAssigned) reasons.push("assigned_gallery");
  if (!canView) reasons.push("no_matching_gallery_grant");
  return {
    mode,
    email: viewer?.email || "",
    label: mode === "visitor" ? "Regular visitor" : (viewer?.displayName || viewer?.email || mode),
    allowed: canView,
    gallery: { galleryKind, galleryKey },
    access: {
      previewMode,
      watermarked,
      saleEnabled: Boolean(canView && defaults.saleEnabled && capabilities.has("buy_downloads")),
      checkout: Boolean(canView && defaults.saleEnabled && capabilities.has("buy_downloads")),
      assignedDownloads: Boolean(canView && defaults.downloads && scopeCapabilities.has("download_items")),
      purchasedRedownloads: Boolean(canView && capabilities.has("redownload_purchases_30d")),
      pdf: Boolean(canView && defaults.pdf && scopeCapabilities.has("pdf")),
      video: Boolean(canView && defaults.video && scopeCapabilities.has("video")),
      originals,
      memberOriginals,
      ownerOriginals: ownerOriginalsActive,
      manageAccess: Boolean(capabilities.has("manage_access")),
    },
    defaults,
    matchingScopes: matchingScopes.map((scope) => ({
      source: scope.source || "",
      label: scope.label || scope.galleryKey || "",
      role: scope.role || "",
      groupId: scope.groupId || "",
      capabilities: scope.capabilities || [],
    })),
    capabilities: [...capabilities].sort(),
    reasons,
  };
};

const normalizeDiscountDefinition = (definition) => {
  if (typeof definition === "string") {
    const code = normalizeDiscountCode(definition);
    return code ? { code, type: "target_total", targetTotalAmount: MINIMUM_CHARGE_AMOUNT } : null;
  }
  if (!definition || typeof definition !== "object") return null;
  const code = normalizeDiscountCode(definition.code || definition.discountCode || definition.promoCode);
  if (!code) return null;
  const type = String(definition.type || definition.kind || (
    definition.percentOff != null ? "percent" : definition.amountOff != null ? "amount" : "target_total"
  )).trim().toLowerCase();
  return {
    code,
    type,
    label: String(definition.label || definition.name || "").trim(),
    percentOff: Number(definition.percentOff),
    amountOff: integerCents(definition.amountOff ?? definition.amountOffAmount ?? definition.amountOffCents, 0),
    targetTotalAmount: integerCents(
      definition.targetTotalAmount ?? definition.targetAmount ?? definition.targetCents ?? definition.targetTotalCents,
      MINIMUM_CHARGE_AMOUNT
    ),
    minPaidAmount: Math.max(
      MINIMUM_CHARGE_AMOUNT,
      integerCents(definition.minPaidAmount ?? definition.minimumPaidAmount ?? definition.minChargeAmount, MINIMUM_CHARGE_AMOUNT)
    ),
    startsAt: definition.startsAt || definition.validFrom || null,
    expiresAt: definition.expiresAt || definition.validUntil || null,
    allowedEmails: normalizeEmailAllowlist(definition.allowedEmails || definition.emails),
    enabled: definition.enabled !== false,
  };
};

const discountDefinitionList = (discountCodes) => {
  if (!discountCodes) return [];
  if (Array.isArray(discountCodes)) return discountCodes.map(normalizeDiscountDefinition).filter(Boolean);
  if (typeof discountCodes === "object") {
    return Object.entries(discountCodes).map(([code, definition]) => normalizeDiscountDefinition({
      ...(typeof definition === "object" && definition ? definition : { targetTotalAmount: definition }),
      code,
    })).filter(Boolean);
  }
  return [];
};

const discountDefinitionsByCode = (discountCodes) => new Map(
  discountDefinitionList(discountCodes).map((definition) => [definition.code, definition])
);

const isDateBeforeOrEqual = (value, date) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp <= date.getTime();
};

const isDateAfter = (value, date) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp > date.getTime();
};

const discountRawAmount = (definition, subtotalAmount) => {
  if (definition.type === "percent" || definition.type === "percentage") {
    const percent = Number.isFinite(definition.percentOff) ? Math.max(0, Math.min(100, definition.percentOff)) : 0;
    return Math.floor(subtotalAmount * (percent / 100));
  }
  if (definition.type === "amount" || definition.type === "amount_off" || definition.type === "fixed") {
    return definition.amountOff;
  }
  const targetTotalAmount = Math.max(definition.minPaidAmount, definition.targetTotalAmount);
  return subtotalAmount - targetTotalAmount;
};

const validateCheckoutDiscount = ({
  discountCode,
  discountDefinitions,
  buyerEmail,
  subtotalAmount,
  nowDate,
}) => {
  const code = normalizeDiscountCode(discountCode);
  if (!code) {
    return {
      code: "",
      label: "",
      amount: 0,
      discountedSubtotalAmount: subtotalAmount,
    };
  }
  const definition = discountDefinitions.get(code);
  if (!definition || !definition.enabled) {
    throw Object.assign(new Error("Discount code is not valid for this checkout."), {
      status: 403,
      code: "invalid_discount_code",
    });
  }
  if (definition.startsAt && isDateAfter(definition.startsAt, nowDate)) {
    throw Object.assign(new Error("Discount code is not active yet."), {
      status: 403,
      code: "discount_code_inactive",
    });
  }
  if (definition.expiresAt && isDateBeforeOrEqual(definition.expiresAt, nowDate)) {
    throw Object.assign(new Error("Discount code has expired."), {
      status: 403,
      code: "discount_code_expired",
    });
  }
  if (definition.allowedEmails.length && !definition.allowedEmails.includes(String(buyerEmail || "").toLowerCase())) {
    throw Object.assign(new Error("Discount code is not valid for this checkout email."), {
      status: 403,
      code: "discount_code_email_mismatch",
    });
  }

  const minPaidAmount = Math.max(MINIMUM_CHARGE_AMOUNT, definition.minPaidAmount);
  const maxDiscountAmount = Math.max(0, subtotalAmount - minPaidAmount);
  const amount = Math.max(0, Math.min(integerCents(discountRawAmount(definition, subtotalAmount), 0), maxDiscountAmount));
  return {
    code,
    label: definition.label,
    amount,
    discountedSubtotalAmount: subtotalAmount - amount,
  };
};

const allocateDiscountedLineItems = (lineItems, targetAmount) => {
  const normalizedTarget = integerCents(targetAmount, 0);
  const originalTotal = lineItems.reduce((sum, item) => sum + integerCents(item.amount ?? item.unit_amount, 0), 0);
  if (!lineItems.length || originalTotal <= 0 || normalizedTarget <= 0) return [];
  if (normalizedTarget >= originalTotal) {
    return lineItems.map((item) => ({
      ...item,
      unit_amount: integerCents(item.unit_amount ?? item.amount, 0),
      amount: integerCents(item.amount ?? item.unit_amount, 0),
      originalAmount: integerCents(item.amount ?? item.unit_amount, 0),
    }));
  }
  const allocations = lineItems.map((item, index) => {
    const originalAmount = integerCents(item.amount ?? item.unit_amount, 0);
    const exact = (originalAmount / originalTotal) * normalizedTarget;
    const amount = Math.floor(exact);
    return {
      item,
      index,
      originalAmount,
      amount,
      remainder: exact - amount,
    };
  });
  let remaining = normalizedTarget - allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  allocations
    .slice()
    .sort((left, right) =>
      (right.remainder - left.remainder)
      || (right.originalAmount - left.originalAmount)
      || (left.index - right.index)
    )
    .forEach((allocation) => {
      if (remaining <= 0) return;
      allocation.amount += 1;
      remaining -= 1;
    });
  return allocations
    .filter((allocation) => allocation.amount > 0)
    .sort((left, right) => left.index - right.index)
    .map((allocation) => ({
      ...allocation.item,
      unit_amount: allocation.amount,
      amount: allocation.amount,
      originalAmount: allocation.originalAmount,
    }));
};

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

const normalizedPolicyValues = (values, fallback = ["ai"]) => [
  ...new Set((values ?? fallback).map((value) => String(value).trim().toLowerCase()).filter(Boolean)),
];

const publicCatalogOnly = (collections = {}, retiredCollectionKeys = new Set(["ai"])) => Object.fromEntries(
  Object.entries(collections).filter(([key]) => key !== "unknown" && !retiredCollectionKeys.has(String(key).toLowerCase()))
);

export const createCatalogIndex = ({
  collections = {},
  resolutions = [],
  frameOptions = [],
  videoPriceTiers = {},
  physicalProductsEnabled = false,
  storefrontPolicy = {},
} = {}) => {
  const retiredCollectionKeys = new Set(normalizedPolicyValues(storefrontPolicy.retiredCollectionKeys));
  const retiredSourceOrigins = new Set(normalizedPolicyValues(storefrontPolicy.retiredSourceOrigins));
  const photos = new Map();
  const options = new Map([
    ...resolutions.map((option) => [option.id, option]),
    ["video-original", { id: "video-original", type: "video", label: "Original video download" }],
  ]);

  Object.entries(publicCatalogOnly(collections, retiredCollectionKeys)).forEach(([collectionKey, collection]) => {
    (collection.photos || []).forEach((photo) => {
      if (retiredSourceOrigins.has(photoOriginFor(photo, collectionKey))) return;
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
    storefrontPolicy: {
      retiredCollectionKeys: [...retiredCollectionKeys],
      retiredSourceOrigins: [...retiredSourceOrigins],
    },
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
        dimensions: originalDimensions(photo),
      },
      publicPreview: photo.media?.publicPreview || null,
      products: options,
      subtotal: options.reduce((sum, option) => sum + option.amount, 0),
    });
  }

  return orderItems;
};

const normalizeAccountLiked = (catalog, incomingItems = []) => {
  if (!Array.isArray(incomingItems)) return [];
  const seen = new Set();
  return incomingItems.reduce((items, item) => {
    const photoId = String(typeof item === "string" ? item : item?.photoId || item?.id || "").trim();
    if (!photoId || seen.has(photoId)) return items;
    const entry = catalog.photos.get(photoId);
    if (!entry) return items;
    seen.add(photoId);
    items.push({
      photoId,
      title: entry.photo.title || photoId,
      collection: entry.collectionTitle || entry.collectionKey || "",
      collectionKey: entry.collectionKey || "",
    });
    return items;
  }, []);
};

const normalizeAccountBasket = (catalog, incomingItems = []) => {
  if (!Array.isArray(incomingItems)) return [];
  const byPhoto = new Map();
  incomingItems.forEach((item) => {
    const photoId = String(item?.photoId || item?.id || "").trim();
    if (!photoId || !catalog.photos.has(photoId)) return;
    const existing = byPhoto.get(photoId) || { photoId, options: [] };
    existing.options.push(...(Array.isArray(item.options) ? item.options : []));
    byPhoto.set(photoId, existing);
  });

  return [...byPhoto.values()].map((item) => {
    const entry = catalog.photos.get(item.photoId);
    const availableOptions = catalog.availableOptionsFor(entry.photo);
    const availableById = new Map(availableOptions.map((option) => [option.id, option]));
    const seenOptions = new Set();
    const options = (item.options || []).reduce((next, rawOption) => {
      const optionId = String(typeof rawOption === "string" ? rawOption : rawOption?.id || rawOption?.optionId || "").trim();
      const option = availableById.get(optionId);
      if (!option || seenOptions.has(optionId)) return next;
      seenOptions.add(optionId);
      const normalized = {
        id: option.id,
        type: option.type || "digital",
        label: option.label || option.id,
        detail: option.detail || "",
        dimensions: option.dimensions || "",
        price: option.type === "video" ? Number(option.price) || 0 : optionPriceFor(entry.photo, entry.collectionKey, option),
      };
      if (normalized.type === "print") {
        normalized.quantity = Math.max(1, Math.min(99, Math.round(Number(rawOption.quantity) || 1)));
        normalized.frameId = String(rawOption.frameId || rawOption.frame?.id || "none");
      }
      next.push(normalized);
      return next;
    }, []);
    return {
      photoId: item.photoId,
      title: entry.photo.title || item.photoId,
      collection: entry.collectionTitle || entry.collectionKey || "",
      collectionKey: entry.collectionKey || "",
      options,
      total: options.reduce((sum, option) => sum + (Number(option.price) || 0) * (Number(option.quantity) || 1), 0),
    };
  }).filter((item) => item.options.length);
};

const normalizeAccountProfilePayload = (catalog, payload = {}, existing = {}, email = "", updatedAt = "") => ({
  schema: "photosbyelie.accountProfile.v1",
  email: String(email || existing.email || "").trim().toLowerCase(),
  liked: normalizeAccountLiked(catalog, payload.liked || payload.likes || existing.liked || []),
  basket: normalizeAccountBasket(catalog, payload.basket || existing.basket || []),
  language: ["en", "fr", "es"].includes(String(payload.language || existing.language || "").trim().toLowerCase())
    ? String(payload.language || existing.language).trim().toLowerCase()
    : "",
  theme: ["light", "dark"].includes(String(payload.theme || existing.theme || "").trim().toLowerCase())
    ? String(payload.theme || existing.theme).trim().toLowerCase()
    : "",
  createdAt: existing.createdAt || updatedAt,
  updatedAt,
});

const publicOrder = (order) => ({
  id: order.id,
  status: order.status,
  checkoutMode: order.checkoutMode,
  buyerEmail: order.buyerEmail,
  currency: order.currency,
  originalSubtotalAmount: order.originalSubtotalAmount ?? order.subtotalAmount ?? order.amountExpected,
  subtotalAmount: order.subtotalAmount ?? order.originalSubtotalAmount ?? order.amountExpected,
  discountCode: order.discountCode || "",
  discountLabel: order.discountLabel || "",
  discountAmount: order.discountAmount || 0,
  discountedSubtotalAmount: order.discountedSubtotalAmount ?? Math.max(0, Number(order.subtotalAmount ?? order.originalSubtotalAmount ?? 0) - Number(order.discountAmount || 0)),
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
      checkoutAmount: product.checkoutAmount ?? product.amount,
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
  deliveryEmail: order.deliveryEmail ? {
    status: order.deliveryEmail.status || "unknown",
    provider: order.deliveryEmail.provider || null,
    messageId: order.deliveryEmail.messageId || null,
    directLinkCount: Number(order.deliveryEmail.directLinkCount || 0) || null,
    resendCount: Number(order.deliveryEmail.resendCount || 0) || 0,
    orderUrl: order.deliveryEmail.orderUrl || null,
    sentAt: order.deliveryEmail.sentAt || null,
    failedAt: order.deliveryEmail.failedAt || null,
    error: order.deliveryEmail.error ? {
      code: order.deliveryEmail.error.code || "delivery_email_failed",
      message: order.deliveryEmail.error.message || "Delivery email could not be sent.",
    } : null,
  } : null,
  stripe: {
    checkoutSessionId: order.checkoutSessionId,
    paymentIntentId: order.paymentIntentId || null,
  },
  createdAt: order.createdAt,
  paidAt: order.paidAt || null,
  updatedAt: order.updatedAt,
});

const orderTime = (order) => {
  const timestamp = Date.parse(order?.updatedAt || order?.paidAt || order?.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
};

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

const normalizeProductLookupItems = (incomingItems = []) => {
  if (!Array.isArray(incomingItems)) return [];
  const seen = new Set();
  const rows = [];
  incomingItems.forEach((item) => {
    const photoId = String(item?.photoId || item?.id || "").trim();
    if (!photoId) return;
    const rawOptions = Array.isArray(item?.options)
      ? item.options
      : [item?.productId || item?.optionId || item?.product].filter(Boolean);
    rawOptions.forEach((rawOption) => {
      const productId = String(typeof rawOption === "string" ? rawOption : rawOption?.id || rawOption?.productId || "").trim();
      if (!productId) return;
      const key = downloadRowKey(photoId, productId);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ photoId, productId });
    });
  });
  return rows;
};

const paidOrderTimestamp = (order) => {
  if (!["ready", "preparing"].includes(order?.status)) return null;
  if (Number(order?.amountPaid || 0) <= 0) return null;
  const timestamp = Date.parse(order.paidAt || order.delivery?.readyAt || order.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : null;
};

const purchaseAllowanceCandidateRows = (order, buyerEmail) => {
  if (String(order?.buyerEmail || "").trim().toLowerCase() !== buyerEmail) return [];
  const purchasedAtMs = paidOrderTimestamp(order);
  if (!Number.isFinite(purchasedAtMs)) return [];
  return (order.items || []).flatMap((item) => (item.products || []).map((product) => ({
    photoId: item.photoId || "",
    productId: product.id || "",
    productLabel: product.label || product.id || "Download",
    title: item.title || item.photoId || "Photo",
    purchasedAtMs,
    purchasedAt: new Date(purchasedAtMs).toISOString(),
  }))).filter((row) => row.photoId && row.productId);
};

const purchaseAllowanceBoundary = ({ purchasedAtMs, nowMs, windowMs }) => {
  const ageMs = nowMs - purchasedAtMs;
  if (ageMs < 0) return { covered: false, boundary: "future" };
  if (ageMs === windowMs) return { covered: true, boundary: "exact" };
  if (ageMs <= windowMs) return { covered: true, boundary: "within" };
  return { covered: false, boundary: "expired" };
};

const purchaseAllowanceRows = ({
  orders = [],
  buyerEmail,
  items,
  nowDate,
  allowanceSeconds,
}) => {
  const requestedItems = normalizeProductLookupItems(items);
  const nowMs = nowDate.getTime();
  const windowMs = boundedPositiveInteger(allowanceSeconds, DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS) * 1000;
  const allowanceDays = Math.round(windowMs / (SECONDS_PER_DAY * 1000));
  const windowStartsAt = new Date(nowMs - windowMs).toISOString();
  const latestByProduct = new Map();
  orders.forEach((order) => {
    purchaseAllowanceCandidateRows(order, buyerEmail).forEach((row) => {
      const key = downloadRowKey(row.photoId, row.productId);
      const existing = latestByProduct.get(key);
      if (!existing || row.purchasedAtMs > existing.purchasedAtMs) latestByProduct.set(key, row);
    });
  });
  return requestedItems.map((item) => {
    const match = latestByProduct.get(downloadRowKey(item.photoId, item.productId));
    const base = {
      ...item,
      source: PURCHASE_ALLOWANCE_SOURCE,
      sourceDetail: PURCHASE_ALLOWANCE_SOURCE_DETAIL,
      allowanceDays,
      checkedAt: nowDate.toISOString(),
      windowStartsAt,
      covered: false,
      boundary: match ? "expired" : "not_purchased",
      purchasedAt: null,
      allowanceEndsAt: null,
      title: match?.title || "",
      productLabel: match?.productLabel || "",
    };
    if (!match) return base;
    const boundary = purchaseAllowanceBoundary({ purchasedAtMs: match.purchasedAtMs, nowMs, windowMs });
    return {
      ...base,
      covered: boundary.covered,
      boundary: boundary.boundary,
      purchasedAt: match.purchasedAt,
      allowanceEndsAt: new Date(match.purchasedAtMs + windowMs).toISOString(),
      title: match.title,
      productLabel: match.productLabel,
    };
  });
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

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));

const humanDownloadEndDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const downloadAvailabilityLabel = (expiresAt, availableFrom) => {
  const endDate = humanDownloadEndDate(expiresAt);
  if (!endDate) return "";
  const start = Date.parse(availableFrom || "");
  const end = Date.parse(expiresAt || "");
  const days = Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)))
    : null;
  return days
    ? `Available for ${days} day${days === 1 ? "" : "s"} (ends ${endDate})`
    : `Available until ${endDate}`;
};

const absoluteUrl = (baseUrl, path) => {
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return String(path || "");
  }
};

const orderRecoveryUrl = (order, ordersUrl) => {
  const cacheKey = [order.id, order.updatedAt || order.delivery?.preparedAt || order.deliveryEmail?.sentAt || ""]
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9_-]+/g, "");
  try {
    const url = new URL(ordersUrl);
    url.searchParams.delete("session_id");
    url.searchParams.delete("checkout");
    url.searchParams.set("id", order.id);
    url.searchParams.set("email", order.buyerEmail);
    url.searchParams.set("lookup", "order");
    url.searchParams.set("cb", cacheKey);
    return url.href;
  } catch {
    const joiner = String(ordersUrl || "").includes("?") ? "&" : "?";
    return `${ordersUrl}${joiner}id=${encodeURIComponent(order.id)}&email=${encodeURIComponent(order.buyerEmail)}&lookup=order&cb=${encodeURIComponent(cacheKey)}`;
  }
};

const deliveryDownloadRows = ({ order, downloadBaseUrl }) => {
  const availableFrom = order.delivery?.readyAt || order.paidAt || order.updatedAt || order.createdAt || null;
  const itemByPhotoId = new Map((order.items || []).map((item) => [item.photoId, item]));
  if (order.delivery?.files?.length) {
    return order.delivery.files.map((file) => {
      const item = itemByPhotoId.get(file.photoId) || {};
      return {
        photoId: file.photoId || "",
        productId: file.productId || "",
        title: item.title || file.title || file.photoId || "Purchased file",
        productLabel: file.productLabel || file.productId || "Download",
        filename: file.name || `${file.photoId || "photosbyelie"}-${file.productId || "download"}`,
        url: absoluteUrl(downloadBaseUrl, file.downloadUrl),
        expiresAt: file.expiresAt || null,
        availableFrom,
        isArchive: false,
      };
    });
  }
  if (order.delivery?.downloadUrl) {
    return [{
      photoId: "",
      productId: "",
      title: `Photos By Elie order ${order.id}`,
      productLabel: "Download ZIP",
      filename: order.delivery.zipKey?.split("/")?.pop?.() || `photosbyelie-order-${order.id}.zip`,
      url: absoluteUrl(downloadBaseUrl, order.delivery.downloadUrl),
      expiresAt: null,
      isArchive: true,
    }];
  }
  return [];
};

const downloadRowKey = (photoId, productId) => `${photoId || ""}::${productId || ""}`;

const purchasedProductRows = (order) => (order.items || []).flatMap((item) =>
  (item.products || []).map((product) => ({
    photoId: item.photoId || "",
    productId: product.id || "",
    title: item.title || item.photoId || "Photo",
    productLabel: product.label || product.id || "Download",
  }))
);

const purchasedDownloadRows = (order, downloadRows) => {
  const directByProduct = new Map(downloadRows
    .filter((row) => row.photoId && row.productId && row.url)
    .map((row) => [downloadRowKey(row.photoId, row.productId), row]));
  const archiveRow = downloadRows.find((row) => row.isArchive && row.url) || null;
  return purchasedProductRows(order).map((row) => ({
    ...row,
    download: directByProduct.get(downloadRowKey(row.photoId, row.productId)) || archiveRow,
  }));
};

const emailDownloadLine = (row) => {
  const label = `${row.title} - ${row.productLabel}`;
  if (!row.download?.url) return `- ${label}`;
  const filename = row.download.filename ? ` (file: ${row.download.filename})` : "";
  const archive = row.download.isArchive ? " (order ZIP)" : "";
  const expiry = row.download.expiresAt ? ` - ${downloadAvailabilityLabel(row.download.expiresAt, row.download.availableFrom)}` : "";
  return `- ${label}: ${row.download.url}${filename}${archive}${expiry}`;
};

const buildOrderReadyEmail = ({
  order,
  ordersUrl,
  downloadBaseUrl,
  includeDirectDownloadLinks = true,
  idempotencyKey = `photosbyelie-order-ready-${order.id}`,
}) => {
  const orderUrl = orderRecoveryUrl(order, ordersUrl);
  const downloadRows = includeDirectDownloadLinks ? deliveryDownloadRows({ order, downloadBaseUrl }) : [];
  const purchasedRows = purchasedDownloadRows(order, downloadRows);
  const linkedPurchaseCount = purchasedRows.filter((row) => row.download?.url).length;
  const textLines = [
    "Your Photos By Elie downloads are ready.",
    "",
    `Order: ${order.id}`,
    "",
    "Purchased downloads:",
    ...purchasedRows.map(emailDownloadLine),
    "",
    `You can also use the order download page: ${orderUrl}`,
    "This page keeps your order record. If a file link expires, use it with your order email to ask support for a fresh link.",
    "",
    "Thank you,",
    "Photos By Elie",
  ];
  const purchaseList = purchasedRows.length
    ? `<ul>${purchasedRows.map((row) => {
        const label = `${row.title} - ${row.productLabel}`;
        return `
        <li>
          ${row.download?.url
            ? `<a href="${escapeHtml(row.download.url)}">${escapeHtml(label)}</a>`
            : `<span>${escapeHtml(label)}</span>`}
          ${row.download?.filename ? `<br><small>File: ${escapeHtml(row.download.filename)}${row.download.isArchive ? " (order ZIP)" : ""}</small>` : ""}
          ${row.download?.expiresAt ? `<br><small>${escapeHtml(downloadAvailabilityLabel(row.download.expiresAt, row.download.availableFrom))}</small>` : ""}
        </li>
      `;
      }).join("")}</ul>`
    : "<p>No purchased download rows were recorded for this order.</p>";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f1b18">
      <h1>Your Photos By Elie downloads are ready</h1>
      <p>Order <strong>${escapeHtml(order.id)}</strong> is paid and ready.</p>
      <h2>Purchased downloads</h2>
      ${purchaseList}
      <p>You can also use the <a href="${escapeHtml(orderUrl)}">order download page</a>.</p>
      <p>This page keeps your order record. If a file link expires, use it with your order email to ask support for a fresh link.</p>
      <p>Thank you,<br>Photos By Elie</p>
    </div>
  `;
  return {
    to: order.buyerEmail,
    subject: `Your Photos By Elie downloads are ready - ${order.id}`,
    text: textLines.join("\n"),
    html,
    idempotencyKey,
    orderUrl,
    directLinkCount: linkedPurchaseCount,
  };
};

const resendIdempotencyKey = (orderId, requestedAt) => {
  const suffix = String(requestedAt || "")
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .slice(0, 32);
  return `photosbyelie-order-ready-${orderId}-resend-${suffix || "manual"}`;
};

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
  realEstateAuth = null,
  realEstateDeliverables = null,
  googleOAuthAuth = null,
  accessAuth = null,
  accessUserRegistry = createMemoryAccessUserRegistry(),
  accessAdminEmail = "",
  ownerActionStore = createMemoryOwnerActionStore(),
  sidecarStateStore = createMemorySidecarStateStore({ now, randomUUID }),
  ownerConnectorAuth = null,
  ownerConnectorPackage = null,
  authAllowedReturnOrigins = [],
  emailClient = null,
  downloadBaseUrl = ordersUrl,
  includeDirectDownloadLinks = true,
  downloadTokenTtlSeconds = DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
  downloadTokenMaxDownloads = DEFAULT_DOWNLOAD_TOKEN_MAX_DOWNLOADS,
  purchaseAllowanceSeconds = downloadTokenTtlSeconds,
  discountCodes = [],
  analytics = null,
} = {}) => {
  if (!catalog) throw new Error("createPhotosByElieWorker requires a catalog index.");
  const deliveryClient = delivery || defaultDelivery({ now, randomUUID });
  const stripeProvider = stripe.provider || "stripe";
  const discountDefinitions = discountDefinitionsByCode(discountCodes);
  const authReturnOrigins = normalizeOriginList(authAllowedReturnOrigins);
  const adminEmail = normalizeAdminEmail(accessAdminEmail);
  const downloadPolicy = () => {
    const nowDate = now();
    const ttlSeconds = boundedPositiveInteger(downloadTokenTtlSeconds, DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS);
    return {
      expiresAt: isoAfterSeconds(nowDate, ttlSeconds),
      downloadLimit: boundedPositiveInteger(downloadTokenMaxDownloads, DEFAULT_DOWNLOAD_TOKEN_MAX_DOWNLOADS),
    };
  };
  const recordAnalytics = async (event) => {
    if (!analytics || typeof analytics.putEvent !== "function") return;
    try {
      await analytics.putEvent({ source: "worker", ...event });
    } catch {
      // Analytics must never block checkout, fulfillment, or downloads.
    }
  };

  const recordAnalyticsEvents = async (request) => {
    const payload = await parseJson(request);
    const events = Array.isArray(payload.events) ? payload.events : [payload.event || payload];
    if (!analytics || typeof analytics.putEvents !== "function") {
      return json({ ok: true, accepted: 0, disabled: true });
    }
    const saved = await analytics.putEvents(events);
    return json({ ok: true, accepted: saved.length });
  };

  const maybeSendReadyEmail = async (order, { force = false, throwOnFailure = false } = {}) => {
    if (!emailClient || typeof emailClient.send !== "function") return order;
    if (!force && order.deliveryEmail?.status === "sent") return order;
    const requestedAt = now().toISOString();
    const email = buildOrderReadyEmail({
      order,
      ordersUrl,
      downloadBaseUrl,
      includeDirectDownloadLinks,
      idempotencyKey: force ? resendIdempotencyKey(order.id, requestedAt) : undefined,
    });
    const sending = {
      ...order,
      deliveryEmail: {
        status: "sending",
        provider: emailClient.provider || "email",
        requestedAt,
        idempotencyKey: email.idempotencyKey,
      },
      updatedAt: requestedAt,
    };
    await store.putOrder(sending);
    try {
      const result = await emailClient.send(email);
      const sentAt = now().toISOString();
      const sent = {
        ...sending,
        deliveryEmail: {
          status: "sent",
          provider: result.provider || emailClient.provider || "email",
          messageId: result.messageId || null,
          idempotencyKey: result.idempotencyKey || email.idempotencyKey,
          directLinkCount: email.directLinkCount,
          orderUrl: email.orderUrl,
          sentAt,
          resendCount: Number(order.deliveryEmail?.resendCount || 0) + (force ? 1 : 0),
        },
        updatedAt: sentAt,
      };
      await store.putOrder(sent);
      return sent;
    } catch (error) {
      const failedAt = now().toISOString();
      if (throwOnFailure) {
        const restored = {
          ...order,
          deliveryEmail: {
            ...(order.deliveryEmail || {}),
            lastResendFailedAt: failedAt,
            lastResendError: {
              code: error?.code || "delivery_email_failed",
              message: error?.message || "Delivery email could not be sent.",
            },
          },
          updatedAt: failedAt,
        };
        await store.putOrder(restored);
        throw Object.assign(new Error(error?.message || "Delivery email could not be sent."), {
          status: error?.status || 502,
          code: error?.code || "delivery_email_failed",
        });
      }
      const failed = {
        ...sending,
        deliveryEmail: {
          status: "failed",
          provider: emailClient.provider || "email",
          idempotencyKey: email.idempotencyKey,
          orderUrl: email.orderUrl,
          failedAt,
          error: {
            code: error?.code || "delivery_email_failed",
            message: error?.message || "Delivery email could not be sent.",
          },
        },
        updatedAt: failedAt,
      };
      await store.putOrder(failed);
      return failed;
    }
  };

  const resendReadyEmail = async (request, orderId) => {
    if (!emailClient || typeof emailClient.send !== "function") {
      return errorJson(503, "delivery_email_unavailable", "Delivery email is not configured.");
    }
    const payload = await parseJson(request);
    const email = String(payload.email || payload.buyerEmail || "").trim().toLowerCase();
    if (!validEmail(email)) {
      return errorJson(400, "invalid_email", "Resending a delivery email requires the checkout email.");
    }
    const order = await store.getOrder(orderId);
    if (!order) return errorJson(404, "unknown_order", "Order was not found.");
    if (email !== order.buyerEmail) {
      return errorJson(403, "order_email_required", "Enter the email used at checkout to resend this order email.");
    }
    if (order.status !== "ready" || !order.delivery) {
      return errorJson(409, "order_not_ready", "Delivery email can be resent only after the order files are ready.");
    }
    const sent = await maybeSendReadyEmail(order, { force: true, throwOnFailure: true });
    return json({ order: publicOrder(sent), deliveryEmail: publicOrder(sent).deliveryEmail });
  };

  const checkRecentPurchases = async (request) => {
    const payload = await parseJson(request);
    const buyerEmail = String(payload.email || payload.buyerEmail || "").trim().toLowerCase();
    if (!validEmail(buyerEmail)) {
      return errorJson(400, "invalid_email", "Recent purchase checks require the checkout email.");
    }
    const items = normalizeProductLookupItems(payload.items || payload.basket || []);
    if (!items.length) {
      const nowDate = now();
      const allowanceSeconds = boundedPositiveInteger(purchaseAllowanceSeconds, DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS);
      return json({
        source: PURCHASE_ALLOWANCE_SOURCE,
        sourceDetail: PURCHASE_ALLOWANCE_SOURCE_DETAIL,
        allowanceDays: Math.round(allowanceSeconds / SECONDS_PER_DAY),
        checkedAt: nowDate.toISOString(),
        windowStartsAt: new Date(nowDate.getTime() - (allowanceSeconds * 1000)).toISOString(),
        items: [],
      });
    }
    if (typeof store.listOrders !== "function") {
      return json({
        source: PURCHASE_ALLOWANCE_SOURCE,
        sourceDetail: `${PURCHASE_ALLOWANCE_SOURCE_DETAIL}; purchase lookup is unavailable because the current store cannot list order records.`,
        allowanceDays: Math.round(boundedPositiveInteger(purchaseAllowanceSeconds, DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS) / SECONDS_PER_DAY),
        checkedAt: now().toISOString(),
        items: items.map((item) => ({
          ...item,
          covered: false,
          boundary: "history_unavailable",
          purchasedAt: null,
          allowanceEndsAt: null,
        })),
      });
    }
    const nowDate = now();
    const orders = await store.listOrders();
    const rows = purchaseAllowanceRows({
      orders,
      buyerEmail,
      items,
      nowDate,
      allowanceSeconds: purchaseAllowanceSeconds,
    });
    const allowanceSeconds = boundedPositiveInteger(purchaseAllowanceSeconds, DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS);
    return json({
      source: PURCHASE_ALLOWANCE_SOURCE,
      sourceDetail: PURCHASE_ALLOWANCE_SOURCE_DETAIL,
      allowanceDays: Math.round(allowanceSeconds / SECONDS_PER_DAY),
      checkedAt: nowDate.toISOString(),
      windowStartsAt: new Date(nowDate.getTime() - (allowanceSeconds * 1000)).toISOString(),
      coveredCount: rows.filter((row) => row.covered).length,
      items: rows,
    });
  };

  const accountOrdersFor = async (email) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || typeof store.listOrders !== "function") return [];
    const orders = await store.listOrders();
    return orders
      .filter((order) => String(order?.buyerEmail || "").trim().toLowerCase() === normalizedEmail)
      .sort((left, right) => orderTime(right) - orderTime(left))
      .map(publicOrder);
  };

  const storedAccountProfileFor = async (email) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const existing = typeof store.getAccountProfile === "function"
      ? await store.getAccountProfile(normalizedEmail)
      : null;
    return normalizeAccountProfilePayload(catalog, {}, existing || {}, normalizedEmail, existing?.updatedAt || now().toISOString());
  };

  const getAccountProfile = async (request) => {
    const session = await authSessionFor(request, { required: true });
    const profile = await storedAccountProfileFor(session.email);
    const orders = await accountOrdersFor(session.email);
    return credentialedJson(request, { ok: true, profile, orders });
  };

  const putAccountProfile = async (request) => {
    const session = await authSessionFor(request, { required: true });
    if (typeof store.putAccountProfile !== "function") {
      return credentialedErrorJson(request, 503, "account_profile_unavailable", "Account profile storage is not configured.");
    }
    const payload = await parseJson(request);
    const existing = typeof store.getAccountProfile === "function"
      ? await store.getAccountProfile(session.email)
      : null;
    const updatedAt = now().toISOString();
    const profile = normalizeAccountProfilePayload(catalog, payload, existing || {}, session.email, updatedAt);
    const saved = await store.putAccountProfile(profile);
    const orders = await accountOrdersFor(session.email);
    return credentialedJson(request, { ok: true, profile: saved || profile, orders });
  };

  const getAccountOrder = async (request, orderId) => {
    const session = await authSessionFor(request, { required: true });
    const order = await store.getOrder(orderId);
    if (!order) return credentialedErrorJson(request, 404, "unknown_order", "Order was not found.");
    if (String(order.buyerEmail || "").trim().toLowerCase() !== String(session.email || "").trim().toLowerCase()) {
      return credentialedErrorJson(request, 403, "account_order_forbidden", "This order is not attached to the signed-in account.");
    }
    return credentialedJson(request, { order: publicOrder(order) });
  };

  const createCheckout = async (request, checkoutMode, accountSession = null) => {
    const checkoutJson = (body, status = 200) => checkoutMode === "account"
      ? credentialedJson(request, body, status)
      : json(body, status);
    const checkoutErrorJson = (status, code, message, details = undefined) => checkoutMode === "account"
      ? credentialedErrorJson(request, status, code, message, details)
      : errorJson(status, code, message, details);
    const payload = await parseJson(request);
    const requestedEmail = String(payload.email || payload.buyerEmail || "").trim().toLowerCase();
    const buyerEmail = checkoutMode === "account" ? String(accountSession?.email || "").trim().toLowerCase() : requestedEmail;
    if (checkoutMode === "account" && requestedEmail && requestedEmail !== buyerEmail) {
      return checkoutErrorJson(403, "account_email_mismatch", "Signed-in checkout must use the verified account email.");
    }
    if (!validEmail(buyerEmail)) {
      return checkoutErrorJson(400, "invalid_email", "Checkout requires a valid buyer email.");
    }

    const items = normalizeOrderItems(catalog, payload.items || payload.basket || []);
    const subtotalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    const expectedSubtotalAmount = Number(payload.expectedSubtotalAmount);
    if (Number.isFinite(expectedSubtotalAmount) && Math.round(expectedSubtotalAmount) !== subtotalAmount) {
      return checkoutErrorJson(409, "checkout_total_mismatch", "Basket prices changed before Stripe checkout. Refresh the basket and review the total before paying.", {
        browserSubtotalAmount: Math.round(expectedSubtotalAmount),
        workerSubtotalAmount: subtotalAmount,
      });
    }
    const createdAt = now().toISOString();
    const nowDate = new Date(createdAt);
    const discount = validateCheckoutDiscount({
      discountCode: payload.discountCode || payload.couponCode || payload.promoCode || payload.promotionCode,
      discountDefinitions,
      buyerEmail,
      subtotalAmount,
      nowDate,
    });
    const minimumChargeAdjustment = minimumChargeAdjustmentFor(discount.discountedSubtotalAmount);
    const amountExpected = discount.discountedSubtotalAmount + minimumChargeAdjustment;
    const orderId = createOrderId(now, randomUUID);
    if (typeof deliveryClient.validateOrder === "function") {
      await deliveryClient.validateOrder({
        id: orderId,
        checkoutMode,
        buyerEmail,
        currency: ORDER_CURRENCY,
        originalSubtotalAmount: subtotalAmount,
        subtotalAmount,
        discountCode: discount.code,
        discountLabel: discount.label,
        discountAmount: discount.amount,
        discountedSubtotalAmount: discount.discountedSubtotalAmount,
        minimumChargeAdjustment,
        amountExpected,
        amountPaid: 0,
        items,
        createdAt,
        updatedAt: createdAt,
      });
    }
    const receiptDescription = `Photos By Elie order ${orderId}. Download or recover files at ${ordersUrl} using this order number and checkout email.`;

    const lineItems = items.flatMap((item) => item.products.map((product) => ({
      photoId: item.photoId,
      productId: product.id,
      name: checkoutLineName(item.title, product.label),
      quantity: 1,
      unit_amount: product.unitAmount,
      amount: product.amount,
    })));
    const checkoutLineItems = allocateDiscountedLineItems(lineItems, discount.discountedSubtotalAmount);
    const checkoutAmountByProduct = new Map();
    checkoutLineItems.forEach((lineItem) => {
      if (!lineItem.photoId || !lineItem.productId) return;
      const key = `${lineItem.photoId}::${lineItem.productId}`;
      checkoutAmountByProduct.set(key, (checkoutAmountByProduct.get(key) || 0) + Number(lineItem.amount || 0));
    });
    const orderItems = items.map((item) => ({
      ...item,
      products: item.products.map((product) => ({
        ...product,
        checkoutAmount: checkoutAmountByProduct.get(`${item.photoId}::${product.id}`) ?? product.amount,
      })),
    }));
    if (minimumChargeAdjustment) {
      checkoutLineItems.push({
        photoId: MINIMUM_CHARGE_PRODUCT_ID,
        productId: MINIMUM_CHARGE_PRODUCT_ID,
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
      lineItems: checkoutLineItems,
      successUrl: successUrl.replace("{ORDER_ID}", encodeURIComponent(orderId)),
      cancelUrl,
      receiptDescription,
      metadata: {
        original_subtotal_amount: subtotalAmount,
        discount_code: discount.code,
        discount_amount: discount.amount,
        discounted_subtotal_amount: discount.discountedSubtotalAmount,
        amount_expected: amountExpected,
      },
    });

    const order = {
      id: orderId,
      status: "pending_payment",
      checkoutMode,
      buyerEmail,
      currency: ORDER_CURRENCY,
      originalSubtotalAmount: subtotalAmount,
      subtotalAmount,
      discountCode: discount.code,
      discountLabel: discount.label,
      discountAmount: discount.amount,
      discountedSubtotalAmount: discount.discountedSubtotalAmount,
      minimumChargeAdjustment,
      amountExpected,
      amountPaid: 0,
      items: orderItems,
      checkoutSessionId: checkoutSession.id,
      paymentIntentId: checkoutSession.payment_intent,
      receiptDescription,
      createdAt,
      updatedAt: createdAt,
    };
    await store.putOrder(order);
    await recordAnalytics({
      event: "checkout_session_created",
      checkoutMode,
      provider: stripeProvider,
      itemCount: orderItems.length,
      productCount: lineItems.length,
      amountCents: amountExpected,
      discountPresent: Boolean(discount.code),
    });

    return checkoutJson({
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

    if (order.status === "ready") return await maybeSendReadyEmail(order);

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
    let ready = {
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
    ready = await maybeSendReadyEmail(ready);
    await recordAnalytics({
      event: "payment_completed",
      checkoutMode: ready.checkoutMode,
      itemCount: ready.items.length,
      productCount: ready.items.reduce((sum, item) => sum + (item.products || []).length, 0),
      amountCents: ready.amountPaid,
      discountPresent: Boolean(ready.discountCode),
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
      await recordAnalytics({
        event: "download_success",
        downloadType: downloadRecord.productId ? "file" : "archive",
        photoId: downloadRecord.photoId || "",
        productId: downloadRecord.productId || "",
      });
    }
    return response;
  };

  const safeAuthReturnUrl = (request) => {
    const requestUrl = new URL(request.url);
    const returnTo = requestUrl.searchParams.get("returnTo") || "";
    if (!returnTo) return requestUrl.origin;
    try {
      const candidate = new URL(returnTo);
      const allowedOrigins = new Set([requestUrl.origin, ...authReturnOrigins]);
      return allowedOrigins.has(candidate.origin) ? candidate.href : requestUrl.origin;
    } catch {
      return requestUrl.origin;
    }
  };

  const isTailscaleHostname = (hostname) => {
    const parts = String(hostname || "").split(".").map((part) => Number(part));
    return parts.length === 4
      && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && parts[0] === 100
      && parts[1] >= 64
      && parts[1] <= 127;
  };

  const isLocalAuthTransferReturn = (returnTo) => {
    try {
      const candidate = new URL(returnTo);
      const hostname = candidate.hostname.replace(/^\[|\]$/g, "");
      return candidate.protocol === "http:"
        && (
          hostname === "localhost"
          || hostname === "127.0.0.1"
          || hostname === "::1"
          || isTailscaleHostname(hostname)
        );
    } catch {
      return false;
    }
  };

  const returnUrlWithLocalAuthTransfer = (returnTo, sessionToken = "") => {
    if (!sessionToken || !isLocalAuthTransferReturn(returnTo)) return returnTo;
    const url = new URL(returnTo);
    const hash = url.hash ? url.hash.slice(1) : "";
    const params = new URLSearchParams(hash.includes("=") ? hash : "");
    if (hash && !hash.includes("=")) params.set("pbe_return_hash", hash);
    params.set("pbe_auth_token", sessionToken);
    url.hash = params.toString();
    return url.href;
  };

  const accessIdentityFor = async (request, { required = false } = {}) => {
    if (!accessAuth) {
      if (required) {
        throw Object.assign(new Error("Google-backed access login is not configured."), {
          status: 503,
          code: "access_auth_unavailable",
        });
      }
      return null;
    }
    if (!required && typeof accessAuth.optionalSession === "function") {
      return accessAuth.optionalSession(request);
    }
    if (typeof accessAuth.requireSession === "function") {
      return accessAuth.requireSession(request);
    }
    if (required) {
      throw Object.assign(new Error("Google-backed access login is not configured."), {
        status: 503,
        code: "access_auth_unavailable",
      });
    }
    return null;
  };

  const googleIdentityFor = async (request, { required = false } = {}) => {
    if (!googleOAuthAuth) {
      if (required) {
        throw Object.assign(new Error("Google login is not configured."), {
          status: 503,
          code: "google_auth_unavailable",
        });
      }
      return null;
    }
    if (!required && typeof googleOAuthAuth.optionalSession === "function") {
      return googleOAuthAuth.optionalSession(request);
    }
    if (typeof googleOAuthAuth.requireSession === "function") {
      return googleOAuthAuth.requireSession(request);
    }
    if (required) {
      throw Object.assign(new Error("Google login is not configured."), {
        status: 503,
        code: "google_auth_unavailable",
      });
    }
    return null;
  };

  const authIdentityFor = async (request, { required = false } = {}) => {
    const googleIdentity = await googleIdentityFor(request);
    if (googleIdentity) return googleIdentity;
    return accessIdentityFor(request, { required });
  };

  const authSessionFor = async (request, { requiredRole = "", required = false } = {}) => {
    const identity = await authIdentityFor(request, { required: required || Boolean(requiredRole) });
    const session = await sessionForAccessIdentity(identity, { accessUserRegistry, adminEmail });
    if (requiredRole && !session.roles.includes(requiredRole)) {
      throw Object.assign(new Error(`This Google account is not authorized for ${requiredRole} access.`), {
        status: 403,
        code: `${requiredRole}_role_required`,
      });
    }
    return session;
  };

  const authSessionPayload = (session) => ({
    ok: true,
    authenticated: session.authenticated,
    user: session.authenticated ? {
      email: session.email,
      provider: session.provider,
      tier: session.tier,
      expiresAt: session.expiresAt,
    } : null,
    roles: session.roles,
    tier: session.tier,
    admin: session.admin,
    realEstateClients: session.realEstateClients,
    sessionSeconds: session.sessionSeconds,
  });

  const getAuthSession = async (request) => {
    const session = await authSessionFor(request);
    return credentialedJson(request, authSessionPayload(session));
  };

  const loginAuth = async (request) => {
    if (googleOAuthAuth?.loginUrlFor) {
      return redirect(await googleOAuthAuth.loginUrlFor(request, {
        returnTo: safeAuthReturnUrl(request),
        intent: new URL(request.url).searchParams.get("intent") || "",
        prompt: new URL(request.url).searchParams.get("prompt") || "select_account",
      }));
    }
    await accessIdentityFor(request, { required: true });
    return redirect(safeAuthReturnUrl(request));
  };

  const loginGoogleAuth = async (request) => {
    if (!googleOAuthAuth?.loginUrlFor) {
      const legacyUrl = new URL("/auth/login", new URL(request.url).origin);
      for (const [key, value] of new URL(request.url).searchParams.entries()) legacyUrl.searchParams.append(key, value);
      return redirect(legacyUrl.href);
    }
    const url = new URL(request.url);
    return redirect(await googleOAuthAuth.loginUrlFor(request, {
      returnTo: safeAuthReturnUrl(request),
      intent: url.searchParams.get("intent") || "",
      prompt: url.searchParams.get("prompt") || "select_account",
    }));
  };

  const callbackGoogleAuth = async (request) => {
    if (!googleOAuthAuth?.handleCallback) {
      return credentialedErrorJson(request, 503, "google_auth_unavailable", "Google login is not configured.");
    }
    const result = await googleOAuthAuth.handleCallback(request);
    return redirect(returnUrlWithLocalAuthTransfer(result.returnTo, result.sessionToken), 302, { "set-cookie": result.cookie });
  };

  const logoutAuth = async (request) => {
    const baseUrl = new URL(request.url).origin;
    if (googleOAuthAuth?.clearCookieFor) {
      return redirect(safeAuthReturnUrl(request), 302, { "set-cookie": googleOAuthAuth.clearCookieFor(request) });
    }
    if (accessAuth?.logoutUrlFor) return redirect(accessAuth.logoutUrlFor(baseUrl, { returnTo: safeAuthReturnUrl(request) }));
    return credentialedJson(request, { ok: true });
  };

  const getOwnerSession = async (request) => {
    const session = await authSessionFor(request, { requiredRole: "owner" });
    return credentialedJson(request, authSessionPayload(session));
  };

  const ownerActionId = () => `owner-action-${randomUUID().replace(/[^a-z0-9-]/gi, "").slice(0, 48)}`;
  const ownerActionHistory = (action, event) => [
    ...(Array.isArray(action.history) ? action.history : []),
    event,
  ].slice(-50);
  const cleanOwnerConnectorId = (value) => {
    const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned.slice(0, 80) || "manual-owner";
  };
  const ownerConnectorActionTypes = new Set([
    "owner-connector-check",
    "sidecar-culling-review",
    "sidecar-photos-index-sync",
    "sidecar-review-decision",
    "sidecar-upload-publish",
  ]);

  const requireOwnerConnector = async (request) => {
    if (!ownerConnectorAuth || typeof ownerConnectorAuth.requireConnector !== "function") {
      throw Object.assign(new Error("Owner connector authentication is not configured."), {
        status: 503,
        code: "owner_connector_auth_unavailable",
      });
    }
    return await ownerConnectorAuth.requireConnector(request);
  };

  const requireOwnerOrConnector = async (request) => {
    const authorization = String(request.headers.get("authorization") || "").trim().toLowerCase();
    if (authorization.startsWith("bearer ") && ownerConnectorAuth?.requireConnector) {
      try {
        const connector = await requireOwnerConnector(request);
        return { actorKind: "connector", actorId: connector.connectorId, connector };
      } catch (connectorError) {
        if (!accessAuth && !googleOAuthAuth) throw connectorError;
      }
    }
    try {
      const session = await authSessionFor(request, { requiredRole: "owner" });
      return { actorKind: "owner", actorId: session.email, session };
    } catch (ownerError) {
      if (ownerConnectorAuth?.requireConnector) {
        try {
          const connector = await requireOwnerConnector(request);
          return { actorKind: "connector", actorId: connector.connectorId, connector };
        } catch {
          // Prefer the browser/Owner auth error when both mechanisms fail.
        }
      }
      throw ownerError;
    }
  };

  const createOwnerAction = async (request) => {
    const session = await authSessionFor(request, { requiredRole: "owner" });
    if (!ownerActionStore || typeof ownerActionStore.putAction !== "function") {
      return credentialedErrorJson(request, 503, "owner_actions_unavailable", "Owner action queue is not configured.");
    }
    const payload = await parseJson(request);
    const actionType = String(payload.action || payload.type || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(actionType)) {
      return credentialedErrorJson(request, 400, "invalid_owner_action", "Owner action type is required.");
    }
    const timestamp = now().toISOString();
    const actionPayload = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
    const action = await ownerActionStore.putAction({
      schema: "photosbyelie.ownerAction.v1",
      id: ownerActionId(),
      type: actionType,
      state: "queued",
      payload: actionPayload,
      createdBy: session.email,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [{
        event: "queued",
        at: timestamp,
        by: session.email,
      }],
    });
    return credentialedJson(request, { ok: true, action }, 202);
  };

  const querySidecarDecisions = async (request) => {
    const actor = await requireOwnerOrConnector(request);
    if (!sidecarStateStore || typeof sidecarStateStore.queryDecisions !== "function") {
      return credentialedErrorJson(request, 503, "sidecar_state_unavailable", "Sidecar cloud decision state is not configured.");
    }
    const payload = await parseJson(request);
    const assetIds = Array.isArray(payload.assetIds)
      ? payload.assetIds
      : (Array.isArray(payload.assets) ? payload.assets : []);
    const decisions = await sidecarStateStore.queryDecisions({ assetIds });
    return credentialedJson(request, {
      ok: true,
      schema: "photosbyelie.sidecarDecisionQuery.v1",
      actor: { kind: actor.actorKind, id: actor.actorId },
      count: Object.keys(decisions || {}).length,
      decisions,
    });
  };

  const applySidecarDecision = async (request) => {
    const actor = await requireOwnerOrConnector(request);
    if (!sidecarStateStore || typeof sidecarStateStore.applyDecision !== "function") {
      return credentialedErrorJson(request, 503, "sidecar_state_unavailable", "Sidecar cloud decision state is not configured.");
    }
    const payload = await parseJson(request);
    const timestamp = now().toISOString();
    const result = await sidecarStateStore.applyDecision(payload, {
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      timestamp,
    });
    return credentialedJson(request, {
      ok: true,
      schema: "photosbyelie.sidecarDecisionApply.v1",
      actor: { kind: actor.actorKind, id: actor.actorId },
      assetId: result.assetId,
      state: result.state,
      before: result.before,
      changedFamilies: result.changedFamilies,
      pendingSyncCount: result.state.pendingSyncCount || 0,
    });
  };

  const applySidecarDecisions = async (request) => {
    const actor = await requireOwnerOrConnector(request);
    if (!sidecarStateStore || typeof sidecarStateStore.applyDecision !== "function") {
      return credentialedErrorJson(request, 503, "sidecar_state_unavailable", "Sidecar cloud decision state is not configured.");
    }
    const payload = await parseJson(request);
    const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
    if (!decisions.length) return credentialedErrorJson(request, 400, "sidecar_decisions_required", "decisions must contain at least one Sidecar decision.");
    if (decisions.length > 500) return credentialedErrorJson(request, 400, "sidecar_decisions_limit", "Sidecar batch decisions are limited to 500 rows.");
    const timestamp = now().toISOString();
    const context = {
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      timestamp,
    };
    const items = typeof sidecarStateStore.applyDecisions === "function"
      ? await sidecarStateStore.applyDecisions(decisions, context)
      : [];
    if (!items.length && decisions.length) {
      for (const decision of decisions) {
        items.push(await sidecarStateStore.applyDecision(decision, {
          actorKind: actor.actorKind,
          actorId: actor.actorId,
          timestamp,
        }));
      }
    }
    return credentialedJson(request, {
      ok: true,
      schema: "photosbyelie.sidecarDecisionApplyBatch.v1",
      actor: { kind: actor.actorKind, id: actor.actorId },
      count: items.length,
      items: items.map((item) => ({
        assetId: item.assetId,
        state: item.state,
        before: item.before,
        changedFamilies: item.changedFamilies,
        pendingSyncCount: item.state.pendingSyncCount || 0,
      })),
    });
  };

  const upsertSidecarDecisions = async (request) => {
    const actor = await requireOwnerOrConnector(request);
    if (!sidecarStateStore || typeof sidecarStateStore.putDecisions !== "function") {
      return credentialedErrorJson(request, 503, "sidecar_state_unavailable", "Sidecar cloud decision state is not configured.");
    }
    const payload = await parseJson(request);
    const decisions = Array.isArray(payload.decisions)
      ? payload.decisions
      : [payload.decision || payload.state || payload];
    const timestamp = now().toISOString();
    const items = await sidecarStateStore.putDecisions(decisions.filter((item) => item && typeof item === "object").slice(0, 500), {
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      timestamp,
    });
    return credentialedJson(request, {
      ok: true,
      schema: "photosbyelie.sidecarDecisionUpsert.v1",
      actor: { kind: actor.actorKind, id: actor.actorId },
      count: items.length,
      items,
    });
  };

  const listOwnerActions = async (request) => {
    await authSessionFor(request, { requiredRole: "owner" });
    if (!ownerActionStore || typeof ownerActionStore.listActions !== "function") {
      return credentialedErrorJson(request, 503, "owner_actions_unavailable", "Owner action queue listing is not configured.");
    }
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 25);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 25));
    const actions = await ownerActionStore.listActions({ limit });
    return credentialedJson(request, { ok: true, actions, limit });
  };

  const listOwnerConnectors = async (request) => {
    await authSessionFor(request, { requiredRole: "owner" });
    const connectors = typeof ownerActionStore?.listConnectors === "function"
      ? await ownerActionStore.listConnectors()
      : [];
    return credentialedJson(request, { ok: true, connectors });
  };

  const downloadOwnerConnector = async (request) => {
    await authSessionFor(request, { requiredRole: "owner" });
    if (!ownerConnectorPackage || typeof ownerConnectorPackage.getMacPackage !== "function") {
      return credentialedErrorJson(request, 503, "owner_connector_package_unavailable", "Mac connector download is not configured.");
    }
    const asset = await ownerConnectorPackage.getMacPackage();
    if (!asset) return credentialedErrorJson(request, 404, "owner_connector_package_missing", "Mac connector package is not published yet.");
    return new Response(asset.body, {
      status: 200,
      headers: credentialedCorsHeaders(request, asset.headers || {}),
    });
  };

  const heartbeatOwnerConnector = async (request) => {
    const connector = await requireOwnerConnector(request);
    const payload = await parseJson(request);
    const timestamp = now().toISOString();
    const health = {
      schema: "photosbyelie.ownerConnector.v1",
      id: connector.connectorId,
      state: "online",
      hostname: String(payload.hostname || "").trim().slice(0, 120),
      platform: String(payload.platform || "macos").trim().slice(0, 80),
      version: String(payload.version || "").trim().slice(0, 80),
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20)
        : [],
      lastSeenAt: timestamp,
    };
    const saved = typeof ownerActionStore?.putConnector === "function"
      ? await ownerActionStore.putConnector(health)
      : health;
    return json({ ok: true, connector: saved });
  };

  const listConnectorActions = async (request) => {
    const connector = await requireOwnerConnector(request);
    if (!ownerActionStore || typeof ownerActionStore.listActions !== "function") {
      return json({ ok: false, error: { code: "owner_actions_unavailable", message: "Owner action queue listing is not configured." } }, 503);
    }
    const actions = await ownerActionStore.listActions({ limit: 100 });
    const available = actions.filter((action) => {
      if (!ownerConnectorActionTypes.has(action.type)) return false;
      if (action.state === "claimed") return action.claim?.connectorId === connector.connectorId;
      if (action.state !== "queued") return false;
      const requested = cleanOwnerConnectorId(action.payload?.requestedConnector || "");
      return !action.payload?.requestedConnector || requested === connector.connectorId;
    });
    return json({ ok: true, connectorId: connector.connectorId, actions: available.slice(0, 25) });
  };

  const getOwnerAction = async (request, actionId) => {
    await authSessionFor(request, { requiredRole: "owner" });
    if (!ownerActionStore || typeof ownerActionStore.getAction !== "function") {
      return credentialedErrorJson(request, 503, "owner_actions_unavailable", "Owner action queue is not configured.");
    }
    const action = await ownerActionStore.getAction(actionId);
    if (!action) return credentialedErrorJson(request, 404, "owner_action_not_found", "Owner action was not found.");
    return credentialedJson(request, { ok: true, action });
  };

  const transitionOwnerAction = async (request, actionId, transition, connectorSession = null) => {
    const session = connectorSession || await authSessionFor(request, { requiredRole: "owner" });
    if (!ownerActionStore || typeof ownerActionStore.getAction !== "function" || typeof ownerActionStore.putAction !== "function") {
      return credentialedErrorJson(request, 503, "owner_actions_unavailable", "Owner action queue is not configured.");
    }
    const action = await ownerActionStore.getAction(actionId);
    if (!action) return credentialedErrorJson(request, 404, "owner_action_not_found", "Owner action was not found.");
    const payload = await parseJson(request);
    const nowDate = now();
    const timestamp = nowDate.toISOString();
    let next = null;

    if (transition === "claim") {
      if (action.state !== "queued") {
        return credentialedErrorJson(request, 409, "owner_action_not_claimable", "Only queued Owner actions can be claimed.");
      }
      const connectorId = connectorSession?.connectorId
        || cleanOwnerConnectorId(payload.connectorId || payload.connector || payload.machine);
      const leaseExpiresAt = new Date(nowDate.getTime() + 4 * 60 * 60 * 1000).toISOString();
      next = {
        ...action,
        state: "claimed",
        claim: {
          connectorId,
          claimedBy: connectorSession ? `connector:${connectorId}` : session.email,
          claimedAt: timestamp,
          leaseExpiresAt,
        },
        updatedAt: timestamp,
      };
      next.history = ownerActionHistory(action, {
        event: "claimed",
        at: timestamp,
        by: connectorSession ? `connector:${connectorId}` : session.email,
        connectorId,
        leaseExpiresAt,
      });
    } else if (transition === "complete") {
      if (action.state !== "claimed") {
        return credentialedErrorJson(request, 409, "owner_action_not_claimed", "Only claimed Owner actions can be completed.");
      }
      if (connectorSession && action.claim?.connectorId !== connectorSession.connectorId) {
        return json({ ok: false, error: { code: "owner_action_connector_mismatch", message: "This action is claimed by another connector." } }, 409);
      }
      const result = payload.result && typeof payload.result === "object" ? payload.result : {};
      next = {
        ...action,
        state: "completed",
        result,
        completedBy: connectorSession ? `connector:${connectorSession.connectorId}` : session.email,
        completedAt: timestamp,
        updatedAt: timestamp,
      };
      next.history = ownerActionHistory(action, {
        event: "completed",
        at: timestamp,
        by: connectorSession ? `connector:${connectorSession.connectorId}` : session.email,
      });
    } else if (transition === "fail") {
      if (!["queued", "claimed"].includes(action.state)) {
        return credentialedErrorJson(request, 409, "owner_action_not_open", "Only queued or claimed Owner actions can be failed.");
      }
      if (connectorSession && action.state === "claimed" && action.claim?.connectorId !== connectorSession.connectorId) {
        return json({ ok: false, error: { code: "owner_action_connector_mismatch", message: "This action is claimed by another connector." } }, 409);
      }
      const message = String(payload.message || payload.error?.message || payload.error || "Owner action failed.").trim().slice(0, 500);
      next = {
        ...action,
        state: "failed",
        error: {
          message: message || "Owner action failed.",
        },
        failedBy: connectorSession ? `connector:${connectorSession.connectorId}` : session.email,
        failedAt: timestamp,
        updatedAt: timestamp,
      };
      next.history = ownerActionHistory(action, {
        event: "failed",
        at: timestamp,
        by: connectorSession ? `connector:${connectorSession.connectorId}` : session.email,
        message: next.error.message,
      });
    } else {
      return credentialedErrorJson(request, 400, "invalid_owner_action_transition", "Owner action transition is not supported.");
    }

    const saved = await ownerActionStore.putAction(next);
    return credentialedJson(request, { ok: true, action: saved });
  };

  const transitionConnectorAction = async (request, actionId, transition) => {
    const connector = await requireOwnerConnector(request);
    return await transitionOwnerAction(request, actionId, transition, connector);
  };

  const parseAuditJson = (value) => {
    if (value == null || typeof value !== "string") return value ?? null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const publicAuditEvent = (event = {}) => ({
    id: event.id || "",
    eventType: event.eventType || event.event_type || "",
    action: event.action || "",
    summary: event.summary || "",
    actorEmail: event.actorEmail || event.actor_email || "",
    targetType: event.targetType || event.target_type || "",
    targetId: event.targetId || event.target_id || "",
    targetEmail: event.targetEmail || event.target_email || "",
    before: event.before || parseAuditJson(event.beforeJson || event.before_json),
    after: event.after || parseAuditJson(event.afterJson || event.after_json),
    reversible: event.reversible === true || event.reversible === 1 || event.reversible === "1",
    revertedAt: event.revertedAt || event.reverted_at || null,
    revertedBy: event.revertedBy || event.reverted_by || "",
    revertedEventId: event.revertedEventId || event.reverted_event_id || "",
    createdAt: event.createdAt || event.created_at || "",
  });

  const accessConsoleRegistryRequired = () => {
    if (!accessUserRegistry || typeof accessUserRegistry.listUsers !== "function" || typeof accessUserRegistry.putUser !== "function") {
      throw Object.assign(new Error("Access Console registry is not configured."), {
        status: 503,
        code: "access_console_unavailable",
      });
    }
    return accessUserRegistry;
  };

  const requireAccessConsoleAdmin = async (request) => authSessionFor(request, { requiredRole: "admin" });

  const accessConsoleState = async (request) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    const [people, fixtureEvents, auditEvents, audienceGroups, galleryOptions, capabilities, realEstateCredentials] = await Promise.all([
      registry.listUsers(),
      typeof registry.listFixtureEvents === "function" ? registry.listFixtureEvents() : [],
      typeof registry.listAuditEvents === "function" ? registry.listAuditEvents(30) : [],
      typeof registry.listAudienceGroups === "function" ? registry.listAudienceGroups() : [],
      typeof registry.listGalleryOptions === "function" ? registry.listGalleryOptions() : [],
      typeof registry.listCapabilities === "function" ? registry.listCapabilities() : ACCESS_CAPABILITIES,
      typeof registry.listRealEstateCredentials === "function" ? registry.listRealEstateCredentials() : [],
    ]);
    return credentialedJson(request, {
      ok: true,
      session: authSessionPayload(session),
      roles: ACCESS_CONSOLE_ROLE_OPTIONS,
      capabilities,
      bootstrapAdminEmail: adminEmail,
      people,
      fixtureEvents,
      audienceGroups,
      galleryOptions,
      auditEvents: auditEvents.map(publicAuditEvent),
      realEstateCredentials,
    });
  };

  const putAccessConsolePerson = async (request) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    const payload = await parseJson(request);
    const email = String(payload.email || "").trim().toLowerCase();
    if (!validEmail(email)) {
      return credentialedErrorJson(request, 400, "invalid_access_email", "A valid email address is required.");
    }
    const requestedRoles = payload.roles || payload.role || payload.tier;
    if (accessConsolePayloadRequestsAdmin(requestedRoles)) {
      return credentialedErrorJson(request, 400, "admin_not_grantable", "Admin is a bootstrap identity, not a grantable role.");
    }
    const roles = normalizeAccessConsoleRoles(requestedRoles);
    const user = await registry.putUser({
      email,
      displayName: payload.displayName || payload.name || "",
      tier: tierFromAccessConsoleRoles(roles),
      roles,
      realEstateClients: payload.realEstateClients || payload.realEstateGalleries || [],
      groupIds: payload.groupIds || payload.audienceGroups || [],
      notes: payload.notes || "",
      fixture: payload.fixture === true,
      source: payload.fixture === true ? "fixture" : "manual",
    }, { actorEmail: session.email });
    const passwordLogin = payload.passwordLogin && typeof payload.passwordLogin === "object"
      ? payload.passwordLogin
      : null;
    const credentials = [];
    if (passwordLogin && typeof registry.putRealEstateCredential === "function") {
      const galleryKeys = [...new Set(
        (Array.isArray(passwordLogin.galleryKeys) ? passwordLogin.galleryKeys : user.realEstateClients || [])
          .map((key) => String(key || "").trim())
          .filter(Boolean)
      )];
      const loginName = String(passwordLogin.loginName || payload.displayName || email).trim();
      const password = String(passwordLogin.password || "");
      for (const galleryKey of galleryKeys) {
        try {
          credentials.push(await registry.putRealEstateCredential({
            email,
            galleryKey,
            loginName,
            password,
          }, { actorEmail: session.email }));
        } catch (error) {
          return credentialedErrorJson(
            request,
            400,
            "invalid_real_estate_password_access",
            error.message || "Real Estate password access could not be saved."
          );
        }
      }
    }
    return credentialedJson(request, { ok: true, user, credentials });
  };

  const disableAccessConsolePerson = async (request, email) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    if (typeof registry.disableUser !== "function") {
      return credentialedErrorJson(request, 503, "access_console_disable_unavailable", "Access Console disable is not configured.");
    }
    const user = await registry.disableUser(email, { actorEmail: session.email });
    if (!user) return credentialedErrorJson(request, 404, "access_person_not_found", "Access person was not found.");
    return credentialedJson(request, { ok: true, user });
  };

  const seedAccessConsoleFixtures = async (request) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    if (typeof registry.seedFixtureData !== "function") {
      return credentialedErrorJson(request, 503, "access_console_fixtures_unavailable", "Access Console fixtures are not configured.");
    }
    const fixtures = await registry.seedFixtureData({ actorEmail: session.email });
    return credentialedJson(request, { ok: true, fixtures });
  };

  const putAccessConsoleGroup = async (request) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    if (typeof registry.putAudienceGroup !== "function") {
      return credentialedErrorJson(request, 503, "access_console_groups_unavailable", "Access Console group writes are not configured.");
    }
    const payload = await parseJson(request);
    try {
      const group = await registry.putAudienceGroup({
        id: payload.id || payload.groupId || payload.group_id || "",
        label: payload.label || payload.name || "",
        kind: payload.kind || "event",
        galleryKind: payload.galleryKind || payload.gallery_kind || payload.kind || "event",
        galleryKey: payload.galleryKey || payload.gallery_key || "",
        accessPolicy: payload.accessPolicy || payload.access_policy || "",
        capabilities: normalizeAccessConsoleCapabilities(payload.capabilities || payload.capabilityIds || []),
        galleryDefaults: payload.galleryDefaults || payload.gallery_defaults || {},
        fixture: payload.fixture === true,
      }, { actorEmail: session.email });
      return credentialedJson(request, { ok: true, group });
    } catch (error) {
      return credentialedErrorJson(request, 400, "invalid_access_group", error.message || "Audience group could not be saved.");
    }
  };

  const archiveAccessConsoleGroup = async (request, groupId) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    if (typeof registry.archiveAudienceGroup !== "function") {
      return credentialedErrorJson(request, 503, "access_console_groups_unavailable", "Access Console group archiving is not configured.");
    }
    const group = await registry.archiveAudienceGroup(groupId, { actorEmail: session.email });
    if (!group) return credentialedErrorJson(request, 404, "access_group_not_found", "Access group was not found.");
    return credentialedJson(request, { ok: true, group });
  };

  const undoAccessConsoleAuditEvent = async (request, auditId) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    if (typeof registry.undoAuditEvent !== "function") {
      return credentialedErrorJson(request, 503, "access_console_undo_unavailable", "Access Console undo is not configured.");
    }
    try {
      const result = await registry.undoAuditEvent(auditId, { actorEmail: session.email });
      if (!result) return credentialedErrorJson(request, 404, "access_audit_not_found", "Access audit event was not found.");
      return credentialedJson(request, {
        ok: true,
        event: publicAuditEvent(result.event),
        undoEvent: publicAuditEvent(result.undoEvent),
        restored: result.restored || null,
      });
    } catch (error) {
      return credentialedErrorJson(
        request,
        error.status || 409,
        error.code || "access_audit_undo_failed",
        error.message || "Access change could not be undone."
      );
    }
  };

  const accessConsoleGalleryAccess = async (request) => {
    const session = await requireAccessConsoleAdmin(request);
    const registry = accessConsoleRegistryRequired();
    const url = new URL(request.url);
    const galleryKind = normalizePolicyGalleryKind(url.searchParams.get("galleryKind") || url.searchParams.get("gallery_kind"));
    const galleryKey = normalizePolicyGalleryKey(url.searchParams.get("galleryKey") || url.searchParams.get("gallery_key"));
    const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
    const ownerOriginals = boolParam(url.searchParams.get("ownerOriginals") || url.searchParams.get("owner_originals"));
    if (!galleryKey) {
      return credentialedErrorJson(request, 400, "missing_gallery_key", "A gallery key is required.");
    }
    if (email && !validEmail(email)) {
      return credentialedErrorJson(request, 400, "invalid_access_email", "Policy testing requires a valid email address.");
    }
    const audienceGroups = typeof registry.listAudienceGroups === "function" ? await registry.listAudienceGroups() : [];
    const activeAudienceGroups = audienceGroups.filter((group) => group?.state !== "archived");
    const selectedUser = email && typeof registry.getUser === "function" ? await registry.getUser(email) : null;
    const galleryGroup = activeAudienceGroups.find((group) =>
      group.galleryKind === galleryKind && String(group.galleryKey || "") === galleryKey
    );
    const ownerViewer = {
      email: session.email,
      displayName: "Owner/admin",
      roles: ["user", "owner", "admin"],
      effectiveAccess: {
        scopes: [],
      },
    };
    const visitorViewer = {
      email: "",
      displayName: "Regular visitor",
      roles: ["user"],
      effectiveAccess: { scopes: [] },
    };
    return credentialedJson(request, {
      ok: true,
      gallery: {
        galleryKind,
        galleryKey,
        label: galleryGroup?.label || galleryKey,
        groupId: galleryGroup?.id || "",
      },
      requestedEmail: email,
      selectedUser: selectedUser ? {
        email: selectedUser.email,
        displayName: selectedUser.displayName || "",
        roles: selectedUser.roles || ["user"],
        tier: selectedUser.tier || "user",
        groupIds: selectedUser.groupIds || [],
        disabledAt: selectedUser.disabledAt || null,
        effectiveAccess: selectedUser.effectiveAccess || null,
      } : null,
      decisions: {
        visitor: galleryAccessDecisionFor({
          viewer: visitorViewer,
          mode: "visitor",
          galleryKind,
          galleryKey,
          audienceGroups: activeAudienceGroups,
          ownerOriginals: false,
        }),
        selected: selectedUser ? galleryAccessDecisionFor({
          viewer: selectedUser,
          mode: "selected",
          galleryKind,
          galleryKey,
          audienceGroups: activeAudienceGroups,
          ownerOriginals: false,
        }) : null,
        owner: galleryAccessDecisionFor({
          viewer: ownerViewer,
          mode: "owner",
          galleryKind,
          galleryKey,
          audienceGroups: activeAudienceGroups,
          ownerOriginals,
        }),
      },
      generatedAt: now().toISOString(),
    });
  };

  const canUseRealEstateGallery = (session, galleryKey) =>
    Boolean(
      session?.roles?.includes("admin")
      || session?.roles?.includes("owner")
      || session?.realEstateClients?.some((key) =>
        canonicalRealEstateGalleryKey(key) === canonicalRealEstateGalleryKey(galleryKey)
      )
    );

  const requireRealEstateSession = async (request, payload) => {
    if (!realEstateAuth || typeof realEstateAuth.requireSession !== "function") {
      throw Object.assign(new Error("Real-estate client login is not configured."), {
        status: 503,
        code: "real_estate_auth_unavailable",
      });
    }
    return realEstateAuth.requireSession(request, payload.galleryKey);
  };

  const loginRealEstateWithAccess = async (request) => {
    if (!realEstateAuth || typeof realEstateAuth.loginTrusted !== "function") {
      return credentialedErrorJson(request, 503, "real_estate_auth_unavailable", "Real-estate client login is not configured.");
    }
    const payload = request.method === "GET"
      ? Object.fromEntries(new URL(request.url).searchParams.entries())
      : await parseJson(request);
    const galleryKey = String(payload.galleryKey || "").trim();
    if (!galleryKey) {
      return credentialedErrorJson(request, 400, "missing_gallery_key", "Real-estate gallery key is required.");
    }
    const accessSession = await authSessionFor(request, { required: true });
    if (!canUseRealEstateGallery(accessSession, galleryKey)) {
      return credentialedErrorJson(request, 403, "real_estate_gallery_forbidden", "This Google account is not authorized for this photo pool.");
    }
    const { session, cookie } = await realEstateAuth.loginTrusted({
      galleryKey,
      email: accessSession.email,
      provider: accessSession.provider,
    }, request);
    if (request.method === "GET") {
      return new Response(null, {
        status: 302,
        headers: {
          location: safeAuthReturnUrl(request),
          "set-cookie": cookie,
          "cache-control": "no-store",
        },
      });
    }
    return credentialedJson(request, { session, access: authSessionPayload(accessSession) }, 200, { "set-cookie": cookie });
  };

  const loginRealEstate = async (request) => {
    if (!realEstateAuth || typeof realEstateAuth.login !== "function") {
      return credentialedErrorJson(request, 503, "real_estate_auth_unavailable", "Real-estate client login is not configured.");
    }
    const payload = await parseJson(request);
    const { session, cookie } = await realEstateAuth.login(payload, request);
    return credentialedJson(request, { session }, 200, { "set-cookie": cookie });
  };

  const getRealEstateSession = async (request) => {
    if (!realEstateAuth || typeof realEstateAuth.requireSession !== "function") {
      return credentialedErrorJson(request, 503, "real_estate_auth_unavailable", "Real-estate client login is not configured.");
    }
    const url = new URL(request.url);
    const session = await realEstateAuth.requireSession(request, url.searchParams.get("galleryKey") || "");
    return credentialedJson(request, { session: realEstateAuth.publicSessionFor(session) });
  };

  const logoutRealEstate = async (request) => {
    const headers = realEstateAuth?.clearCookieFor ? { "set-cookie": realEstateAuth.clearCookieFor() } : {};
    return credentialedJson(request, { ok: true }, 200, headers);
  };

  const createRealEstateOriginalsSession = async (request) => {
    if (!realEstateOriginals || typeof realEstateOriginals.createSession !== "function") {
      return errorJson(503, "real_estate_originals_unavailable", "Real-estate originals delivery is not configured.");
    }
    const payload = await parseJson(request);
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    const originals = await realEstateOriginals.createSession(payload);
    return credentialedJson(request, { originals }, 201);
  };

  const listRealEstateDeliverables = async (request) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.listDeliverables !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud products are not configured.");
    }
    const payload = await parseJson(request);
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    const deliverables = await realEstateDeliverables.listDeliverables(payload);
    return credentialedJson(request, deliverables);
  };

  const putRealEstateDeliverable = async (request) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.putDeliverable !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud products are not configured.");
    }
    const payload = await parseJson(request);
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    const deliverable = await realEstateDeliverables.putDeliverable(payload);
    return credentialedJson(request, { deliverable }, 201);
  };

  const submitRealEstateAssemblyJob = async (request) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.submitAssemblyJob !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud assembly is not configured.");
    }
    const payload = await parseJson(request);
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    const result = await realEstateDeliverables.submitAssemblyJob(payload);
    return credentialedJson(request, result, 202);
  };

  const getRealEstateAssemblyJob = async (request, jobId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.getAssemblyJob !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud assembly is not configured.");
    }
    const url = new URL(request.url);
    const payload = {
      galleryKey: url.searchParams.get("galleryKey") || "",
      jobId,
    };
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    payload.galleryKey = payload.realEstateSession.galleryKey;
    const result = await realEstateDeliverables.getAssemblyJob(payload);
    return credentialedJson(request, result);
  };

  const completeRealEstateAssemblyOutput = async (request, deliverableId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.completeAssemblyOutput !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud output upload is not configured.");
    }
    const url = new URL(request.url);
    const payload = {
      galleryKey: url.searchParams.get("galleryKey") || "",
      id: deliverableId,
      filename: url.searchParams.get("filename") || "",
      contentType: request.headers.get("content-type") || "application/octet-stream",
      contentLength: request.headers.get("content-length") || "",
      body: request.body,
    };
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    payload.galleryKey = payload.realEstateSession.galleryKey;
    const deliverable = await realEstateDeliverables.completeAssemblyOutput(payload);
    return credentialedJson(request, { deliverable });
  };

  const failRealEstateAssemblyOutput = async (request, deliverableId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.failAssemblyOutput !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud output status is not configured.");
    }
    const payload = await parseJson(request);
    payload.id = deliverableId;
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    payload.galleryKey = payload.realEstateSession.galleryKey;
    const deliverable = await realEstateDeliverables.failAssemblyOutput(payload);
    return credentialedJson(request, { deliverable });
  };

  const getRealEstateDeliverableAsset = async (request, id, action) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.getDeliverableAsset !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud products are not configured.");
    }
    const url = new URL(request.url);
    const payload = {
      galleryKey: url.searchParams.get("galleryKey") || "",
      id,
      action,
    };
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    payload.galleryKey = payload.realEstateSession.galleryKey;
    const asset = await realEstateDeliverables.getDeliverableAsset(payload);
    return new Response(action === "head" ? null : asset.object.body, {
      headers: credentialedCorsHeaders(request, asset.headers),
    });
  };

  const deleteRealEstateDeliverable = async (request) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.deleteDeliverable !== "function") {
      return errorJson(503, "real_estate_deliverables_unavailable", "Real-estate cloud products are not configured.");
    }
    const payload = await parseJson(request);
    payload.realEstateSession = await requireRealEstateSession(request, payload);
    const result = await realEstateDeliverables.deleteDeliverable(payload);
    return credentialedJson(request, result);
  };

  const getInternalRealEstateRenderJob = async (request, jobId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.getCloudAssemblyRenderJob !== "function") {
      return errorJson(503, "real_estate_cloud_render_unavailable", "Real-estate cloud rendering is not configured.");
    }
    const url = new URL(request.url);
    const result = await realEstateDeliverables.getCloudAssemblyRenderJob({
      galleryKey: url.searchParams.get("galleryKey") || "",
      jobId,
      renderToken: url.searchParams.get("token") || "",
    });
    return credentialedJson(request, result);
  };

  const updateInternalRealEstateRenderProgress = async (request, jobId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.updateCloudAssemblyRenderProgress !== "function") {
      return errorJson(503, "real_estate_cloud_render_unavailable", "Real-estate cloud rendering is not configured.");
    }
    const url = new URL(request.url);
    const body = await parseJson(request);
    const result = await realEstateDeliverables.updateCloudAssemblyRenderProgress({
      galleryKey: url.searchParams.get("galleryKey") || "",
      jobId,
      renderToken: url.searchParams.get("token") || "",
      phase: body.phase,
      percent: body.percent,
      current: body.current,
      total: body.total,
      detail: body.detail,
    });
    return credentialedJson(request, result);
  };

  const completeInternalRealEstateRenderOutput = async (request, jobId, deliverableId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.completeCloudAssemblyRenderOutput !== "function") {
      return errorJson(503, "real_estate_cloud_render_unavailable", "Real-estate cloud rendering is not configured.");
    }
    const url = new URL(request.url);
    const deliverable = await realEstateDeliverables.completeCloudAssemblyRenderOutput({
      galleryKey: url.searchParams.get("galleryKey") || "",
      jobId,
      id: deliverableId,
      renderToken: url.searchParams.get("token") || "",
      filename: url.searchParams.get("filename") || "",
      contentType: request.headers.get("content-type") || "application/octet-stream",
      contentLength: request.headers.get("content-length") || "",
      body: request.body,
    });
    return credentialedJson(request, { deliverable });
  };

  const failInternalRealEstateRenderOutput = async (request, jobId, deliverableId) => {
    if (!realEstateDeliverables || typeof realEstateDeliverables.failCloudAssemblyRenderOutput !== "function") {
      return errorJson(503, "real_estate_cloud_render_unavailable", "Real-estate cloud rendering is not configured.");
    }
    const url = new URL(request.url);
    const body = await parseJson(request);
    const deliverable = await realEstateDeliverables.failCloudAssemblyRenderOutput({
      galleryKey: url.searchParams.get("galleryKey") || "",
      jobId,
      id: deliverableId,
      renderToken: url.searchParams.get("token") || "",
      failureReason: body.failureReason || body.error || "Cloud browser render failed.",
    });
    return credentialedJson(request, { deliverable });
  };

  const fetch = async (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, "");
    const usesCredentialedCors = path.startsWith("/real-estate/")
      || path.startsWith("/auth/")
      || path.startsWith("/owner/")
      || path.startsWith("/account/")
      || path.startsWith("/access-console/")
      || path === "/checkout/account";
    if (request.method === "OPTIONS") {
      return usesCredentialedCors
        ? credentialedJson(request, { ok: true })
        : json({ ok: true });
    }

    try {
      if (request.method === "GET" && path === "/health") {
        return json({ ok: true, service: "photosbyelie-worker", stripe: stripeProvider, currency: ORDER_CURRENCY });
      }
      if (request.method === "GET" && path === "/auth/session") return await getAuthSession(request);
      if (request.method === "GET" && path === "/auth/login") return await loginAuth(request);
      if (request.method === "GET" && path === "/auth/google/login") return await loginGoogleAuth(request);
      if (request.method === "GET" && path === "/auth/google/callback") return await callbackGoogleAuth(request);
      if ((request.method === "GET" || request.method === "POST") && path === "/auth/logout") return await logoutAuth(request);
      if (request.method === "GET" && path === "/owner/session") return await getOwnerSession(request);
      if (request.method === "GET" && path === "/owner/connectors") return await listOwnerConnectors(request);
      if (request.method === "GET" && path === "/owner/connector/download/mac") return await downloadOwnerConnector(request);
      if (request.method === "POST" && path === "/owner/sidecar/decisions/query") return await querySidecarDecisions(request);
      if (request.method === "POST" && path === "/owner/sidecar/decisions/apply") return await applySidecarDecision(request);
      if (request.method === "POST" && path === "/owner/sidecar/decisions/apply-batch") return await applySidecarDecisions(request);
      if (request.method === "POST" && path === "/owner/sidecar/decisions/upsert") return await upsertSidecarDecisions(request);
      if (request.method === "GET" && path === "/owner/actions") return await listOwnerActions(request);
      if (request.method === "POST" && path === "/owner/actions") return await createOwnerAction(request);
      const ownerActionTransitionMatch = path.match(/^\/owner\/actions\/([^/]+)\/(claim|complete|fail)$/);
      if ((request.method === "POST" || request.method === "PATCH") && ownerActionTransitionMatch) {
        return await transitionOwnerAction(
          request,
          decodeURIComponent(ownerActionTransitionMatch[1]),
          ownerActionTransitionMatch[2]
        );
      }
      const ownerActionMatch = path.match(/^\/owner\/actions\/([^/]+)$/);
      if (request.method === "GET" && ownerActionMatch) return await getOwnerAction(request, decodeURIComponent(ownerActionMatch[1]));
      if (request.method === "POST" && path === "/owner/connector/heartbeat") return await heartbeatOwnerConnector(request);
      if (request.method === "GET" && path === "/owner/connector/actions") return await listConnectorActions(request);
      const connectorActionTransitionMatch = path.match(/^\/owner\/connector\/actions\/([^/]+)\/(claim|complete|fail)$/);
      if (request.method === "POST" && connectorActionTransitionMatch) {
        return await transitionConnectorAction(
          request,
          decodeURIComponent(connectorActionTransitionMatch[1]),
          connectorActionTransitionMatch[2]
        );
      }
      if (request.method === "GET" && path === "/access-console/state") return await accessConsoleState(request);
      if (request.method === "GET" && path === "/access-console/gallery-access") return await accessConsoleGalleryAccess(request);
      if ((request.method === "POST" || request.method === "PUT" || request.method === "PATCH") && path === "/access-console/people") return await putAccessConsolePerson(request);
      if ((request.method === "POST" || request.method === "PUT" || request.method === "PATCH") && path === "/access-console/groups") return await putAccessConsoleGroup(request);
      const accessPersonDisableMatch = path.match(/^\/access-console\/people\/([^/]+)\/disable$/);
      if (request.method === "POST" && accessPersonDisableMatch) return await disableAccessConsolePerson(request, decodeURIComponent(accessPersonDisableMatch[1]));
      const accessGroupArchiveMatch = path.match(/^\/access-console\/groups\/([^/]+)\/archive$/);
      if (request.method === "POST" && accessGroupArchiveMatch) return await archiveAccessConsoleGroup(request, decodeURIComponent(accessGroupArchiveMatch[1]));
      const accessAuditUndoMatch = path.match(/^\/access-console\/audit\/([^/]+)\/undo$/);
      if (request.method === "POST" && accessAuditUndoMatch) return await undoAccessConsoleAuditEvent(request, decodeURIComponent(accessAuditUndoMatch[1]));
      if (request.method === "POST" && path === "/access-console/fixtures/seed") return await seedAccessConsoleFixtures(request);
      if (request.method === "GET" && path === "/account/profile") return await getAccountProfile(request);
      if ((request.method === "POST" || request.method === "PUT" || request.method === "PATCH") && path === "/account/profile") return await putAccountProfile(request);
      const accountOrderMatch = path.match(/^\/account\/orders\/([^/]+)$/);
      if (request.method === "GET" && accountOrderMatch) return await getAccountOrder(request, decodeURIComponent(accountOrderMatch[1]));
      if (request.method === "POST" && path === "/analytics/events") return await recordAnalyticsEvents(request);
      if (request.method === "POST" && path === "/checkout/guest") return await createCheckout(request, "guest");
      if (request.method === "POST" && path === "/checkout/account") {
        const session = await authSessionFor(request, { required: true });
        return await createCheckout(request, "account", session);
      }
      if (request.method === "POST" && path === "/purchases/recent") return await checkRecentPurchases(request);
      if (request.method === "POST" && path === "/stripe-webhook") return await stripeWebhook(request);
      if (request.method === "POST" && path === "/mock-stripe/pay") return await mockPay(request);
      if ((request.method === "GET" || request.method === "POST") && path === "/real-estate/access-login") return await loginRealEstateWithAccess(request);
      if (request.method === "POST" && path === "/real-estate/login") return await loginRealEstate(request);
      if (request.method === "GET" && path === "/real-estate/session") return await getRealEstateSession(request);
      if (request.method === "POST" && path === "/real-estate/logout") return await logoutRealEstate(request);
      if (request.method === "POST" && path === "/real-estate/originals/session") return await createRealEstateOriginalsSession(request);
      const internalRealEstateRenderJobMatch = path.match(/^\/real-estate\/internal\/render-jobs\/([^/]+)$/);
      if (request.method === "GET" && internalRealEstateRenderJobMatch) {
        return await getInternalRealEstateRenderJob(request, decodeURIComponent(internalRealEstateRenderJobMatch[1]));
      }
      const internalRealEstateRenderProgressMatch = path.match(/^\/real-estate\/internal\/render-jobs\/([^/]+)\/progress$/);
      if (request.method === "POST" && internalRealEstateRenderProgressMatch) {
        return await updateInternalRealEstateRenderProgress(request, decodeURIComponent(internalRealEstateRenderProgressMatch[1]));
      }
      const internalRealEstateRenderOutputMatch = path.match(/^\/real-estate\/internal\/render-jobs\/([^/]+)\/deliverables\/([^/]+)\/(complete|fail)$/);
      if (request.method === "POST" && internalRealEstateRenderOutputMatch) {
        const jobId = decodeURIComponent(internalRealEstateRenderOutputMatch[1]);
        const deliverableId = decodeURIComponent(internalRealEstateRenderOutputMatch[2]);
        return internalRealEstateRenderOutputMatch[3] === "complete"
          ? await completeInternalRealEstateRenderOutput(request, jobId, deliverableId)
          : await failInternalRealEstateRenderOutput(request, jobId, deliverableId);
      }
      if (request.method === "POST" && path === "/real-estate/deliverables/list") return await listRealEstateDeliverables(request);
      if (request.method === "POST" && path === "/real-estate/deliverables/jobs") return await submitRealEstateAssemblyJob(request);
      const realEstateJobMatch = path.match(/^\/real-estate\/deliverables\/jobs\/([^/]+)$/);
      if (request.method === "GET" && realEstateJobMatch) {
        return await getRealEstateAssemblyJob(request, decodeURIComponent(realEstateJobMatch[1]));
      }
      if (request.method === "POST" && path === "/real-estate/deliverables") return await putRealEstateDeliverable(request);
      if (request.method === "POST" && path === "/real-estate/deliverables/delete") return await deleteRealEstateDeliverable(request);
      const realEstateCompletionMatch = path.match(/^\/real-estate\/deliverables\/([^/]+)\/(complete|fail)$/);
      if (request.method === "POST" && realEstateCompletionMatch) {
        const id = decodeURIComponent(realEstateCompletionMatch[1]);
        return realEstateCompletionMatch[2] === "complete"
          ? await completeRealEstateAssemblyOutput(request, id)
          : await failRealEstateAssemblyOutput(request, id);
      }
      const realEstateAssetMatch = path.match(/^\/real-estate\/deliverables\/([^/]+)\/(view|download)$/);
      if ((request.method === "GET" || request.method === "HEAD") && realEstateAssetMatch) {
        return await getRealEstateDeliverableAsset(
          request,
          decodeURIComponent(realEstateAssetMatch[1]),
          request.method === "HEAD" ? "head" : realEstateAssetMatch[2]
        );
      }
      const orderSessionMatch = path.match(/^\/orders\/by-session\/([^/]+)$/);
      if (request.method === "GET" && orderSessionMatch) return await getOrderByCheckoutSession(request, decodeURIComponent(orderSessionMatch[1]));
      const resendEmailMatch = path.match(/^\/orders\/([^/]+)\/resend-email$/);
      if (request.method === "POST" && resendEmailMatch) return await resendReadyEmail(request, decodeURIComponent(resendEmailMatch[1]));
      const orderMatch = path.match(/^\/orders\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) return await getOrder(request, decodeURIComponent(orderMatch[1]));
      const downloadMatch = path.match(/^\/download\/([^/]+)$/);
      if (request.method === "GET" && downloadMatch) return await download(request, decodeURIComponent(downloadMatch[1]));
    } catch (error) {
      return usesCredentialedCors
        ? credentialedErrorJson(request, error.status || 500, error.code || "worker_error", error.message, error.details)
        : errorJson(error.status || 500, error.code || "worker_error", error.message, error.details);
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
