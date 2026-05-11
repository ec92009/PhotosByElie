(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const promotionsKey = "photosbyelie-reserve-promotions";
  let loadPromise = null;

  const currentVersionQuery = () => {
    const script = [...document.scripts].find((item) => item.src.includes("reserve-store.js"));
    const params = new URLSearchParams(script?.src.includes("?") ? script.src.split("?").pop() : "");
    if (enabled) params.set("localReserve", String(Date.now()));
    const query = params.toString();
    return query ? `?${query}` : "";
  };

  const normalizeState = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).map(([galleryKey, ids]) => [
        galleryKey,
        [...new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [])],
      ])
    );
  };

  const readPromotions = () => {
    if (!enabled) return {};
    try {
      return normalizeState(JSON.parse(localStorage.getItem(promotionsKey) || "{}"));
    } catch {
      return {};
    }
  };

  const writePromotions = (state) => {
    const normalized = normalizeState(state);
    if (enabled) localStorage.setItem(promotionsKey, JSON.stringify(normalized));
    return normalized;
  };

  const promotedIds = (galleryKey) => readPromotions()[galleryKey] || [];

  const addPromotion = (galleryKey, photoId) => {
    if (!enabled || !galleryKey || !photoId) return promotedIds(galleryKey);
    const state = readPromotions();
    state[galleryKey] = [...new Set([...(state[galleryKey] || []), photoId])];
    return writePromotions(state)[galleryKey] || [];
  };

  const load = () => {
    if (!enabled) return Promise.resolve({});
    if (window.photosByElieReserveData) return Promise.resolve(window.photosByElieReserveData);
    if (loadPromise) return loadPromise;
    loadPromise = fetch(`./assets/reserve/reserve-data.json${currentVersionQuery()}`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((payload) => {
        window.photosByElieReserveData = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
        window.photosByElieApplyCollectionOrigins?.(window.photosByElieReserveData);
        return window.photosByElieReserveData;
      })
      .catch(() => ({}));
    return loadPromise;
  };

  const photosFor = (galleryKey) => window.photosByElieReserveData?.[galleryKey]?.photos || [];

  const findPhoto = (photoId) => {
    const collections = window.photosByElieReserveData || {};
    for (const [galleryKey, collection] of Object.entries(collections)) {
      const photo = (collection.photos || []).find((item) => item.id === photoId);
      if (photo) return { galleryKey, collection, photo };
    }
    return null;
  };

  window.photosByElieReserve = {
    addPromotion,
    enabled,
    findPhoto,
    load,
    photosFor,
    promotedIds,
    readPromotions,
  };
})();
