const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const ALLOWED_EVENTS = new Set([
  "page_view",
  "gallery_open_click",
  "gallery_view",
  "photo_open_click",
  "photo_view",
  "basket_view",
  "basket_change",
  "liked_change",
  "checkout_click",
  "checkout_session_created",
  "payment_completed",
  "order_view",
  "download_click",
  "download_success",
]);

const STRING_FIELDS = new Set([
  "sessionId",
  "version",
  "hostname",
  "path",
  "pageType",
  "collectionKey",
  "photoId",
  "productId",
  "checkoutMode",
  "provider",
  "source",
  "status",
  "downloadType",
]);

const NUMBER_FIELDS = new Set([
  "itemCount",
  "productCount",
  "basketItemCount",
  "basketProductCount",
  "amountCents",
  "subtotalCents",
]);

const BOOLEAN_FIELDS = new Set([
  "discountPresent",
]);

const MAX_BATCH_EVENTS = 20;
const MAX_STRING_LENGTH = 160;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 400;

const cleanString = (value, maxLength = MAX_STRING_LENGTH) => String(value || "")
  .replace(/[^\w .:/?=&%#@+-]/g, "")
  .slice(0, maxLength)
  .trim();

const cleanPath = (value) => {
  const path = cleanString(value, 220).split("#")[0].split("?")[0];
  return path.startsWith("/") ? path : `/${path.replace(/^\/+/, "")}`;
};

const cleanEventName = (value) => cleanString(value, 80).toLowerCase().replace(/[^a-z0-9_:-]/g, "_");

const cleanNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

const analyticsDate = (iso) => String(iso || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

const randomId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

export const sanitizeAnalyticsEvent = (event = {}, { receivedAt = new Date().toISOString(), source = "" } = {}) => {
  const name = cleanEventName(event.event || event.name || event.type);
  if (!ALLOWED_EVENTS.has(name)) return null;

  const row = {
    event: name,
    receivedAt,
  };
  if (source) row.source = source;

  for (const [key, value] of Object.entries(event)) {
    if (key === "event" || key === "name" || key === "type") continue;
    if (key === "email" || key === "buyerEmail" || key === "orderId" || key === "userAgent" || key === "ip") continue;
    if (key === "path") {
      row.path = cleanPath(value);
    } else if (STRING_FIELDS.has(key)) {
      const clean = cleanString(value);
      if (clean) row[key] = clean;
    } else if (NUMBER_FIELDS.has(key)) {
      row[key] = cleanNumber(value);
    } else if (BOOLEAN_FIELDS.has(key)) {
      row[key] = Boolean(value);
    }
  }
  return row;
};

const putOptions = (ttlSeconds) => {
  const expirationTtl = Number(ttlSeconds || 0);
  return Number.isFinite(expirationTtl) && expirationTtl >= 60
    ? { expirationTtl: Math.floor(expirationTtl) }
    : undefined;
};

const jsonGet = async (namespace, key) => {
  const value = await namespace.get(key, { type: "json" });
  return clone(value);
};

const jsonPut = async (namespace, key, value, options = undefined) => {
  await namespace.put(key, JSON.stringify(value), options);
  return clone(value);
};

export const createAnalyticsStore = ({
  namespace,
  prefix = "pbe",
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = () => new Date(),
  persistEvents = true,
} = {}) => {
  if (!namespace) return null;
  const key = (...parts) => [prefix, "analytics", ...parts].join(":");
  const options = putOptions(ttlSeconds);

  const putEvents = async (events = []) => {
    const batch = (Array.isArray(events) ? events : [events]).slice(0, MAX_BATCH_EVENTS);
    const results = batch
      .map((event) => sanitizeAnalyticsEvent(event, { receivedAt: now().toISOString() }))
      .filter(Boolean);

    if (persistEvents) {
      await Promise.all(results.map(async (sanitized) => {
        const day = analyticsDate(sanitized.receivedAt);
        const id = `${sanitized.receivedAt.replace(/[-:.TZ]/g, "")}-${randomId().replace(/-/g, "").slice(0, 12)}`;
        await jsonPut(namespace, key("events", day, id), sanitized, options);
      }));
    }

    const groupedCounts = new Map();
    for (const sanitized of results) {
      const day = analyticsDate(sanitized.receivedAt);
      const groupKey = `${day}:${sanitized.event}`;
      const existing = groupedCounts.get(groupKey) || {
        day,
        event: sanitized.event,
        count: 0,
        lastAt: sanitized.receivedAt,
      };
      existing.count += 1;
      if (sanitized.receivedAt > existing.lastAt) existing.lastAt = sanitized.receivedAt;
      groupedCounts.set(groupKey, existing);
    }

    for (const group of groupedCounts.values()) {
      const countKey = key("counts", group.day, group.event);
      const existing = await jsonGet(namespace, countKey);
      await jsonPut(namespace, countKey, {
        ...existing,
        day: existing?.day || group.day,
        event: existing?.event || group.event,
        count: Number(existing?.count || 0) + group.count,
        lastAt: existing?.lastAt > group.lastAt ? existing.lastAt : group.lastAt,
      }, options);
    }
    return results;
  };

  const putEvent = async (event) => {
    const [saved] = await putEvents([event]);
    return saved || null;
  };

  return {
    putEvent,
    putEvents,
  };
};
