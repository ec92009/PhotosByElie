(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const key = "photosbyelie-unworthy";
  const historyKey = "photosbyelie-unworthy-history";
  const reservePromotionsKey = "photosbyelie-reserve-promotions";

  const normalize = (items) => {
    if (!Array.isArray(items)) return [];
    return [...new Set(items.filter((item) => typeof item === "string" && item))];
  };

  const read = () => {
    if (!enabled) return [];
    try {
      return normalize(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      return [];
    }
  };

  const readHistory = () => {
    if (!enabled) return [];
    try {
      return normalize(JSON.parse(localStorage.getItem(historyKey) || "[]"));
    } catch {
      return [];
    }
  };

  const normalizePromotionState = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).map(([galleryKey, ids]) => [galleryKey, normalize(ids)])
    );
  };

  const readPromotions = () => {
    if (!enabled) return {};
    const fromStore = window.photosByElieReserve?.readPromotions?.();
    if (fromStore) return normalizePromotionState(fromStore);
    try {
      return normalizePromotionState(JSON.parse(localStorage.getItem(reservePromotionsKey) || "{}"));
    } catch {
      return {};
    }
  };

  const write = (items) => {
    const normalized = normalize(items);
    if (enabled) localStorage.setItem(key, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:unworthychange", { detail: { items: normalized } }));
    return normalized;
  };

  const writeHistory = (items) => {
    const normalized = normalize(items);
    if (enabled) localStorage.setItem(historyKey, JSON.stringify(normalized));
    return normalized;
  };

  const mark = (photoId) => {
    if (!enabled || !photoId) return read();
    const items = read();
    if (items.includes(photoId)) return items;
    writeHistory([...readHistory(), photoId]);
    return write([...items, photoId]);
  };

  const unmark = (photoId) => {
    if (!enabled || !photoId) return read();
    const items = read().filter((item) => item !== photoId);
    return write(items);
  };

  const unmarkMany = (photoIds = []) => {
    if (!enabled) return read();
    const wanted = new Set(normalize(photoIds));
    if (!wanted.size) return read();
    return write(read().filter((item) => !wanted.has(item)));
  };

  const undo = (preferredPhotoId = null) => {
    if (!enabled) return null;
    const items = read();
    if (preferredPhotoId && items.includes(preferredPhotoId)) {
      unmark(preferredPhotoId);
      return preferredPhotoId;
    }

    const history = [...readHistory()];
    while (history.length) {
      const candidate = history.pop();
      if (!items.includes(candidate)) continue;
      writeHistory(history);
      unmark(candidate);
      return candidate;
    }
    writeHistory(history);
    return null;
  };

  const has = (photoId) => read().includes(photoId);

  const activeRegularState = () => {
    const hidden = new Set(read());
    const promotions = readPromotions();
    const collections = window.photosByElieData || {};
    return Object.fromEntries(
      Object.entries(collections).map(([galleryKey, collection]) => {
        const regularIds = (collection.photos || []).map((photo) => photo.id).filter((photoId) => !hidden.has(photoId));
        const promotedIds = (promotions[galleryKey] || []).filter((photoId) => !hidden.has(photoId));
        const targetCount = collection.photos?.length || 0;
        return [galleryKey, [...new Set(regularIds.concat(promotedIds))].slice(0, targetCount)];
      })
    );
  };

  const exportBlacklist = () => {
    if (!enabled) return null;
    const photoIds = read();
    const payload = {
      format: "photosbyelie-blacklist",
      version: 2,
      exported_at: new Date().toISOString(),
      photo_ids: photoIds,
      reserve_promotions: readPromotions(),
      regular_state: activeRegularState(),
    };
    const stamp = payload.exported_at.replace(/[:.]/g, "-");
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `photosbyelie-${stamp}.pbe-blacklist`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return anchor.download;
  };

  const filterPhotos = (photos = []) => {
    if (!enabled) return photos;
    const hidden = new Set(read());
    return photos.filter((photo) => !hidden.has(photo.id));
  };

  window.photosByElieUnworthy = {
    enabled,
    filterPhotos,
    has,
    mark,
    read,
    exportBlacklist,
    undo,
    unmark,
    unmarkMany,
  };
})();
