(() => {
  const localEnabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const pbeOwnerSession = window.photosByEliePBEOwnerSession;
  const isHostedOwnerSurface = () => new URLSearchParams(window.location.search).get("gallery") === "pbe-owner";
  const cullingEnabled = () => Boolean(localEnabled && isHostedOwnerSurface() && pbeOwnerSession?.isReady?.());
  const key = "photosbyelie-hidden";
  const historyKey = "photosbyelie-hidden-history";
  const reservePromotionsKey = "photosbyelie-reserve-promotions";
  const reserveOnlyKey = "photosbyelie-reserve-only";
  const countryAssignmentsKey = "photosbyelie-country-assignments";
  const countryAssignmentTargets = ["france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"];
  let ownerBusyCount = 0;
  let ownerBusyMessage = "";
  let queuedPhotoAction = Promise.resolve();
  let remoteHiddenOverride = null;
  let remoteHiddenMetadata = {};
  const pendingHiddenIds = new Set();
  const ownerActionBusyMessages = {
    hide: "Moving master to Waste Basket...",
    "undo-hide": "Putting master back...",
    "promote-hidden": "Putting master back...",
    "return-to-reserve": "Returning photo to Reserve...",
    discard: "Moving photo to Waste Basket...",
    "waste-basket-x": "Moving photo to Waste Basket...",
    "waste-basket-x-many": "Moving photos to Waste Basket...",
    "waste-basket-restore": "Restoring photo from Waste Basket...",
    "waste-basket-empty": "Emptying Waste Basket...",
    "assign-country": "Assigning country and refreshing catalog state...",
    "sync-country-keywords": "Syncing country metadata into generated catalog files...",
    "remove-collection-keyword": "Removing collection keyword from catalog metadata...",
    "update-photo-metadata": "Saving title and keyword metadata...",
    "queue-title-keyword-review": "Sending photo to title/keyword review...",
    "queue-title-keyword-review-many": "Sending visible photos to title/keyword review...",
    "apply-title-keyword-review-approvals": "Saving title/keyword approvals and rejections...",
    "publish-hidden-blacklist": "Publishing master blacklist...",
    "wipe-hidden-r2": "R2 cleanup is disabled for lifecycle transitions",
    "save-title-keyword-review-approvals": "Saving title/keyword review decisions...",
  };

  const normalize = (items) => {
    if (!Array.isArray(items)) return [];
    return [...new Set(items.filter((item) => typeof item === "string" && item))];
  };

  const hostedOwnerSessionId = () => {
    if (!isHostedOwnerSurface()) return "";
    return String(pbeOwnerSession?.state?.()?.session?.id || "").trim();
  };

  const ownerStorageKey = (baseKey) => {
    if (!isHostedOwnerSurface()) return baseKey;
    const sessionId = hostedOwnerSessionId();
    return sessionId ? `${baseKey}:pbe-owner:${encodeURIComponent(sessionId)}` : "";
  };

  const ownerStorage = () => isHostedOwnerSurface() ? window.sessionStorage : window.localStorage;

  const readOwnerIds = (baseKey) => {
    const storageKey = ownerStorageKey(baseKey);
    if (!storageKey) return [];
    try {
      return normalize(JSON.parse(ownerStorage().getItem(storageKey) || "[]"));
    } catch {
      return [];
    }
  };

  const writeOwnerIds = (baseKey, items) => {
    const normalized = normalize(items);
    const storageKey = ownerStorageKey(baseKey);
    if (!storageKey) return normalized;
    try {
      ownerStorage().setItem(storageKey, JSON.stringify(normalized));
    } catch {
      // Hosted history remains memory-only when same-tab storage is unavailable.
    }
    return normalized;
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

  const readStoredHiddenIds = () => readOwnerIds(key);

  const read = () => {
    if (!cullingEnabled()) return [];
    if (isHostedOwnerSurface()) {
      return normalize([...readStoredHiddenIds(), ...pendingHiddenIds]);
    }
    if (!localEnabled && Array.isArray(remoteHiddenOverride)) {
      return normalize([...remoteHiddenOverride, ...pendingHiddenIds]);
    }
    const loadedHiddenIds = hiddenIdsFromLoadedData();
    const storedHiddenIds = readStoredHiddenIds();
    return normalize([
      ...(loadedHiddenIds || []),
      ...storedHiddenIds,
      ...pendingHiddenIds,
    ]);
  };

  const readHistory = () => {
    if (!cullingEnabled()) return [];
    return readOwnerIds(historyKey);
  };

  const readReserveOnly = () => {
    if (isHostedOwnerSurface()) return [];
    if (!localEnabled) return [];
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
    if (isHostedOwnerSurface()) return {};
    if (!localEnabled) return {};
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
    if (isHostedOwnerSurface()) return normalized;
    if (localEnabled) localStorage.setItem(reservePromotionsKey, JSON.stringify(normalized));
    return normalized;
  };

  const writeLoadedHiddenIds = () => {
    const ids = isHostedOwnerSurface() ? readStoredHiddenIds() : (hiddenIdsFromLoadedData() || []);
    const mergedIds = normalize([...ids, ...pendingHiddenIds]);
    if (cullingEnabled()) writeOwnerIds(key, mergedIds);
    return mergedIds;
  };

  const setMetadataValue = (photo, label, value) => {
    if (!photo) return;
    const metadata = Array.isArray(photo.metadata) ? photo.metadata : [];
    const existing = metadata.find((item) => item?.label === label);
    if (existing) {
      existing.value = value;
    } else {
      metadata.unshift({ label, value });
    }
    photo.metadata = metadata;
  };

  const applyMetadataEdit = (photo, metadata) => {
    if (!photo || !metadata?.photo_id || photo.id !== metadata.photo_id) return;
    const title = String(metadata.title || "").trim();
    const keywords = Array.isArray(metadata.keywords)
      ? metadata.keywords.join(", ")
      : String(metadata.keywords || "").trim();
    if (title) {
      photo.title = title;
      setMetadataValue(photo, "Metadata title", title);
    }
    setMetadataValue(photo, "Keywords", keywords);
    if (Array.isArray(metadata.keywords)) photo.keywords = metadata.keywords;
  };

  const applyMetadataEditToSite = (site, metadata) => {
    if (!site || !metadata?.photo_id) return;
    ["data", "owner", "reserve", "hidden"].forEach((section) => {
      Object.values(site[section] || {}).forEach((collection) => {
        (collection?.photos || []).forEach((photo) => applyMetadataEdit(photo, metadata));
      });
    });
  };

  const applyServerState = (result) => {
    if (!localEnabled && Array.isArray(result?.hidden_ids)) {
      remoteHiddenOverride = normalize(result.hidden_ids);
    }
    if (result?.action === "wipe-hidden-r2" && Array.isArray(result.hidden_ids)) {
      window.photosByElieHiddenData = {};
      const items = write(result.hidden_ids);
      window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items, result } }));
    }
    if (result?.metadata) {
      applyMetadataEditToSite({
        data: window.photosByElieData,
        owner: window.photosByElieOwnerData,
        reserve: window.photosByElieReserveData,
        hidden: window.photosByElieHiddenData,
      }, result.metadata);
      window.dispatchEvent(new CustomEvent("photosbyelie:metadatachange", { detail: result.metadata }));
    }
    if (!result?.site) return result;
    applyMetadataEditToSite(result.site, result.metadata);
    window.photosByElieData = result.site.data || {};
    window.photosByElieOwnerData = result.site.owner || {};
    window.photosByElieReserveData = result.site.reserve || {};
    window.photosByElieHiddenData = result.site.hidden || {};
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieData);
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieOwnerData);
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieReserveData);
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieHiddenData);
    if (!isHostedOwnerSurface()) localStorage.removeItem(reservePromotionsKey);
    const items = writeLoadedHiddenIds();
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items, result } }));
    return result;
  };

  const metadataFor = (photoId) => {
    const metadata = remoteHiddenMetadata?.[photoId];
    return metadata && typeof metadata === "object" ? metadata : null;
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
    if (!cullingEnabled()) {
      throw new Error("Owner actions require a ready, fixture-frozen session opened from Backstage on a Mac.");
    }
    if (extra.source !== "owner-gallery") {
      throw new Error("Hosted PBE Owner can act only through the recoverable gallery Waste Basket contract.");
    }
    const photoOptionalActions = ["sync-country-keywords", "remove-collection-keyword", "publish-hidden-blacklist", "wipe-hidden-r2", "save-keyword-blacklist", "waste-basket-empty"];
    const requestPayload = { action, ...extra };
    if (photoId) requestPayload.photo_id = photoId;
    if (!photoOptionalActions.includes(action) && !requestPayload.photo_id && !normalize(requestPayload.photo_ids).length) return null;
    const blocksPage = true;
    if (blocksPage) setOwnerBusy(true, ownerActionBusyMessages[action] || "Owner action is running...");
    try {
      const payload = await pbeOwnerSession.action(action, requestPayload);
      if (action === "update-photo-metadata" && !payload.metadata) {
        payload.metadata = {
          photo_id: requestPayload.photo_id,
          title: requestPayload.title,
          keywords: requestPayload.keywords,
        };
      }
      return applyServerState(payload);
    } finally {
      if (blocksPage) setOwnerBusy(false);
    }
  };

  const enqueuePhotoAction = (action, photoId, extra = {}) => {
    queuedPhotoAction = queuedPhotoAction.catch(() => {}).then(() => photoAction(action, photoId, extra));
    return queuedPhotoAction;
  };

  const readCountryAssignments = () => {
    if (!localEnabled) return {};
    try {
      return normalizeCountryAssignments(JSON.parse(localStorage.getItem(countryAssignmentsKey) || "{}"));
    } catch {
      return {};
    }
  };

  const writeCountryAssignments = (state) => {
    const normalized = normalizeCountryAssignments(state);
    if (localEnabled) localStorage.setItem(countryAssignmentsKey, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read() } }));
    return normalized;
  };

  const setCountryAssignment = (photoId, galleryKey) => {
    if (!localEnabled || !photoId) return readCountryAssignments();
    const assignments = readCountryAssignments();
    if (countryAssignmentTargets.includes(galleryKey)) {
      assignments[photoId] = galleryKey;
    } else {
      delete assignments[photoId];
    }
    return writeCountryAssignments(assignments);
  };

  const setCountryAssignments = (photoIds = [], galleryKey) => {
    if (!localEnabled) return readCountryAssignments();
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
    if (!localEnabled) return readCountryAssignments();
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
    if (cullingEnabled()) writeOwnerIds(key, normalized);
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: normalized } }));
    return normalized;
  };

  const syncFromPublishedBlacklist = async () => {
    if (isHostedOwnerSurface()) return read();
    if (!localEnabled) return read();
    const href = window.photosByElieVersionedHref?.("./assets/hidden/hidden-blacklist.json") || "./assets/hidden/hidden-blacklist.json";
    const response = await fetch(href, { cache: "no-store" });
    if (!response.ok) throw new Error(`Blocked list ${response.status}`);
    const payload = await response.json();
    return write(payload?.photo_ids || []);
  };

  const writeHistory = (items) => {
    return cullingEnabled() ? writeOwnerIds(historyKey, items) : normalize(items);
  };

  const writeReserveOnly = (items) => {
    const normalized = normalize(items);
    if (isHostedOwnerSurface()) return normalized;
    if (localEnabled) localStorage.setItem(reserveOnlyKey, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read() } }));
    return normalized;
  };

  const forgetReserveOnly = (photoIds = []) => {
    if (isHostedOwnerSurface()) return [];
    const wanted = new Set(normalize(photoIds));
    if (!wanted.size) return readReserveOnly();
    return writeReserveOnly(readReserveOnly().filter((item) => !wanted.has(item)));
  };

  const removePromotionEverywhere = (photoId) => {
    if (isHostedOwnerSurface()) return;
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

  const wasteBasketContext = { source: "owner-gallery", owner_mode: true, reason: "Owner gallery X" };

  const mark = async (photoId) => {
    if (!cullingEnabled() || !photoId) return read();
    const current = read();
    const queueHideAction = (options = {}) => {
      return enqueuePhotoAction("waste-basket-x", photoId, wasteBasketContext).then(() => {
        pendingHiddenIds.delete(photoId);
      }).catch((error) => {
        pendingHiddenIds.delete(photoId);
        const latest = read();
        if (options.revertOnError && latest.includes(photoId)) write(latest.filter((item) => item !== photoId));
        window.dispatchEvent(new CustomEvent("photosbyelie:owneractionerror", {
          detail: { action: "waste-basket-x", photoId, message: error?.message || "Could not move photo to Waste Basket." },
        }));
        throw error;
      });
    };
    if (current.includes(photoId)) {
      queueHideAction().catch(() => {});
      return current;
    }
    forgetReserveOnly([photoId]);
    pendingHiddenIds.add(photoId);
    const nextItems = write([...current, photoId]);
    writeHistory([...readHistory(), photoId]);
    await queueHideAction({ revertOnError: true });
    return nextItems;
  };

  const markMany = async (photoIds = []) => {
    const ids = normalize(photoIds).filter((photoId) => !read().includes(photoId));
    if (!cullingEnabled() || !ids.length) return read();
    ids.forEach((photoId) => pendingHiddenIds.add(photoId));
    const current = read();
    const nextItems = write([...current, ...ids]);
    writeHistory([...readHistory(), ...ids]);
    try {
      await enqueuePhotoAction("waste-basket-x-many", ids[0], { photo_ids: ids, ...wasteBasketContext });
      ids.forEach((photoId) => pendingHiddenIds.delete(photoId));
      return nextItems;
    } catch (error) {
      ids.forEach((photoId) => pendingHiddenIds.delete(photoId));
      unmarkMany(ids);
      throw error;
    }
  };

  const discard = async (photoId) => {
    if (!cullingEnabled() || !photoId) return null;
    forgetReserveOnly([photoId]);
    removePromotionEverywhere(photoId);
    const result = await photoAction("waste-basket-x", photoId, wasteBasketContext);
    unmark(photoId);
    return result;
  };

  const unmark = (photoId) => {
    if (!cullingEnabled() || !photoId) return read();
    forgetReserveOnly([photoId]);
    const items = read().filter((item) => item !== photoId);
    return write(items);
  };

  const unmarkMany = (photoIds = []) => {
    if (!cullingEnabled()) return read();
    const wanted = new Set(normalize(photoIds));
    if (!wanted.size) return read();
    forgetReserveOnly([...wanted]);
    return write(read().filter((item) => !wanted.has(item)));
  };

  const promoteHidden = async (photoId) => {
    if (!localEnabled || !photoId) return read();
    removePromotionEverywhere(photoId);
    await photoAction("promote-hidden", photoId);
    return read();
  };

  const returnToReserve = promoteHidden;

  const assignUnknownsToCountry = async (photoIds = [], galleryKey, options = {}) => {
    const ids = normalize(photoIds);
    if (!localEnabled || !ids.length || !countryAssignmentTargets.includes(galleryKey)) return null;
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
    if (!cullingEnabled() || !photoId) return null;
    return photoAction("update-photo-metadata", photoId, {
      title: updates.title,
      caption: updates.caption,
      keywords: updates.keywords,
    });
  };

  const saveKeywordBlacklist = async (keywords = []) => {
    if (!cullingEnabled()) return null;
    return photoAction("save-keyword-blacklist", null, {
      keywords: normalize(keywords.map((keyword) => String(keyword || "").trim()).filter(Boolean)),
      mode: "replace",
    });
  };

  const queueTitleKeywordReview = async (photoId, options = {}) => {
    if (!localEnabled || !photoId) return null;
    return photoAction("queue-title-keyword-review", photoId, {
      source: options.source,
      requested_by: options.requestedBy || "owner",
      context: options.context,
    });
  };

  const queueTitleKeywordReviewMany = async (photoIds = [], options = {}) => {
    const ids = normalize(photoIds);
    if (!localEnabled || !ids.length) return null;
    return photoAction("queue-title-keyword-review-many", ids[0], {
      photo_ids: ids,
      source: options.source,
      requested_by: options.requestedBy || "owner",
      context: options.context,
    });
  };

  const syncCountryKeywords = async () => {
    if (!localEnabled) return null;
    return photoAction("sync-country-keywords", null);
  };

  const removeCollectionKeyword = async (galleryKey, keyword) => {
    if (!localEnabled || !galleryKey || !String(keyword || "").trim()) return null;
    return photoAction("remove-collection-keyword", null, {
      gallery_key: galleryKey,
      keyword,
    });
  };

  const publishHiddenBlacklist = async () => {
    if (!localEnabled) return null;
    return photoAction("publish-hidden-blacklist", null);
  };

  const wipeHiddenR2 = async () => {
    if (!localEnabled) return null;
    return photoAction("wipe-hidden-r2", null);
  };

  const emptyWasteBasket = async (photoIds = []) => {
    if (!cullingEnabled()) return null;
    const ids = normalize(photoIds);
    return photoAction("waste-basket-empty", null, {
      photo_ids: ids,
      source: "backstage-waste-basket",
      actor: "owner",
      confirmed: true,
      confirmation_token: "EMPTY_WASTE_BASKET",
      reason: "explicit Empty Waste Basket",
    });
  };

  const undo = async (preferredPhotoId = null) => {
    if (!cullingEnabled()) return null;
    const items = read();
    if (preferredPhotoId && items.includes(preferredPhotoId)) {
      await photoAction("waste-basket-restore", preferredPhotoId, wasteBasketContext);
      return preferredPhotoId;
    }

    const history = [...readHistory()];
    while (history.length) {
      const candidate = history.pop();
      if (!items.includes(candidate)) continue;
      await photoAction("waste-basket-restore", candidate, wasteBasketContext);
      writeHistory(history);
      return candidate;
    }
    writeHistory(history);
    return null;
  };

  const undoMany = async (photoIds = []) => {
    const ids = normalize(photoIds).filter((photoId) => read().includes(photoId));
    if (!cullingEnabled() || !ids.length) return [];
    // The PBB-79 gateway commits or rolls back the entire restore set. Never
    // split a multi-selection into independently committed per-photo writes.
    await photoAction("waste-basket-restore", ids[0], { photo_ids: ids, ...wasteBasketContext });
    unmarkMany(ids);
    const restored = new Set(ids);
    writeHistory(readHistory().filter((photoId) => !restored.has(photoId)));
    return ids;
  };

  const has = (photoId) => read().includes(photoId);

  const filterPhotos = (photos = [], options = {}) => {
    if (!cullingEnabled()) return photos;
    const hidden = new Set(read());
    const reserveOnly = new Set(readReserveOnly());
    return photos.filter((photo) =>
      !hidden.has(photo.id)
      && (options.includeReserveOnly || !reserveOnly.has(photo.id))
    );
  };

  window.photosByElieHiddenActions = {
    get enabled() {
      return cullingEnabled();
    },
    get cullingEnabled() {
      return cullingEnabled();
    },
    filterPhotos,
    has,
    mark,
    markMany,
    metadataFor,
    read,
    readCountryAssignments,
    readReserveOnly,
    assignUnknownsToCountry,
    discard,
    promoteHidden,
    publishHiddenBlacklist,
    removeCollectionKeyword,
    returnToReserve,
    saveKeywordBlacklist,
    setOwnerBusy,
    updateOwnerBusy,
    setCountryAssignment,
    setCountryAssignments,
    queueTitleKeywordReview,
    queueTitleKeywordReviewMany,
    syncFromPublishedBlacklist,
    syncCountryKeywords,
    undo,
    undoMany,
    unmark,
    unmarkMany,
    updatePhotoMetadata,
    wipeHiddenR2,
    emptyWasteBasket,
  };
  window.photosByElieHiddenActionsReady = (async () => {
    await window.photosByEliePBEOwnerSessionReady;
    if (cullingEnabled()) return syncFromPublishedBlacklist().catch(() => read());
    return read();
  })();
  window.addEventListener("photosbyelie:pbeownerchange", (event) => {
    const enabled = Boolean(event.detail?.ready);
    window.dispatchEvent(new CustomEvent("photosbyelie:moderationchange", { detail: { enabled } }));
  });
})();
