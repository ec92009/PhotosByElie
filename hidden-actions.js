(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const key = "photosbyelie-hidden";
  const historyKey = "photosbyelie-hidden-history";
  const reservePromotionsKey = "photosbyelie-reserve-promotions";
  const regularCapKey = "photosbyelie-regular-cap";
  const reserveOnlyKey = "photosbyelie-reserve-only";
  const countryAssignmentsKey = "photosbyelie-country-assignments";
  const photoActionEndpoint = "/__photosbyelie/photo-action";
  const countryAssignmentTargets = ["france", "usa", "spain", "mexico", "portugal", "slovakia"];
  let lastCurationPass = null;

  const normalize = (items) => {
    if (!Array.isArray(items)) return [];
    return [...new Set(items.filter((item) => typeof item === "string" && item))];
  };

  const hiddenIdsFromLoadedData = () => {
    if (!window.photosByElieHiddenData) return null;
    const ids = [];
    Object.values(window.photosByElieHiddenData || {}).forEach((collection) => {
      (collection?.photos || []).forEach((photo) => {
        if (photo?.id) ids.push(photo.id);
      });
    });
    return normalize(ids);
  };

  const read = () => {
    if (!enabled) return [];
    const loadedHiddenIds = hiddenIdsFromLoadedData();
    if (loadedHiddenIds) {
      localStorage.setItem(key, JSON.stringify(loadedHiddenIds));
      return loadedHiddenIds;
    }
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

  const readReserveOnly = () => {
    if (!enabled) return [];
    try {
      return normalize(JSON.parse(localStorage.getItem(reserveOnlyKey) || "[]"));
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

  const normalizeCountryAssignments = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([photoId, galleryKey]) =>
        typeof photoId === "string"
        && photoId
        && countryAssignmentTargets.includes(galleryKey)
      )
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

  const writePromotions = (state) => {
    const normalized = normalizePromotionState(state);
    if (enabled) localStorage.setItem(reservePromotionsKey, JSON.stringify(normalized));
    return normalized;
  };

  const writeLoadedHiddenIds = () => {
    const ids = hiddenIdsFromLoadedData() || [];
    if (enabled) localStorage.setItem(key, JSON.stringify(ids));
    return ids;
  };

  const applyServerState = (result) => {
    if (!result?.site) return result;
    window.photosByElieData = result.site.data || {};
    window.photosByElieOwnerData = result.site.owner || {};
    window.photosByElieReserveData = result.site.reserve || {};
    window.photosByElieHiddenData = result.site.hidden || {};
    localStorage.removeItem(reservePromotionsKey);
    const items = writeLoadedHiddenIds();
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items, result } }));
    return result;
  };

  const photoAction = async (action, photoId, extra = {}) => {
    if (!enabled) return null;
    const requestPayload = { action, ...extra };
    if (photoId) requestPayload.photo_id = photoId;
    if (!["sync-country-keywords"].includes(action) && !requestPayload.photo_id && !normalize(requestPayload.photo_ids).length) return null;
    const response = await fetch(photoActionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Photo action failed: ${action}`);
    }
    return applyServerState(payload);
  };

  const readRegularCap = () => {
    if (!enabled) return null;
    const value = Number(localStorage.getItem(regularCapKey));
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  const effectiveRegularCap = () => {
    const savedCap = readRegularCap();
    if (savedCap) return savedCap;
    const collections = window.photosByElieData || {};
    return Math.max(1, ...Object.values(collections).map((collection) => collection.photos?.length || 0));
  };

  const readCountryAssignments = () => {
    if (!enabled) return {};
    try {
      return normalizeCountryAssignments(JSON.parse(localStorage.getItem(countryAssignmentsKey) || "{}"));
    } catch {
      return {};
    }
  };

  const writeCountryAssignments = (state) => {
    const normalized = normalizeCountryAssignments(state);
    if (enabled) localStorage.setItem(countryAssignmentsKey, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read() } }));
    return normalized;
  };

  const setCountryAssignment = (photoId, galleryKey) => {
    if (!enabled || !photoId) return readCountryAssignments();
    const assignments = readCountryAssignments();
    if (countryAssignmentTargets.includes(galleryKey)) {
      assignments[photoId] = galleryKey;
    } else {
      delete assignments[photoId];
    }
    return writeCountryAssignments(assignments);
  };

  const setCountryAssignments = (photoIds = [], galleryKey) => {
    if (!enabled) return readCountryAssignments();
    const assignments = readCountryAssignments();
    normalize(photoIds).forEach((photoId) => {
      if (countryAssignmentTargets.includes(galleryKey)) {
        assignments[photoId] = galleryKey;
      } else {
        delete assignments[photoId];
      }
    });
    return writeCountryAssignments(assignments);
  };

  const clearCountryAssignments = (photoIds = []) => {
    if (!enabled) return readCountryAssignments();
    const ids = new Set(normalize(photoIds));
    if (!ids.size) return readCountryAssignments();
    const assignments = readCountryAssignments();
    let changed = false;
    ids.forEach((photoId) => {
      if (!(photoId in assignments)) return;
      delete assignments[photoId];
      changed = true;
    });
    return changed ? writeCountryAssignments(assignments) : assignments;
  };

  const setRegularCap = (value) => {
    if (!enabled) return null;
    const nextValue = Number(value);
    if (Number.isInteger(nextValue) && nextValue > 0) {
      localStorage.setItem(regularCapKey, String(nextValue));
    } else {
      localStorage.removeItem(regularCapKey);
    }
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read() } }));
    return readRegularCap();
  };

  const write = (items) => {
    const normalized = normalize(items);
    if (enabled) localStorage.setItem(key, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: normalized } }));
    return normalized;
  };

  const writeHistory = (items) => {
    const normalized = normalize(items);
    if (enabled) localStorage.setItem(historyKey, JSON.stringify(normalized));
    return normalized;
  };

  const writeReserveOnly = (items) => {
    const normalized = normalize(items);
    if (enabled) localStorage.setItem(reserveOnlyKey, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read() } }));
    return normalized;
  };

  const forgetReserveOnly = (photoIds = []) => {
    const wanted = new Set(normalize(photoIds));
    if (!wanted.size) return readReserveOnly();
    return writeReserveOnly(readReserveOnly().filter((item) => !wanted.has(item)));
  };

  const removePromotionEverywhere = (photoId) => {
    const promotions = readPromotions();
    let changed = false;
    for (const [galleryKey, ids] of Object.entries(promotions)) {
      const nextIds = ids.filter((id) => id !== photoId);
      if (nextIds.length === ids.length) continue;
      promotions[galleryKey] = nextIds;
      changed = true;
    }
    if (changed) writePromotions(promotions);
  };

  const mark = async (photoId) => {
    if (!enabled || !photoId) return read();
    if (read().includes(photoId)) return read();
    forgetReserveOnly([photoId]);
    writeHistory([...readHistory(), photoId]);
    await photoAction("hide", photoId);
    return read();
  };

  const unmark = (photoId) => {
    if (!enabled || !photoId) return read();
    forgetReserveOnly([photoId]);
    const items = read().filter((item) => item !== photoId);
    return write(items);
  };

  const unmarkMany = (photoIds = []) => {
    if (!enabled) return read();
    const wanted = new Set(normalize(photoIds));
    if (!wanted.size) return read();
    forgetReserveOnly([...wanted]);
    return write(read().filter((item) => !wanted.has(item)));
  };

  const returnToReserve = async (photoId) => {
    if (!enabled || !photoId) return read();
    removePromotionEverywhere(photoId);
    await photoAction("return-to-reserve", photoId);
    return read();
  };

  const assignUnknownsToCountry = async (photoIds = [], galleryKey) => {
    const ids = normalize(photoIds);
    if (!enabled || !ids.length || !countryAssignmentTargets.includes(galleryKey)) return null;
    const result = await photoAction("assign-country", ids[0], {
      photo_ids: ids,
      gallery_key: galleryKey,
    });
    clearCountryAssignments(ids);
    return result;
  };

  const updatePhotoMetadata = async (photoId, updates = {}) => {
    if (!enabled || !photoId) return null;
    return photoAction("update-photo-metadata", photoId, {
      title: updates.title,
      keywords: updates.keywords,
    });
  };

  const syncCountryKeywords = async () => {
    if (!enabled) return null;
    return photoAction("sync-country-keywords", null);
  };

  const undo = async (preferredPhotoId = null) => {
    if (!enabled) return null;
    const items = read();
    if (preferredPhotoId && items.includes(preferredPhotoId)) {
      await photoAction("undo-hide", preferredPhotoId);
      return preferredPhotoId;
    }

    const history = [...readHistory()];
    while (history.length) {
      const candidate = history.pop();
      if (!items.includes(candidate)) continue;
      writeHistory(history);
      await photoAction("undo-hide", candidate);
      return candidate;
    }
    writeHistory(history);
    return null;
  };

  const has = (photoId) => read().includes(photoId);

  const activeRegularState = () => {
    const hidden = new Set(read());
    const reserveOnly = new Set(readReserveOnly());
    const promotions = readPromotions();
    const collections = window.photosByElieData || {};
    return Object.fromEntries(
      Object.entries(collections).map(([galleryKey, collection]) => {
        const regularIds = (collection.photos || [])
          .map((photo) => photo.id)
          .filter((photoId) => !hidden.has(photoId) && !reserveOnly.has(photoId));
        const promotedIds = (promotions[galleryKey] || [])
          .filter((photoId) => !hidden.has(photoId));
        const targetCount = effectiveRegularCap();
        return [galleryKey, [...new Set(regularIds.concat(promotedIds))].slice(0, targetCount)];
      })
    );
  };

  const createCurationPass = () => {
    if (!enabled) return null;
    const photoIds = read();
    const expoCap = effectiveRegularCap();
    const expoState = activeRegularState();
    const payload = {
      format: "photosbyelie-curation-pass",
      version: 3,
      exported_at: new Date().toISOString(),
      photo_ids: photoIds,
      expo_cap: expoCap,
      selection_mode: "browser",
      reserve_only: readReserveOnly(),
      reserve_promotions: readPromotions(),
      expo_state: expoState,
      country_assignments: readCountryAssignments(),
    };
    const stamp = payload.exported_at.replace(/[:.]/g, "-");
    const text = JSON.stringify(payload, null, 2);
    const filename = `photosbyelie-${stamp}.pbe-curation`;
    lastCurationPass = { filename, payload, text };
    return lastCurationPass;
  };

  const downloadLastCurationPass = () => {
    if (!enabled) return null;
    const curationPass = lastCurationPass || createCurationPass();
    if (!curationPass?.filename || !curationPass?.text) return null;
    const blob = new Blob([curationPass.text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = curationPass.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return anchor.download;
  };

  const exportCurationPass = (options = {}) => {
    if (!enabled) return null;
    const curationPass = createCurationPass();
    if (options.download !== false) downloadLastCurationPass();
    return curationPass?.filename || null;
  };

  const exportBlacklist = exportCurationPass;

  const readLastCurationPass = () => lastCurationPass;

  const filterPhotos = (photos = [], options = {}) => {
    if (!enabled) return photos;
    const hidden = new Set(read());
    const reserveOnly = new Set(readReserveOnly());
    return photos.filter((photo) =>
      !hidden.has(photo.id)
      && (options.includeReserveOnly || !reserveOnly.has(photo.id))
    );
  };

  window.photosByElieHiddenActions = {
    enabled,
    filterPhotos,
    has,
    mark,
    read,
    readCountryAssignments,
    readLastCurationPass,
    readReserveOnly,
    readRegularCap,
    assignUnknownsToCountry,
    createCurationPass,
    downloadLastCurationPass,
    effectiveRegularCap,
    exportBlacklist,
    exportCurationPass,
    returnToReserve,
    setCountryAssignment,
    setCountryAssignments,
    setRegularCap,
    syncCountryKeywords,
    undo,
    unmark,
    unmarkMany,
    updatePhotoMetadata,
  };
})();
