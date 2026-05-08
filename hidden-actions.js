(() => {
  const enabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const ownerAuth = window.photosByElieOwnerAuth;
  const key = "photosbyelie-hidden";
  const historyKey = "photosbyelie-hidden-history";
  const reservePromotionsKey = "photosbyelie-reserve-promotions";
  const reserveOnlyKey = "photosbyelie-reserve-only";
  const countryAssignmentsKey = "photosbyelie-country-assignments";
  const photoActionEndpoint = "/__photosbyelie/photo-action";
  const countryAssignmentTargets = ["france", "usa", "spain", "mexico", "portugal", "slovakia"];
  let ownerBusyCount = 0;
  let ownerBusyMessage = "";

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

  const ensureOwnerBusyIndicator = () => {
    let indicator = document.querySelector("[data-owner-busy-indicator]");
    if (indicator) return indicator;
    indicator = document.createElement("div");
    indicator.className = "owner-busy-indicator";
    indicator.dataset.ownerBusyIndicator = "";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.innerHTML = `
      <span class="owner-busy-spinner" aria-hidden="true"></span>
      <strong data-owner-busy-message></strong>
    `;
    document.body.append(indicator);
    return indicator;
  };

  const updateOwnerBusyIndicator = () => {
    const indicator = ensureOwnerBusyIndicator();
    const message = indicator.querySelector("[data-owner-busy-message]");
    if (message) message.textContent = ownerBusyMessage;
  };

  const setOwnerBusy = (active, message = "") => {
    ownerBusyCount = Math.max(0, ownerBusyCount + (active ? 1 : -1));
    if (active && message) ownerBusyMessage = message;
    const busy = ownerBusyCount > 0;
    document.documentElement.classList.toggle("is-owner-action-busy", busy);
    document.body?.toggleAttribute("aria-busy", busy);
    if (busy) {
      updateOwnerBusyIndicator();
    } else {
      ownerBusyMessage = "";
      document.querySelector("[data-owner-busy-indicator]")?.remove();
    }
    window.dispatchEvent(new CustomEvent("photosbyelie:ownerbusychange", { detail: { busy, message: ownerBusyMessage } }));
    return busy;
  };

  const updateOwnerBusy = (message = "") => {
    if (message) ownerBusyMessage = message;
    if (ownerBusyCount > 0) updateOwnerBusyIndicator();
  };

  window.photosByElieSetOwnerBusy = setOwnerBusy;

  const photoAction = async (action, photoId, extra = {}) => {
    if (!enabled) return null;
    const authorized = await ownerAuth?.requireAuth?.(`Owner login required for ${action}.`);
    if (ownerAuth?.enabled && !authorized) {
      throw new Error("Owner login required.");
    }
    const photoOptionalActions = ["sync-country-keywords", "publish-hidden-blacklist", "wipe-hidden-r2"];
    const requestPayload = { action, ...extra };
    if (photoId) requestPayload.photo_id = photoId;
    if (!photoOptionalActions.includes(action) && !requestPayload.photo_id && !normalize(requestPayload.photo_ids).length) return null;
    setOwnerBusy(true);
    try {
      const response = await fetch(photoActionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        if (response.status === 401) ownerAuth?.markSignedOut?.();
        throw new Error(payload?.error || `Photo action failed: ${action}`);
      }
      return applyServerState(payload);
    } finally {
      setOwnerBusy(false);
    }
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

  const promoteHidden = async (photoId) => {
    if (!enabled || !photoId) return read();
    removePromotionEverywhere(photoId);
    await photoAction("promote-hidden", photoId);
    return read();
  };

  const returnToReserve = promoteHidden;

  const assignUnknownsToCountry = async (photoIds = [], galleryKey, options = {}) => {
    const ids = normalize(photoIds);
    if (!enabled || !ids.length || !countryAssignmentTargets.includes(galleryKey)) return null;
    const result = await photoAction("assign-country", ids[0], {
      photo_ids: ids,
      gallery_key: galleryKey,
      operation_id: options.operationId,
    });
    const assignedIds = normalize(
      result?.removed_from_unknown
      || result?.moved?.map((item) => item.id)
      || ids
    );
    setCountryAssignments(assignedIds.length ? assignedIds : ids, galleryKey);
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

  const publishHiddenBlacklist = async () => {
    if (!enabled) return null;
    return photoAction("publish-hidden-blacklist", null);
  };

  const wipeHiddenR2 = async () => {
    if (!enabled) return null;
    return photoAction("wipe-hidden-r2", null);
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
    readReserveOnly,
    assignUnknownsToCountry,
    promoteHidden,
    publishHiddenBlacklist,
    returnToReserve,
    setOwnerBusy,
    updateOwnerBusy,
    setCountryAssignment,
    setCountryAssignments,
    syncCountryKeywords,
    undo,
    unmark,
    unmarkMany,
    updatePhotoMetadata,
    wipeHiddenR2,
  };
})();
