(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const ownerAuth = window.photosByElieOwnerAuth;
  let loadPromise = null;

  const ownerAllowed = async () => {
    if (enabled) return true;
    const state = ownerAuth?.state?.checked ? ownerAuth.state : await ownerAuth?.refresh?.();
    return Boolean(state?.authenticated && (state?.tier === "owner" || state?.roles?.includes?.("owner")));
  };

  const currentVersionQuery = () => {
    const script = [...document.scripts].find((item) => item.src.includes("hidden-store.js"));
    const params = new URLSearchParams(script?.src.includes("?") ? script.src.split("?").pop() : "");
    if (enabled) params.set("localHidden", String(Date.now()));
    const query = params.toString();
    return query ? `?${query}` : "";
  };

  const load = async () => {
    if (!await ownerAllowed()) return {};
    if (window.photosByElieHiddenData) return Promise.resolve(window.photosByElieHiddenData);
    if (loadPromise) return loadPromise;
    loadPromise = fetch(`./assets/hidden/hidden-data.json${currentVersionQuery()}`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((payload) => {
        window.photosByElieHiddenData = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
        window.photosByElieApplyCollectionOrigins?.(window.photosByElieHiddenData);
        return window.photosByElieHiddenData;
      })
      .catch(() => ({}));
    return loadPromise;
  };

  const photosFor = (galleryKey) => window.photosByElieHiddenData?.[galleryKey]?.photos || [];

  const findPhoto = (photoId) => {
    const collections = window.photosByElieHiddenData || {};
    for (const [galleryKey, collection] of Object.entries(collections)) {
      const photo = (collection.photos || []).find((item) => item.id === photoId);
      if (photo) return { galleryKey, collection, photo };
    }
    return null;
  };

  window.photosByElieHidden = {
    enabled,
    findPhoto,
    load,
    photosFor,
  };
})();
