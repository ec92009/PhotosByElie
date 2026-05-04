(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  let loadPromise = null;

  const currentVersionQuery = () => {
    const script = [...document.scripts].find((item) => item.src.includes("hidden-store.js"));
    const params = new URLSearchParams(script?.src.includes("?") ? script.src.split("?").pop() : "");
    if (enabled) params.set("localHidden", String(Date.now()));
    const query = params.toString();
    return query ? `?${query}` : "";
  };

  const load = () => {
    if (!enabled) return Promise.resolve({});
    if (window.photosByElieHiddenData) return Promise.resolve(window.photosByElieHiddenData);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = `./assets/hidden/hidden-data.js${currentVersionQuery()}`;
      script.onload = () => resolve(window.photosByElieHiddenData || {});
      script.onerror = () => resolve({});
      document.head.append(script);
    });
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
