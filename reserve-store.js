(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const promotionsKey = "photosbyelie-reserve-promotions";
  let loadPromise = null;

  const currentVersionQuery = () => {
    const script = [...document.scripts].find((item) => item.src.includes("reserve-store.js"));
    return script?.src.includes("?") ? `?${script.src.split("?").pop()}` : "";
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
    loadPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = `./assets/reserve/reserve-data.js${currentVersionQuery()}`;
      script.onload = () => resolve(window.photosByElieReserveData || {});
      script.onerror = () => resolve({});
      document.head.append(script);
    });
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
