(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const key = "photosbyelie-unworthy";
  const historyKey = "photosbyelie-unworthy-history";
  const reservePromotionsKey = "photosbyelie-reserve-promotions";
  const regularCapKey = "photosbyelie-regular-cap";
  const reserveOnlyKey = "photosbyelie-reserve-only";
  const countryAssignmentsKey = "photosbyelie-country-assignments";
  const countryAssignmentTargets = ["france", "usa", "spain", "mexico", "portugal", "slovakia"];
  let lastCurationPass = null;

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
    window.dispatchEvent(new CustomEvent("photosbyelie:unworthychange", { detail: { items: read() } }));
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

  const setRegularCap = (value) => {
    if (!enabled) return null;
    const nextValue = Number(value);
    if (Number.isInteger(nextValue) && nextValue > 0) {
      localStorage.setItem(regularCapKey, String(nextValue));
    } else {
      localStorage.removeItem(regularCapKey);
    }
    window.dispatchEvent(new CustomEvent("photosbyelie:unworthychange", { detail: { items: read() } }));
    return readRegularCap();
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

  const writeReserveOnly = (items) => {
    const normalized = normalize(items);
    if (enabled) localStorage.setItem(reserveOnlyKey, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:unworthychange", { detail: { items: read() } }));
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

  const mark = (photoId) => {
    if (!enabled || !photoId) return read();
    const items = read();
    if (items.includes(photoId)) return items;
    forgetReserveOnly([photoId]);
    writeHistory([...readHistory(), photoId]);
    return write([...items, photoId]);
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

  const returnToReserve = (photoId) => {
    if (!enabled || !photoId) return read();
    removePromotionEverywhere(photoId);
    const nextItems = read().filter((item) => item !== photoId);
    writeReserveOnly([...readReserveOnly(), photoId]);
    return write(nextItems);
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

  const exportCurationPass = () => {
    if (!enabled) return null;
    const photoIds = read();
    const payload = {
      format: "photosbyelie-curation-pass",
      version: 3,
      exported_at: new Date().toISOString(),
      photo_ids: photoIds,
      regular_cap: effectiveRegularCap(),
      reserve_only: readReserveOnly(),
      reserve_promotions: readPromotions(),
      regular_state: activeRegularState(),
      country_assignments: readCountryAssignments(),
    };
    const stamp = payload.exported_at.replace(/[:.]/g, "-");
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const filename = `photosbyelie-${stamp}.pbe-curation`;
    lastCurationPass = { filename, payload, text, url };
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return anchor.download;
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

  window.photosByElieUnworthy = {
    enabled,
    filterPhotos,
    has,
    mark,
    read,
    readCountryAssignments,
    readLastCurationPass,
    readReserveOnly,
    readRegularCap,
    effectiveRegularCap,
    exportBlacklist,
    exportCurationPass,
    returnToReserve,
    setCountryAssignment,
    setCountryAssignments,
    setRegularCap,
    undo,
    unmark,
    unmarkMany,
  };
})();
