(() => {
  const localEnabled = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const ownerAuth = window.photosByElieOwnerAuth;
  const cloudBaseUrl = String(window.photosByElieMediaConfig?.authWorkerBaseUrl || "").trim().replace(/\/+$/, "");
  const ownerApiBaseUrl = cloudBaseUrl ? `${cloudBaseUrl}/api/v1` : "";
  const localActionWakeUrls = [
    "http://localhost:8766/photosbyelie/wake-owner-action",
    "http://127.0.0.1:8766/photosbyelie/wake-owner-action",
  ];
  let remoteCullingEnabled = false;
  const cullingEnabled = () => localEnabled || remoteCullingEnabled;
  const key = "photosbyelie-hidden";
  const historyKey = "photosbyelie-hidden-history";
  const reservePromotionsKey = "photosbyelie-reserve-promotions";
  const reserveOnlyKey = "photosbyelie-reserve-only";
  const countryAssignmentsKey = "photosbyelie-country-assignments";
  const photoActionEndpoint = "/__photosbyelie/photo-action";
  const countryAssignmentTargets = ["france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"];
  let ownerBusyCount = 0;
  let ownerBusyMessage = "";
  let queuedPhotoAction = Promise.resolve();
  let remoteHiddenOverride = null;
  let remoteHiddenMetadata = {};
  const pendingHiddenIds = new Set();
  const idempotencyKey = (scope) =>
    `web-${String(scope || "owner").replace(/[^a-z0-9-]+/gi, "-")}-${Date.now().toString(36)}-${crypto.randomUUID()}`;

  const ownerActionBusyMessages = {
    hide: "Moving master to Waste Basket...",
    "undo-hide": "Putting master back...",
    "promote-hidden": "Putting master back...",
    "return-to-reserve": "Returning photo to Reserve...",
    discard: "Discarding photo and updating manifests...",
    "assign-country": "Assigning country and refreshing catalog state...",
    "sync-country-keywords": "Syncing country metadata into generated catalog files...",
    "remove-collection-keyword": "Removing collection keyword from catalog metadata...",
    "update-photo-metadata": "Saving title and keyword metadata...",
    "queue-title-keyword-review": "Sending photo to title/keyword review...",
    "queue-title-keyword-review-many": "Sending visible photos to title/keyword review...",
    "apply-title-keyword-review-approvals": "Saving title/keyword approvals and rejections...",
    "publish-hidden-blacklist": "Publishing master blacklist...",
    "wipe-hidden-r2": "Emptying waste basket",
    "save-title-keyword-review-approvals": "Saving title/keyword review decisions...",
  };

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

  const readStoredHiddenIds = () => {
    try {
      return normalize(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      return [];
    }
  };

  const read = () => {
    if (!cullingEnabled()) return [];
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
    try {
      return normalize(JSON.parse(localStorage.getItem(historyKey) || "[]"));
    } catch {
      return [];
    }
  };

  const readReserveOnly = () => {
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
    if (localEnabled) localStorage.setItem(reservePromotionsKey, JSON.stringify(normalized));
    return normalized;
  };

  const writeLoadedHiddenIds = () => {
    const ids = hiddenIdsFromLoadedData() || [];
    const mergedIds = normalize([...ids, ...pendingHiddenIds]);
    if (cullingEnabled()) localStorage.setItem(key, JSON.stringify(mergedIds));
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
    localStorage.removeItem(reservePromotionsKey);
    const items = writeLoadedHiddenIds();
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items, result } }));
    return result;
  };

  const metadataFor = (photoId) => {
    const metadata = remoteHiddenMetadata?.[photoId];
    return metadata && typeof metadata === "object" ? metadata : null;
  };

  const tryLocalActionWake = async (actionId) => {
    if (!actionId || typeof Promise.any !== "function") return null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 900);
    try {
      return await Promise.any(localActionWakeUrls.map(async (url) => {
        const response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.action) throw new Error("Local wake unavailable.");
        return payload.action;
      }));
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
      controller.abort();
    }
  };

  const refreshRemoteHiddenMetadata = async () => {
    if (localEnabled || !remoteCullingEnabled || !cloudBaseUrl) return remoteHiddenMetadata;
    const photoIds = read().slice(0, 500);
    if (!photoIds.length) return remoteHiddenMetadata;
    const response = await fetch(`${ownerApiBaseUrl}/actions`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey("hidden-metadata"),
      },
      body: JSON.stringify({
        actionKind: "owner-hidden-metadata",
        target: "max",
        payload: { photoIds, requestedConnector: "max" },
      }),
    });
    const queued = await response.json().catch(() => ({}));
    if (!response.ok || !queued?.action?.id) return remoteHiddenMetadata;
    const awakened = await tryLocalActionWake(queued.action.id);
    if (awakened?.state === "completed") {
      const result = awakened.result?.result || awakened.result || {};
      const metadata = result.hiddenMetadata;
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        remoteHiddenMetadata = metadata;
        window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read(), metadata: true } }));
      }
      return remoteHiddenMetadata;
    }
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const poll = await fetch(`${ownerApiBaseUrl}/actions/${encodeURIComponent(queued.action.id)}`, {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await poll.json().catch(() => ({}));
      if (!poll.ok) return remoteHiddenMetadata;
      const state = payload?.action?.state;
      if (state === "completed") {
        const result = payload.action.result?.result || payload.action.result || {};
        const metadata = result.hiddenMetadata;
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
          remoteHiddenMetadata = metadata;
          window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: read(), metadata: true } }));
        }
        return remoteHiddenMetadata;
      }
      if (state === "failed" || state === "cancelled") return remoteHiddenMetadata;
    }
    return remoteHiddenMetadata;
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

  const remoteOwnerAction = async (operation, photoId, extra = {}) => {
    if (!cloudBaseUrl) throw new Error("Owner action service is unavailable.");
    const photoIds = normalize(extra.photo_ids || (photoId ? [photoId] : []));
    const moderationPayload = {
      operation,
      photoId: photoId || photoIds[0] || "",
      photoIds,
      requestedConnector: "max",
    };
    ["title", "keywords", "mode"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(extra, key)) moderationPayload[key] = extra[key];
    });
    const response = await fetch(`${ownerApiBaseUrl}/actions`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey(operation),
      },
      body: JSON.stringify({
        actionKind: "photo-moderation",
        target: "max",
        payload: moderationPayload,
      }),
    });
    const queued = await response.json().catch(() => ({}));
    if (!response.ok || !queued?.action?.id) {
      if (response.status === 401) ownerAuth?.markSignedOut?.();
      throw new Error(queued?.error?.message || queued?.error || `Could not queue ${operation}.`);
    }
    const awakened = await tryLocalActionWake(queued.action.id);
    if (awakened?.state === "completed") {
      const result = awakened.result?.result || awakened.result || {};
      return applyServerState(result);
    }
    if (["failed", "cancelled"].includes(awakened?.state)) {
      throw new Error(awakened?.error?.message || awakened?.message || `${operation} failed.`);
    }
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const poll = await fetch(`${ownerApiBaseUrl}/actions/${encodeURIComponent(queued.action.id)}`, {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await poll.json().catch(() => ({}));
      if (!poll.ok) throw new Error(payload?.error?.message || payload?.error || `Could not check ${operation}.`);
      const state = payload?.action?.state;
      if (state === "completed") {
        const result = payload.action.result?.result || payload.action.result || {};
        return applyServerState(result);
      }
      if (state === "failed" || state === "cancelled") {
        throw new Error(payload?.action?.error?.message || payload?.action?.message || `${operation} failed.`);
      }
      updateOwnerBusy(`${ownerActionBusyMessages[operation] || "Owner action is running..."} (${state || "queued"})`);
    }
    throw new Error(`${operation} is still queued on Max. Try again in a moment.`);
  };

  const photoAction = async (action, photoId, extra = {}) => {
    if (!localEnabled && !cullingEnabled()) return null;
    const authorized = await ownerAuth?.requireAuth?.(`Start the local Photos By Elie server for ${action}.`);
    if (ownerAuth?.enabled && !authorized) {
      throw new Error("Owner helper server required.");
    }
    const photoOptionalActions = ["sync-country-keywords", "remove-collection-keyword", "publish-hidden-blacklist", "wipe-hidden-r2", "save-keyword-blacklist"];
    const requestPayload = { action, ...extra };
    if (photoId) requestPayload.photo_id = photoId;
    if (!photoOptionalActions.includes(action) && !requestPayload.photo_id && !normalize(requestPayload.photo_ids).length) return null;
    const blocksPage = localEnabled || !["hide", "hide-many", "update-photo-metadata"].includes(action);
    if (blocksPage) setOwnerBusy(true, ownerActionBusyMessages[action] || "Owner action is running...");
    try {
      if (!localEnabled) {
        if (!["hide", "hide-many", "undo-hide", "undo-hide-many", "discard", "update-photo-metadata", "save-keyword-blacklist"].includes(action)) {
          throw new Error("This Owner action is available from Sidecar on Max.");
        }
        return await remoteOwnerAction(action, photoId, extra);
      }
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
    if (cullingEnabled()) localStorage.setItem(key, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:hiddenchange", { detail: { items: normalized } }));
    return normalized;
  };

  const syncFromPublishedBlacklist = async () => {
    if (!localEnabled) return read();
    const href = window.photosByElieVersionedHref?.("./assets/hidden/hidden-blacklist.json") || "./assets/hidden/hidden-blacklist.json";
    const response = await fetch(href, { cache: "no-store" });
    if (!response.ok) throw new Error(`Blocked list ${response.status}`);
    const payload = await response.json();
    return write(payload?.photo_ids || []);
  };

  const writeHistory = (items) => {
    const normalized = normalize(items);
    if (cullingEnabled()) localStorage.setItem(historyKey, JSON.stringify(normalized));
    return normalized;
  };

  const writeReserveOnly = (items) => {
    const normalized = normalize(items);
    if (localEnabled) localStorage.setItem(reserveOnlyKey, JSON.stringify(normalized));
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
    if (!cullingEnabled() || !photoId) return read();
    const current = read();
    const queueHideAction = (options = {}) => {
      return enqueuePhotoAction("hide", photoId).then(() => {
        pendingHiddenIds.delete(photoId);
      }).catch((error) => {
        pendingHiddenIds.delete(photoId);
        const latest = read();
        if (options.revertOnError && latest.includes(photoId)) write(latest.filter((item) => item !== photoId));
        window.dispatchEvent(new CustomEvent("photosbyelie:owneractionerror", {
          detail: { action: "hide", photoId, message: error?.message || "Could not move photo to Waste Basket." },
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
    const queued = queueHideAction({ revertOnError: true });
    if (!localEnabled) await queued;
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
      await enqueuePhotoAction("hide-many", ids[0], { photo_ids: ids });
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
    const result = await photoAction("discard", photoId);
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

  const undo = async (preferredPhotoId = null) => {
    if (!cullingEnabled()) return null;
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

  const undoMany = async (photoIds = []) => {
    const ids = normalize(photoIds).filter((photoId) => read().includes(photoId));
    if (!cullingEnabled() || !ids.length) return [];
    if (localEnabled) {
      for (const photoId of ids) await photoAction("undo-hide", photoId);
    } else {
      await photoAction("undo-hide-many", ids[0], { photo_ids: ids });
    }
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
  };
  window.photosByElieHiddenActionsReady = (async () => {
    if (localEnabled) return syncFromPublishedBlacklist().catch(() => read());
    const state = ownerAuth?.state?.checked ? ownerAuth.state : await ownerAuth?.refresh?.();
    remoteCullingEnabled = Boolean(state?.authenticated && (state?.tier === "owner" || state?.roles?.includes?.("owner")));
    if (remoteCullingEnabled) setTimeout(() => refreshRemoteHiddenMetadata().catch(() => {}), 0);
    return read();
  })();
  window.addEventListener("photosbyelie:ownerauthchange", (event) => {
    if (localEnabled) return;
    const state = event.detail || {};
    remoteCullingEnabled = Boolean(state.authenticated && (state.tier === "owner" || state.roles?.includes?.("owner")));
    if (remoteCullingEnabled) refreshRemoteHiddenMetadata().catch(() => {});
    window.dispatchEvent(new CustomEvent("photosbyelie:moderationchange", { detail: { enabled: remoteCullingEnabled } }));
  });
})();
