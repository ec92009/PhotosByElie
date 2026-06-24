const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const jsonGet = async (namespace, key) => {
  const value = await namespace.get(key, { type: "json" });
  return clone(value);
};

const putOptions = (ttlSeconds) => {
  const expirationTtl = Number(ttlSeconds || 0);
  return Number.isFinite(expirationTtl) && expirationTtl >= 60
    ? { expirationTtl: Math.floor(expirationTtl) }
    : undefined;
};

const jsonPut = async (namespace, key, value, options = undefined) => {
  await namespace.put(key, JSON.stringify(value), options);
  return clone(value);
};

export const createKvStore = ({
  namespace,
  prefix = "pbe",
  checkoutSessionTtlSeconds = 60 * 60 * 24 * 90,
  downloadTtlSeconds = 60 * 60 * 24 * 31,
} = {}) => {
  if (!namespace) throw new Error("createKvStore requires a KV namespace binding.");

  const key = (type, id) => `${prefix}:${type}:${id}`;

  const putOrder = async (order) => {
    await jsonPut(namespace, key("orders", order.id), order);
    if (order.checkoutSessionId) await namespace.put(key("checkout", order.checkoutSessionId), order.id, putOptions(checkoutSessionTtlSeconds));
    return clone(order);
  };

  const getOrder = async (orderId) => jsonGet(namespace, key("orders", orderId));

  const listOrders = async () => {
    if (typeof namespace.list !== "function") return [];
    const orders = [];
    let cursor = undefined;
    do {
      const page = await namespace.list({
        prefix: key("orders", ""),
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      const entries = page?.keys || page?.objects || [];
      await Promise.all(entries.map(async (entry) => {
        const name = entry?.name || entry?.key;
        if (!name) return;
        const value = await jsonGet(namespace, name);
        if (value) orders.push(value);
      }));
      cursor = page?.cursor || (page?.truncated ? page?.cursor : undefined);
      if (page?.list_complete === true) cursor = undefined;
      if (page?.truncated === false) cursor = undefined;
    } while (cursor);
    return orders.map(clone);
  };

  const getOrderByCheckoutSessionId = async (checkoutSessionId) => {
    const orderId = await namespace.get(key("checkout", checkoutSessionId));
    return orderId ? getOrder(orderId) : null;
  };

  const updateOrder = async (orderId, updater) => {
    const existing = await getOrder(orderId);
    if (!existing) return null;
    const next = await updater(clone(existing));
    return putOrder(next);
  };

  const putDownload = async (download) => jsonPut(namespace, key("downloads", download.token), download, putOptions(downloadTtlSeconds));
  const getDownload = async (token) => jsonGet(namespace, key("downloads", token));

  const recordDownload = async (token, downloadedAt) => {
    const existing = await getDownload(token);
    if (!existing) return null;
    const next = {
      ...existing,
      lastDownloadAt: downloadedAt,
      downloadCount: Number(existing.downloadCount || 0) + 1,
    };
    return putDownload(next);
  };

  const accountEmail = (email) => String(email || "").trim().toLowerCase();

  const getAccountProfile = async (email) => {
    const normalized = accountEmail(email);
    return normalized ? jsonGet(namespace, key("account-profiles", normalized)) : null;
  };

  const putAccountProfile = async (profile) => {
    const normalized = accountEmail(profile?.email);
    if (!normalized) return null;
    return jsonPut(namespace, key("account-profiles", normalized), { ...profile, email: normalized });
  };

  return {
    putOrder,
    getOrder,
    listOrders,
    getOrderByCheckoutSessionId,
    updateOrder,
    putDownload,
    getDownload,
    recordDownload,
    getAccountProfile,
    putAccountProfile,
  };
};
