export const createMemoryStore = () => {
  const orders = new Map();
  const checkoutSessionIndex = new Map();
  const downloads = new Map();
  const accountProfiles = new Map();

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  const putOrder = async (order) => {
    orders.set(order.id, clone(order));
    if (order.checkoutSessionId) checkoutSessionIndex.set(order.checkoutSessionId, order.id);
    return clone(order);
  };

  const getOrder = async (orderId) => clone(orders.get(orderId));

  const listOrders = async () => [...orders.values()].map(clone);

  const getOrderByCheckoutSessionId = async (checkoutSessionId) => {
    const orderId = checkoutSessionIndex.get(checkoutSessionId);
    return orderId ? getOrder(orderId) : null;
  };

  const updateOrder = async (orderId, updater) => {
    const existing = orders.get(orderId);
    if (!existing) return null;
    const next = await updater(clone(existing));
    orders.set(orderId, clone(next));
    if (next.checkoutSessionId) checkoutSessionIndex.set(next.checkoutSessionId, next.id);
    return clone(next);
  };

  const putDownload = async (download) => {
    downloads.set(download.token, clone(download));
    return clone(download);
  };

  const getDownload = async (token) => clone(downloads.get(token));

  const recordDownload = async (token, downloadedAt) => {
    const existing = downloads.get(token);
    if (!existing) return null;
    const next = {
      ...existing,
      lastDownloadAt: downloadedAt,
      downloadCount: Number(existing.downloadCount || 0) + 1,
    };
    downloads.set(token, clone(next));
    return clone(next);
  };

  const getAccountProfile = async (email) => clone(accountProfiles.get(String(email || "").trim().toLowerCase()));

  const putAccountProfile = async (profile) => {
    const email = String(profile?.email || "").trim().toLowerCase();
    if (!email) return null;
    accountProfiles.set(email, clone({ ...profile, email }));
    return clone(accountProfiles.get(email));
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
    _debug: {
      orders,
      downloads,
      accountProfiles,
    },
  };
};
