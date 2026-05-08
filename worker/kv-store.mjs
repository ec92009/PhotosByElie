const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const jsonGet = async (namespace, key) => {
  const value = await namespace.get(key, { type: "json" });
  return clone(value);
};

const jsonPut = async (namespace, key, value) => {
  await namespace.put(key, JSON.stringify(value));
  return clone(value);
};

export const createKvStore = ({ namespace, prefix = "pbe" } = {}) => {
  if (!namespace) throw new Error("createKvStore requires a KV namespace binding.");

  const key = (type, id) => `${prefix}:${type}:${id}`;

  const putOrder = async (order) => {
    await jsonPut(namespace, key("orders", order.id), order);
    if (order.checkoutSessionId) await namespace.put(key("checkout", order.checkoutSessionId), order.id);
    return clone(order);
  };

  const getOrder = async (orderId) => jsonGet(namespace, key("orders", orderId));

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

  const putDownload = async (download) => jsonPut(namespace, key("downloads", download.token), download);
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

  return {
    putOrder,
    getOrder,
    getOrderByCheckoutSessionId,
    updateOrder,
    putDownload,
    getDownload,
    recordDownload,
  };
};
