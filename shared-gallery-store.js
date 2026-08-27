(() => {
  const sharedGalleryKey = "shared";
  const detailSequenceKey = "photosbyelie-detail-sequence";
  const params = new URLSearchParams(window.location.search);
  const requestedGallery = String(params.get("gallery") || "").trim().toLowerCase();
  let sequenceRequestsShared = false;
  try {
    const sequence = JSON.parse(sessionStorage.getItem(detailSequenceKey) || "null");
    sequenceRequestsShared = sequence?.collectionKey === sharedGalleryKey
      && Array.isArray(sequence?.photoIds)
      && sequence.photoIds.includes(params.get("id"));
  } catch {}

  const state = {
    status: "idle",
    authenticated: false,
    displayName: "",
    fixtureCount: 0,
    uniquePhotoCount: 0,
    missingPhotoCount: 0,
    message: "",
    loginUrl: "",
  };
  window.photosByElieSharedGalleryState = state;

  const installCollection = (photos = []) => {
    window.photosByElieData = window.photosByElieData || {};
    window.photosByElieData[sharedGalleryKey] = {
      number: "",
      title: "Shared with me",
      description: "Photos shared privately with this account.",
      accent: "shared-gallery",
      photos,
    };
  };

  const catalogPhotosById = () => {
    const byId = new Map();
    Object.entries(window.photosByElieData || {}).forEach(([key, collection]) => {
      if (key === sharedGalleryKey) return;
      (collection?.photos || []).forEach((photo) => {
        if (photo?.id && !byId.has(photo.id)) byId.set(photo.id, photo);
      });
    });
    return byId;
  };

  const workerBase = () => String(
    window.photosByElieMediaConfig?.authWorkerBaseUrl
    || window.photosByElieMediaConfig?.checkoutWorkerBaseUrl
    || ""
  ).replace(/\/+$/, "");

  const loginHref = () => {
    const base = workerBase();
    if (!base) return "";
    const url = new URL(`${base}/auth/google/login`);
    url.searchParams.set("returnTo", window.location.href);
    url.searchParams.set("prompt", "select_account");
    return url.href;
  };

  window.photosByElieSharedGalleryReady = (async () => {
    await window.photosByElieCatalogReady;
    installCollection();
    if (requestedGallery !== sharedGalleryKey && !sequenceRequestsShared) return state;
    const base = workerBase();
    if (!base) {
      state.status = "unavailable";
      state.message = "Shared photos are temporarily unavailable.";
      return state;
    }
    state.status = "loading";
    try {
      const response = await fetch(`${base}/shared-galleries`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        state.status = "signed-out";
        state.loginUrl = loginHref();
        state.message = "Sign in to see photos shared privately with you.";
        return state;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Shared photos could not be loaded.");
      const catalog = catalogPhotosById();
      const authorizedIds = new Set();
      (payload.fixtures || []).forEach((fixture) => {
        (fixture.photos || []).forEach((photo) => {
          if (photo?.id) authorizedIds.add(photo.id);
        });
      });
      const photos = [...authorizedIds].map((id) => catalog.get(id)).filter(Boolean);
      state.status = "ready";
      state.authenticated = true;
      state.displayName = String(payload.user?.displayName || payload.user?.email || "");
      state.fixtureCount = Number(payload.fixtureCount || payload.fixtures?.length || 0);
      state.uniquePhotoCount = Number(payload.uniquePhotoCount || authorizedIds.size);
      state.missingPhotoCount = Math.max(0, authorizedIds.size - photos.length);
      state.message = photos.length
        ? `${photos.length} photo${photos.length === 1 ? "" : "s"} shared with you.`
        : "Nothing has been shared with this account yet.";
      installCollection(photos);
      return state;
    } catch (error) {
      state.status = "error";
      state.message = error?.message || "Shared photos could not be loaded.";
      return state;
    }
  })();

  window.photosByEliePageReady = async () => {
    await window.photosByElieCatalogReady;
    await window.photosByElieSharedGalleryReady;
    return { mode: "public", galleryKey: "", gallery: null };
  };
})();
