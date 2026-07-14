(() => {
  const $ = (selector) => document.querySelector(selector);
  const status = $("[data-sidecar-status]");
  const versionRoot = $("[data-sidecar-version]");
  const surface = $("[data-sidecar-grid]");
  const surfaceEyebrow = $("[data-sidecar-grid-eyebrow]");
  const surfaceTitle = $("[data-sidecar-grid-title]");
  const countsRoot = $("[data-sidecar-counts]");
  const previewStatusRoot = $("[data-sidecar-preview-status]");
  const previewStatusLabel = $("[data-sidecar-preview-label]");
  const previewStatusProgress = $("[data-sidecar-preview-progress]");
  const previewStatusCount = $("[data-sidecar-preview-count]");
  const planPanel = $("[data-sidecar-plan-panel]");
  const planEyebrow = $("[data-sidecar-plan-eyebrow]");
  const planTitle = $("[data-sidecar-plan-title]");
  const planOutput = $("[data-sidecar-plan-output]");
  const indexStatusRoot = $("[data-sidecar-index-status]");
  const indexStatusLabel = $("[data-sidecar-index-label]");
  const indexStatusCount = $("[data-sidecar-index-count]");
  const indexStatusProgress = $("[data-sidecar-index-progress]");
  const burstCullButton = $("[data-sidecar-burst-cull]");
  const emptyWastebasketButton = $("[data-sidecar-empty-wastebasket]");
  const uploadPlanButton = $("[data-sidecar-upload-plan]");
  const pageTabs = Array.from(document.querySelectorAll("[data-sidecar-page]"));
  const filterInputs = Array.from(document.querySelectorAll("[data-sidecar-filter]"));
  const filterToggleButtons = Array.from(document.querySelectorAll("[data-sidecar-filter-toggle]"));
  const searchInput = $("[data-sidecar-search]");
  const clearSearchButton = $("[data-sidecar-search-clear]");

  const storageKey = "photosByElie.sidecar.window.v4";
  const pageConfigs = {
    culling: {
      eyebrow: "Culling",
      title: "Current window",
      empty: "No items match the current search and filters.",
      filteredEmpty: "No items match the current search and filters.",
    },
    review: {
      eyebrow: "Review",
      title: "Picked title and keyword review",
      empty: "No picked items match the current search and filters.",
      filteredEmpty: "No picked items match the current search and filters.",
    },
  };
  const defaultFilters = {
    ratings: ["0", "1", "2", "3", "4", "5"],
    colors: ["none", "red", "yellow", "green", "blue", "purple"],
    pickStates: ["undecided", "picked", "rejected"],
    mediaTypes: ["photo", "video"],
  };
  const allowedFilters = {
    ratings: new Set(defaultFilters.ratings),
    colors: new Set(defaultFilters.colors),
    pickStates: new Set(defaultFilters.pickStates),
    mediaTypes: new Set(defaultFilters.mediaTypes),
  };
  const filterKeyByName = {
    rating: "ratings",
    color: "colors",
    pickState: "pickStates",
    mediaType: "mediaTypes",
  };
  const colorShortcuts = {
    6: "red",
    7: "yellow",
    8: "green",
    9: "blue",
  };
  const reworkCategories = [
    { value: "incorrect", label: "incorrect", note: "this title is incorrect" },
    { value: "generic", label: "too generic", note: "too generic; make the title more specific" },
    { value: "placeholder", label: "placeholder", note: "too placeholder-y; replace with a real title" },
    { value: "keywords", label: "use keywords", note: "use the existing keywords as clues" },
    { value: "detail", label: "add details", note: "dig up more details" },
    { value: "shoot", label: "use shoot", note: "use other photos in the 2-3 hour window for clues" },
    { value: "other", label: "other", note: "review this picked item and improve its title and keywords" },
  ];
  const reworkCategoryByValue = new Map(reworkCategories.map((category) => [category.value, category]));
  const defaultAiReviewNote = "review this picked item and improve its title and keywords";
  const burstWindowMs = 1000;
  const shootWindowMs = 2 * 60 * 60 * 1000;
  const undoLimit = 100;
  const refillBatchSize = 250;
  const refillMaxFetches = 120;
  const uploadBridgeMaxItems = 500;
  const previewFallbackMarkup = `
    <span class="sidecar-preview-loading">
      <span class="sidecar-loading-spinner" aria-hidden="true"></span>
      <span>Loading preview</span>
    </span>
    <span class="sidecar-thumb-fallback">Preview unavailable</span>
  `;
  const previewObservers = new WeakMap();
  let indexStatusTimer = null;
  let searchChangeTimer = null;
  let summaryRefreshTimer = null;
  let summaryRefreshPromise = null;
  let summaryRefreshQueued = false;
  let uploadRailRefreshTimer = null;
  let uploadRailRefreshPromise = null;
  let uploadRailRefreshQueued = false;

  const normalizePage = (value) => {
    if (value === "editing") return "review";
    return pageConfigs[value] ? value : "culling";
  };
  const isReviewPage = () => state.page === "review";
  const cloneDefaultFilters = () => ({
    ratings: [...defaultFilters.ratings],
    colors: [...defaultFilters.colors],
    pickStates: [...defaultFilters.pickStates],
    mediaTypes: [...defaultFilters.mediaTypes],
  });
  const normalizeFilterValues = (values, family) => {
    if (!Array.isArray(values)) return [...defaultFilters[family]];
    return values.map(String).filter((value) => allowedFilters[family].has(value));
  };
  const normalizeFilters = (filters = {}) => ({
    ratings: normalizeFilterValues(filters.ratings, "ratings"),
    colors: normalizeFilterValues(filters.colors, "colors"),
    pickStates: normalizeFilterValues(filters.pickStates, "pickStates"),
    mediaTypes: normalizeFilterValues(filters.mediaTypes, "mediaTypes"),
  });
  const normalizeOffsetStack = (values) => (Array.isArray(values) ? values : [])
    .map((value) => Math.max(0, Number(value || 0)))
    .filter(Number.isFinite)
    .slice(-50);
  const normalizeSearchQuery = (value = "") => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);

  const readStoredWindow = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null") || null;
    } catch {
      return null;
    }
  };

  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    page: normalizePage(urlParams.get("page") || readStoredWindow()?.page || "culling"),
    items: [],
    selectedIndex: -1,
    selectedIndexes: new Set(),
    selectedAssetIds: new Set(),
    selectedAssetId: "",
    selectionAnchorIndex: -1,
    selectionAnchorAssetId: "",
    quickLookIndex: -1,
    autoAdvanceDirection: 1,
    undoStack: [],
    summary: null,
    indexStatus: null,
    aiReviewResult: null,
    aiReviewRunning: false,
    uploadBridgeUploading: false,
    uploadBridgeCancelRequested: false,
    uploadBridgeRun: null,
    uploadBridgePlanStats: null,
    uploadBridgeRequestedCount: 1,
    keywordBlacklist: new Set(),
    filters: normalizeFilters(readStoredWindow()?.filters || cloneDefaultFilters()),
    searchQuery: normalizeSearchQuery(urlParams.get("q") || readStoredWindow()?.searchQuery || ""),
    hasWindow: false,
    windowStartOffset: 0,
    windowCursorOffset: 0,
    filteredIndexedCount: 0,
    windowBackStack: [],
    windowForwardStack: [],
    pendingSelectionAfterLoad: null,
  };

  const escapeHtml = (value = "") => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };
  const waitForStatusPaint = () => new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      window.setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  const withBusyControl = async (control, label, work) => {
    if (!control) return work();
    const originalText = control.textContent;
    const originalDisabled = control.disabled;
    control.disabled = true;
    control.classList.add("is-busy");
    control.setAttribute("aria-busy", "true");
    if (label) control.textContent = label;
    await waitForStatusPaint();
    try {
      return await work();
    } finally {
      if (!control.isConnected) return;
      control.disabled = originalDisabled;
      control.classList.remove("is-busy");
      control.removeAttribute("aria-busy");
      control.textContent = originalText;
    }
  };

  const renderIndexStatus = (payload = {}) => {
    state.indexStatus = payload;
    const summary = payload.sidecarSummary || state.summary || {};
    if (payload.sidecarSummary) state.summary = payload.sidecarSummary;
    if (!indexStatusRoot) return;
    const running = payload.status === "running";
    const failed = payload.status === "failed";
    const indexedCount = Number(summary.indexedCount ?? payload.importedCount ?? payload.indexedCount ?? 0);
    const activeCount = Number(payload.importedCount || payload.indexedCount || indexedCount || 0);
    const totalCount = Number(payload.totalCount || 0);
    const progress = Math.max(0, Math.min(1, Number(payload.progress || 0)));
    indexStatusRoot.hidden = false;
    indexStatusRoot.dataset.sidecarIndexState = failed ? "failed" : running ? "running" : "idle";
    if (indexStatusLabel) {
      if (running) {
        const stage = payload.stage || "Indexing Apple Photos";
        indexStatusLabel.textContent = totalCount
          ? `${stage}: ${activeCount.toLocaleString()} / ${totalCount.toLocaleString()}`
          : stage;
      } else if (failed) {
        indexStatusLabel.textContent = `Index failed: ${payload.error || "unknown error"}`;
      } else {
        const lastIndexed = summary.lastIndexedAt ? ` · last ${formatDate(summary.lastIndexedAt)}` : "";
        indexStatusLabel.textContent = `Local Photos index ready${lastIndexed}`;
      }
    }
    if (indexStatusCount) indexStatusCount.textContent = `${indexedCount.toLocaleString()} indexed`;
    if (indexStatusProgress) {
      indexStatusProgress.hidden = !running;
      indexStatusProgress.value = Math.round(progress * 100);
    }
  };

  const stopIndexStatusPolling = () => {
    if (!indexStatusTimer) return;
    window.clearInterval(indexStatusTimer);
    indexStatusTimer = null;
  };

  const startIndexStatusPolling = () => {
    if (indexStatusTimer) return;
    indexStatusTimer = window.setInterval(() => {
      refreshIndexStatus({ silent: true }).catch(() => {});
    }, 1000);
  };

  const refreshIndexStatus = async ({ silent = false } = {}) => {
    const response = await fetch("/__sidecar/index-status");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar index status.");
    renderIndexStatus(payload);
    renderCounts();
    if (payload.status === "running") startIndexStatusPolling();
    else stopIndexStatusPolling();
    if (!silent && payload.status !== "running") {
      const indexed = Number(payload.sidecarSummary?.indexedCount || 0);
      setStatus(`Local Photos index has ${indexed.toLocaleString()} active item${indexed === 1 ? "" : "s"}.`);
    }
    return payload;
  };

  const getLimit = () => Math.max(1, Number($("[data-sidecar-limit]")?.value || 96));
  const getOffset = () => Math.max(0, Number(state.windowStartOffset || 0));
  const setOffset = (offset) => {
    state.windowStartOffset = Math.max(0, Number(offset || 0));
  };

  const applyStoredWindow = () => {
    const stored = readStoredWindow();
    if (!stored) {
      filterInputs.forEach((input) => { input.checked = true; });
      if (searchInput) searchInput.value = state.searchQuery;
      return;
    }
    const limit = $("[data-sidecar-limit]");
    if (limit && stored.limit) limit.value = String(stored.limit);
    if (searchInput) searchInput.value = state.searchQuery;
    filterInputs.forEach((input) => {
      const key = filterKeyByName[input.dataset.sidecarFilter];
      input.checked = Boolean(key && state.filters[key]?.includes(input.value));
    });
  };

  const updateSearchClearState = () => {
    if (clearSearchButton) clearSearchButton.disabled = !normalizeSearchQuery(searchInput?.value || state.searchQuery);
  };

  const readFiltersFromControls = () => {
    const filters = { ratings: [], colors: [], pickStates: [], mediaTypes: [] };
    filterInputs.forEach((input) => {
      const key = filterKeyByName[input.dataset.sidecarFilter];
      if (key && input.checked) filters[key].push(input.value);
    });
    return normalizeFilters(filters);
  };

  const applyFilterChanges = async () => {
    state.filters = readFiltersFromControls();
    setOffset(0);
    state.windowCursorOffset = 0;
    state.windowBackStack = [];
    state.windowForwardStack = [];
    saveWindowState();
    await loadWindow();
  };

  const applySearchChanges = async () => {
    const nextQuery = normalizeSearchQuery(searchInput?.value || "");
    updateSearchClearState();
    if (nextQuery === state.searchQuery) return;
    state.searchQuery = nextQuery;
    setOffset(0);
    state.windowCursorOffset = 0;
    state.windowBackStack = [];
    state.windowForwardStack = [];
    syncPageUrl();
    saveWindowState();
    await loadWindow();
  };

  const saveWindowState = () => {
    const payload = {
      page: state.page,
      limit: getLimit(),
      windowStartOffset: getOffset(),
      filters: state.filters,
      searchQuery: state.searchQuery,
      hasWindow: state.hasWindow,
      windowCursorOffset: state.windowCursorOffset,
      filteredIndexedCount: state.filteredIndexedCount,
      windowBackStack: state.windowBackStack,
      windowForwardStack: state.windowForwardStack,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Local persistence is a convenience; Sidecar remains usable without it.
    }
  };

  const syncPageUrl = () => {
    const url = new URL(window.location.href);
    if (state.page === "culling") url.searchParams.delete("page");
    else url.searchParams.set("page", state.page);
    if (state.searchQuery) url.searchParams.set("q", state.searchQuery);
    else url.searchParams.delete("q");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState({}, "", nextUrl);
  };

  const formatDate = (value = "") => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  };

  const itemId = (item) => String(item?.assetId || item?.cloudIdentifier || item?.localIdentifier || "").trim();
  const previewUrl = (item) => `/__sidecar/preview/${encodeURIComponent(itemId(item))}?maxPixel=900`;
  const videoUrl = (item) => `/__sidecar/video/${encodeURIComponent(itemId(item))}`;
  const uniqueItemsById = (items) => {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter((item) => {
      const id = itemId(item);
      if (!id) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  const mediaTypeValue = (item) => (String(item?.mediaType || "photo").toLowerCase() === "video" ? "video" : "photo");
  const isVideo = (item) => mediaTypeValue(item) === "video";
  const formatDuration = (value = 0) => {
    const seconds = Math.max(0, Math.ceil(Number(value || 0)));
    if (!seconds) return "";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
    return `${minutes}:${String(remaining).padStart(2, "0")}`;
  };
  const mediaLabel = (item) => (isVideo(item) ? "" : "photo");
  const mediaLine = (item) => [formatDate(item.creationDate), mediaLabel(item)].filter(Boolean).join(" · ");
  const compactLocationLabel = (item) => {
    const label = String(item?.applePhotosMetadata?.locationLabel || "").trim();
    if (label) return label.split(",").map((part) => part.trim()).find(Boolean) || label;
    const latitude = Number(item?.location?.latitude);
    const longitude = Number(item?.location?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    }
    return "not indexed";
  };
  const cameraLabel = (item) => {
    const metadata = item?.cameraMetadata || item?.exifMetadata || item?.applePhotosMetadata?.camera || {};
    const make = String(metadata.make || metadata.cameraMake || "").trim();
    const model = String(metadata.model || metadata.cameraModel || metadata.lensModel || "").trim();
    const label = [make, model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return label || "not indexed";
  };
  const resourceFormatLabel = (item) => {
    const formats = Array.isArray(item?.resourceFormats) ? item.resourceFormats.filter(Boolean) : [];
    const source = formats.length ? formats.join(" + ") : String(item?.resourceFormat || item?.preferredResourceFormat || "").trim();
    const strategy = String(item?.exportStrategy || "").trim();
    if (isVideo(item)) return source || "video";
    if (strategy === "rendered_jpeg") return source ? `rendered JPG from ${source}` : "rendered JPG";
    return source || "not indexed";
  };
  const pixelSizeLabel = (item) => {
    const width = Number(item?.pixelWidth || 0);
    const height = Number(item?.pixelHeight || 0);
    return width && height ? `${width.toLocaleString()} x ${height.toLocaleString()}` : "not indexed";
  };
  const quickLookMetadata = (item) => {
    const rows = [
      ["Camera", cameraLabel(item)],
      ["Location", compactLocationLabel(item)],
      ["Format", resourceFormatLabel(item)],
      ["Size", pixelSizeLabel(item)],
    ];
    return `
      <dl class="sidecar-quick-look-metadata" aria-label="Photo metadata">
        ${rows.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join("")}
      </dl>
    `;
  };
  const captureTime = (item) => {
    const time = Date.parse(item?.creationDate || "");
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  };
  const playIconMarkup = `<span class="sidecar-play-icon" aria-hidden="true"></span>`;
  const videoOverlay = (item, index, label = "Play video preview") => {
    if (!isVideo(item)) return "";
    const duration = formatDuration(item.duration);
    return `
      <button class="sidecar-video-play" type="button" data-sidecar-video-inline data-sidecar-index="${index}" aria-label="${escapeHtml(label)}">${playIconMarkup}</button>
      ${duration ? `<span class="sidecar-video-duration" aria-label="Video length ${escapeHtml(duration)}">${escapeHtml(duration)}</span>` : ""}
    `;
  };
  const videoPlayerMarkup = (item, autoplay = true) => `
    <video class="sidecar-inline-video" controls playsinline preload="metadata" ${autoplay ? "autoplay" : ""} poster="${escapeHtml(previewUrl(item))}" src="${escapeHtml(videoUrl(item))}"></video>
  `;
  const versionFallback = "136.0";
  const versionFallbackLabel = `v${versionFallback}`;
  const videoBadge = (item, index, label) => isVideo(item)
    ? videoOverlay(item, index, label)
    : "";
  const selectedItem = () => state.items[state.selectedIndex] || null;
  const indexForAssetId = (assetId) => {
    const cleanId = String(assetId || "").trim();
    if (!cleanId) return -1;
    return state.items.findIndex((item) => itemId(item) === cleanId);
  };
  const selectedIndexes = () => Array.from(state.selectedIndexes || [])
    .filter((index) => index >= 0 && index < state.items.length)
    .sort((left, right) => left - right);
  const selectedAssetIds = () => selectedIndexes()
    .map((index) => itemId(state.items[index]))
    .filter(Boolean);
  const syncSelectionAssetState = () => {
    const ids = selectedAssetIds();
    state.selectedAssetIds = new Set(ids);
    state.selectedAssetId = itemId(selectedItem()) || ids[0] || "";
    state.selectionAnchorAssetId = itemId(state.items[state.selectionAnchorIndex]) || state.selectedAssetId || "";
  };
  const selectedItems = () => selectedIndexes().map((index) => state.items[index]).filter(Boolean);
  const selectedItemCount = () => selectedIndexes().length;
  const selectedSelectionSet = () => new Set(selectedIndexes());
  const selectionSnapshot = () => ({
    selectedIndex: state.selectedIndex,
    selectedIndexes: selectedIndexes(),
    selectedAssetId: state.selectedAssetId || itemId(selectedItem()) || "",
    selectedAssetIds: selectedAssetIds(),
    selectionAnchorIndex: state.selectionAnchorIndex,
    selectionAnchorAssetId: state.selectionAnchorAssetId || itemId(state.items[state.selectionAnchorIndex]) || "",
    autoAdvanceDirection: state.autoAdvanceDirection,
  });

  const restoreSelectionSnapshot = (snapshot = {}) => {
    const visible = new Set(visibleIndexes());
    const selectedByAsset = Array.isArray(snapshot.selectedAssetIds)
      ? snapshot.selectedAssetIds.map(indexForAssetId).filter((index) => visible.has(index))
      : [];
    const preferredByAsset = indexForAssetId(snapshot.selectedAssetId);
    const anchorByAsset = indexForAssetId(snapshot.selectionAnchorAssetId);
    const selected = Array.isArray(snapshot.selectedIndexes)
      ? snapshot.selectedIndexes.filter((index) => visible.has(index) && !selectedByAsset.includes(index))
      : [];
    const combinedSelected = [...selectedByAsset, ...selected];
    const preferred = visible.has(preferredByAsset)
      ? preferredByAsset
      : (visible.has(snapshot.selectedIndex) ? snapshot.selectedIndex : combinedSelected[0]);
    if (Number.isFinite(preferred)) {
      state.selectedIndex = preferred;
      state.selectedIndexes = new Set(combinedSelected.length ? combinedSelected : [preferred]);
      state.selectionAnchorIndex = visible.has(anchorByAsset)
        ? anchorByAsset
        : (visible.has(snapshot.selectionAnchorIndex) ? snapshot.selectionAnchorIndex : preferred);
      syncSelectionAssetState();
    } else {
      reconcileSelection(state.selectedIndex);
    }
    state.autoAdvanceDirection = snapshot.autoAdvanceDirection < 0 ? -1 : 1;
  };

  const scheduleSelectionAfterLoad = (target = {}) => {
    const index = Number(target.index);
    state.pendingSelectionAfterLoad = {
      index: Number.isFinite(index) ? index : -1,
      assetId: String(target.assetId || "").trim(),
    };
  };

  const applyPendingSelectionAfterLoad = () => {
    const target = state.pendingSelectionAfterLoad;
    state.pendingSelectionAfterLoad = null;
    if (!target) return false;
    reconcileSelection(target.index, { preferredAssetId: target.assetId });
    return true;
  };

  const undoSnapshot = (item) => {
    const sidecar = item?.sidecarState || {};
    return {
      rating: Math.max(0, Math.min(5, Number(sidecar.rating || 0))),
      color: sidecar.color || "",
      pickState: sidecar.pickState || "undecided",
      metadataState: sidecar.metadataState || "unreviewed",
      title: sidecar.title || "",
      keywords: Array.isArray(sidecar.keywords) ? sidecar.keywords.map(String) : [],
      reworkCategory: sidecar.reworkCategory || "",
      reworkComment: sidecar.reworkComment || "",
      tombstoneState: item?.tombstoneState || "",
    };
  };

  const indexesForAssetIds = (assetIds) => assetIds
    .map((assetId) => state.items.findIndex((item) => itemId(item) === assetId))
    .filter((index) => index >= 0);

  const beforeStatesForIndexes = (indexes) => new Map(indexes
    .map((index) => state.items[index])
    .filter(Boolean)
    .map((item) => [itemId(item), undoSnapshot(item)]));

  const visibilityForIndexes = (indexes) => new Map(indexes
    .filter((index) => index >= 0)
    .map((index) => [index, matchesFilters(state.items[index])]));

  const pickFilterValue = (item) => {
    const pickState = item.sidecarState?.pickState || "undecided";
    if (pickState === "picked") return "picked";
    if (pickState === "rejected" || pickState === "hidden") return "rejected";
    return "undecided";
  };

  const isBridgeQueuedItem = (item) => (
    item?.uploadBridgeState === "active"
    || item?.uploadBridge?.state === "active"
    || item?.mockUploadState === "active"
    || item?.mockUpload?.state === "active"
  );
  const isVisibleBaseItem = (item) => Boolean(item && item.tombstoneState !== "active" && !isBridgeQueuedItem(item));
  const isPickedItem = (item) => (item?.sidecarState?.pickState || "undecided") === "picked";
  const matchesRatingColorMediaFilters = (item) => {
    if (!isVisibleBaseItem(item)) return false;
    const sidecar = item.sidecarState || {};
    const rating = String(Math.max(0, Math.min(5, Number(sidecar.rating || 0))));
    const color = sidecar.color || "none";
    return state.filters.ratings.includes(rating)
      && state.filters.colors.includes(color)
      && state.filters.mediaTypes.includes(mediaTypeValue(item));
  };
  const matchesReviewFilters = (item) => matchesRatingColorMediaFilters(item) && isPickedItem(item);
  const matchesFilters = (item) => {
    if (!item || item.tombstoneState === "active") return false;
    if (isReviewPage()) return matchesReviewFilters(item);
    return matchesRatingColorMediaFilters(item)
      && state.filters.pickStates.includes(pickFilterValue(item));
  };

  const visibleIndexComparator = (left, right) => {
    if (!isReviewPage()) return left - right;
    const leftTime = captureTime(state.items[left]);
    const rightTime = captureTime(state.items[right]);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left - right;
  };

  const visibleIndexes = () => {
    const seen = new Set();
    return state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const id = itemId(item);
        if (!id || seen.has(id) || !matchesFilters(item)) return false;
        seen.add(id);
        return true;
      })
      .map(({ index }) => index)
      .sort(visibleIndexComparator)
      .slice(0, getLimit());
  };

  const firstVisibleIndex = () => visibleIndexes()[0] ?? -1;
  const nextVisibleAfter = (index) => {
    const visible = visibleIndexes();
    if (!visible.length) return -1;
    const currentPosition = visible.indexOf(index);
    if (currentPosition < 0) return visible[0] ?? -1;
    return visible[Math.min(visible.length - 1, currentPosition + 1)] ?? -1;
  };
  const nextVisibleFrom = (index, direction = 1) => {
    const visible = visibleIndexes();
    if (!visible.length) return -1;
    const currentPosition = visible.indexOf(index);
    if (currentPosition < 0) return direction < 0 ? visible[visible.length - 1] : visible[0];
    const delta = direction < 0 ? -1 : 1;
    return visible[Math.max(0, Math.min(visible.length - 1, currentPosition + delta))] ?? -1;
  };
  const visibleColumnCount = () => {
    if (!surface || isReviewPage()) return 1;
    const gridRoot = surface.querySelector(".sidecar-culling-items") || surface;
    const elements = Array.from(gridRoot.querySelectorAll(".sidecar-card[data-sidecar-index], .sidecar-editing-row[data-sidecar-index]"));
    if (elements.length <= 1) return 1;
    const firstTop = elements[0].getBoundingClientRect().top;
    const sameRowCount = elements.filter((element) => Math.abs(element.getBoundingClientRect().top - firstTop) <= 3).length;
    if (sameRowCount > 1) return sameRowCount;
    const template = getComputedStyle(gridRoot).gridTemplateColumns || "";
    const computedCount = template.split(/\s+/).filter((value) => value && value !== "none").length;
    return Math.max(1, computedCount || 1);
  };

  const arrowSelectionDelta = (key) => {
    if (key === "ArrowRight") return 1;
    if (key === "ArrowLeft") return -1;
    if (key === "ArrowDown") return visibleColumnCount();
    if (key === "ArrowUp") return -visibleColumnCount();
    return 0;
  };

  const stepVisibleSelection = (key, { extend = false } = {}) => {
    const delta = arrowSelectionDelta(key);
    if (!delta) return;
    state.autoAdvanceDirection = delta < 0 ? -1 : 1;
    const visible = visibleIndexes();
    if (!visible.length) return;
    const currentPosition = visible.indexOf(state.selectedIndex);
    const fallbackPosition = delta > 0 ? 0 : visible.length - 1;
    const nextPosition = currentPosition < 0
      ? fallbackPosition
      : Math.max(0, Math.min(visible.length - 1, currentPosition + delta));
    selectIndex(visible[nextPosition], { extend });
  };

  const reconcileSelection = (preferredIndex = null, {
    preserveSelection = false,
    previousSelection = null,
    preferredAssetId = "",
    previousSelectionAssetIds = null,
  } = {}) => {
    const visible = new Set(visibleIndexes());
    const preferredByAsset = indexForAssetId(preferredAssetId || state.selectedAssetId);
    const assetPreservedSource = Array.isArray(previousSelectionAssetIds)
      ? previousSelectionAssetIds
      : Array.from(state.selectedAssetIds || []);
    const preservedByAsset = assetPreservedSource
      .map(indexForAssetId)
      .filter((index) => visible.has(index));
    const preservedSource = previousSelection instanceof Set
      ? Array.from(previousSelection)
      : (preserveSelection ? selectedIndexes() : []);
    const preservedByIndex = preserveSelection
      ? preservedSource.filter((index) => visible.has(index))
      : [];
    const preserved = [...new Set([...preservedByAsset, ...preservedByIndex])];
    if (preserved.length) {
      state.selectedIndexes = new Set(preserved);
      if (visible.has(preferredByAsset) && preserved.includes(preferredByAsset)) state.selectedIndex = preferredByAsset;
      else if (preferredIndex !== null && preserved.includes(preferredIndex)) state.selectedIndex = preferredIndex;
      else if (!preserved.includes(state.selectedIndex)) state.selectedIndex = preserved[0];
      state.selectionAnchorIndex = preserved.includes(state.selectionAnchorIndex)
        ? state.selectionAnchorIndex
        : state.selectedIndex;
      syncSelectionAssetState();
      return;
    }
    if (visible.has(preferredByAsset)) {
      state.selectedIndex = preferredByAsset;
      state.selectedIndexes = new Set([preferredByAsset]);
      state.selectionAnchorIndex = preferredByAsset;
      syncSelectionAssetState();
      return;
    }
    if (preferredIndex !== null && preferredIndex >= 0 && visible.has(preferredIndex)) {
      state.selectedIndex = preferredIndex;
      state.selectedIndexes = new Set([preferredIndex]);
      state.selectionAnchorIndex = preferredIndex;
      syncSelectionAssetState();
      return;
    }
    const retained = selectedIndexes().filter((index) => visible.has(index));
    if (retained.length) {
      state.selectedIndexes = new Set(retained);
      state.selectedIndex = retained.includes(state.selectedIndex) ? state.selectedIndex : retained[0];
      state.selectionAnchorIndex = state.selectedIndex;
      syncSelectionAssetState();
      return;
    }
    const first = firstVisibleIndex();
    state.selectedIndex = first;
    state.selectedIndexes = first >= 0 ? new Set([first]) : new Set();
    state.selectionAnchorIndex = first;
    syncSelectionAssetState();
  };

  const setInitialSelection = () => {
    const first = firstVisibleIndex();
    state.selectedIndex = first;
    state.selectedIndexes = first >= 0 ? new Set([first]) : new Set();
    state.selectionAnchorIndex = first;
    syncSelectionAssetState();
  };

  const compactPreviewMessage = (message = "") => {
    if (message.includes("Apple Photos permission was not granted")) return "Photos access needed";
    if (message.includes("iCloud")) return "iCloud original not local";
    if (message.length <= 80) return message || "Preview unavailable";
    return `${message.slice(0, 77).trim()}...`;
  };

  const previewFailureMessage = async (source = "") => {
    if (!source) return { compact: "Preview unavailable", full: "", recoveredUrl: "" };
    try {
      const response = await fetch(source, { cache: "no-store" });
      if (response.ok && (response.headers.get("Content-Type") || "").startsWith("image/")) {
        const blob = await response.blob();
        return { compact: "", full: "", recoveredUrl: URL.createObjectURL(blob) };
      }
      let payload = null;
      try {
        payload = await response.clone().json();
      } catch (_error) {
        payload = null;
      }
      const full = payload?.error || response.statusText || "Preview unavailable";
      return { compact: compactPreviewMessage(full), full, recoveredUrl: "" };
    } catch (_error) {
      return { compact: "Preview unavailable", full: "", recoveredUrl: "" };
    }
  };

  const renderPreviewStatus = (root) => {
    if (!previewStatusRoot || !root || root !== surface) return;
    const images = Array.from(root.querySelectorAll("img[data-sidecar-preview]"));
    const total = images.length;
    if (!total) {
      previewStatusRoot.hidden = true;
      return;
    }
    const ready = images.filter((img) => img.dataset.sidecarPreviewState === "ready").length;
    const missing = images.filter((img) => img.dataset.sidecarPreviewState === "missing").length;
    const settled = ready + missing;
    previewStatusRoot.hidden = false;
    previewStatusRoot.dataset.sidecarPreviewState = settled >= total ? "ready" : "loading";
    if (previewStatusLabel) previewStatusLabel.textContent = settled >= total ? "Previews ready" : "Loading previews";
    if (previewStatusProgress) {
      previewStatusProgress.max = total;
      previewStatusProgress.value = settled;
    }
    if (previewStatusCount) {
      previewStatusCount.textContent = missing
        ? `${ready.toLocaleString()} ready · ${missing.toLocaleString()} unavailable`
        : `${ready.toLocaleString()} / ${total.toLocaleString()}`;
    }
  };

  const setPreviewState = (img, nextState, root) => {
    img.dataset.sidecarPreviewState = nextState;
    const container = img.closest(".sidecar-thumb, .sidecar-editing-preview, .sidecar-quick-look-media, .sidecar-upload-plan-tile");
    if (container) container.dataset.sidecarPreviewState = nextState;
    renderPreviewStatus(root);
  };

  const wirePreviewFallbacks = (root) => {
    if (!root) return;
    previewObservers.get(root)?.disconnect();
    const images = Array.from(root.querySelectorAll("img[data-sidecar-preview]"));
    const startPreview = (img) => {
      const source = img.dataset.sidecarPreviewSrc || "";
      if (source && !img.getAttribute("src")) {
        setPreviewState(img, "loading", root);
        img.setAttribute("src", source);
      }
    };
    images.forEach((img) => {
      setPreviewState(img, img.complete && img.naturalWidth > 0 ? "ready" : "queued", root);
      img.addEventListener("load", () => setPreviewState(img, "ready", root));
      const markMissing = async () => {
        const source = img.currentSrc || img.src || img.dataset.sidecarPreviewSrc || "";
        const container = img.closest(".sidecar-thumb, .sidecar-editing-preview, .sidecar-quick-look-media, .sidecar-upload-plan-tile");
        const fallback = container?.querySelector(".sidecar-thumb-fallback");
        const message = await previewFailureMessage(source);
        if (message.recoveredUrl) {
          const recoveredUrl = message.recoveredUrl;
          img.addEventListener("load", () => URL.revokeObjectURL(recoveredUrl), { once: true });
          img.setAttribute("src", recoveredUrl);
          return;
        }
        if (fallback) {
          fallback.textContent = message.compact;
          fallback.title = message.full || message.compact;
        }
        container?.classList.add("is-missing");
        setPreviewState(img, "missing", root);
        img.removeAttribute("src");
      };
      img.addEventListener("error", markMissing, { once: true });
      if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) markMissing();
    });
    const deferred = images.filter((img) => img.dataset.sidecarPreviewSrc && !img.getAttribute("src"));
    if (!deferred.length) return;
    if (!("IntersectionObserver" in window)) {
      deferred.forEach(startPreview);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        startPreview(entry.target);
      });
    }, { rootMargin: "700px 0px" });
    deferred.forEach((img) => observer.observe(img));
    previewObservers.set(root, observer);
    renderPreviewStatus(root);
  };

  const sidecarBadges = (item) => {
    const sidecar = item.sidecarState || {};
    const badges = [];
    if (sidecar.color) badges.push(sidecar.color);
    if (sidecar.pickState && sidecar.pickState !== "undecided") badges.push(sidecar.pickState);
    if (sidecar.metadataState && sidecar.metadataState !== "unreviewed") {
      const reworkLabel = sidecar.metadataState === "rework" ? reworkCategoryLabel(sidecar.reworkCategory) : "";
      badges.push(reworkLabel ? `rework: ${reworkLabel}` : sidecar.metadataState);
    }
    if (item.tombstoneState === "active") badges.push("tombstoned");
    if (item.pendingSyncCount) badges.push(`${item.pendingSyncCount} pending`);
    return badges.map((badge) => `<span class="sidecar-badge">${escapeHtml(badge)}</span>`).join("");
  };

  const quickLookStatusPill = (label, value, options = {}) => {
    const classes = ["sidecar-status-pill", options.className || ""].filter(Boolean).join(" ");
    const attrs = options.color ? ` data-sidecar-status-color="${escapeHtml(options.color)}"` : "";
    const renderedValue = options.rawValue ? value : escapeHtml(value);
    return `
      <span class="${classes}"${attrs}>
        <span>${escapeHtml(label)}</span>
        <strong>${renderedValue}</strong>
      </span>
    `;
  };

  const quickLookStatus = (item) => {
    const sidecar = item.sidecarState || {};
    const rating = Math.max(0, Math.min(5, Number(sidecar.rating || 0)));
    const stars = rating ? "&#9733;".repeat(rating) : "0";
    const color = sidecar.color || "";
    const decision = item.tombstoneState === "active"
      ? "tombstoned"
      : (sidecar.pickState || "undecided");
    const metadataBase = sidecar.metadataState || "unreviewed";
    const reworkLabel = metadataBase === "rework" ? reworkCategoryLabel(sidecar.reworkCategory) : "";
    const metadata = reworkLabel ? `rework: ${reworkLabel}` : metadataBase;
    const pending = Number(item.pendingSyncCount || 0);
    return `
      <div class="sidecar-quick-look-status" aria-label="Sidecar item status">
        ${quickLookStatusPill("Stars", stars, { rawValue: true, className: rating ? "has-stars" : "is-empty" })}
        ${quickLookStatusPill("Color", color || "none", { color, className: color ? "has-color" : "is-empty" })}
        ${quickLookStatusPill("Decision", decision, { className: decision === "undecided" ? "is-empty" : "" })}
        ${quickLookStatusPill("Metadata", metadata, { className: metadataBase === "unreviewed" ? "is-empty" : "" })}
        ${quickLookStatusPill("Pending", String(pending), { className: pending ? "" : "is-empty" })}
      </div>
    `;
  };

  const decisionClasses = (baseClass, item, selected = false) => {
    const sidecar = item.sidecarState || {};
    return [
      baseClass,
      selected ? "is-selected" : "",
      Number(sidecar.rating || 0) > 0 ? "has-rating" : "",
      sidecar.color ? "has-color" : "",
      sidecar.pickState === "picked" ? "is-picked" : "",
      sidecar.pickState === "rejected" ? "is-rejected" : "",
      sidecar.pickState === "hidden" ? "is-hidden-decision" : "",
      item.tombstoneState === "active" ? "is-tombstoned" : "",
    ].filter(Boolean).join(" ");
  };

  const decisionAttributeMap = (item) => {
    const sidecar = item.sidecarState || {};
    const attrs = {};
    if (sidecar.color) attrs["data-sidecar-color"] = sidecar.color;
    if (sidecar.pickState) attrs["data-sidecar-pick"] = sidecar.pickState;
    if (item.tombstoneState) attrs["data-sidecar-tombstone"] = item.tombstoneState;
    const rating = Number(sidecar.rating || 0);
    if (rating > 0) attrs["data-sidecar-rating"] = String(rating);
    return attrs;
  };

  const decisionAttrs = (item) => Object.entries(decisionAttributeMap(item))
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(" ");

  const syncDecisionAttrs = (element, item) => {
    ["data-sidecar-color", "data-sidecar-pick", "data-sidecar-tombstone", "data-sidecar-rating"].forEach((name) => {
      element.removeAttribute(name);
    });
    Object.entries(decisionAttributeMap(item)).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  };

  const ratingStars = (item) => {
    const rating = Math.max(0, Math.min(5, Number(item.sidecarState?.rating || 0)));
    return rating ? `<span class="sidecar-stars" aria-label="${rating} star rating">${"&#9733;".repeat(rating)}</span>` : "";
  };

  const reworkCategoryValues = (value = "") => {
    const rawValues = Array.isArray(value)
      ? value
      : String(value || "").split(/[;,|]/);
    const seen = new Set();
    return rawValues
      .map((item) => String(item || "").trim())
      .filter((item) => {
        if (!item || seen.has(item) || !reworkCategoryByValue.has(item)) return false;
        seen.add(item);
        return true;
      });
  };
  const reworkCategoryValue = (value = "") => reworkCategoryValues(value).join(",");
  const reworkCategoryLabel = (value = "") => reworkCategoryValues(value)
    .map((category) => reworkCategoryByValue.get(category)?.label || "")
    .filter(Boolean)
    .join(" + ");

  const parseKeywords = (value = "") => {
    const seen = new Set();
    return String(value || "")
      .replace(/;/g, ",")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .filter((keyword) => {
        const normalized = keyword.toLowerCase();
        if (state.keywordBlacklist.has(normalized) || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
  };

  const cleanKeywordList = (keywords = []) => {
    const seen = new Set();
    const values = Array.isArray(keywords) ? keywords : [keywords];
    return values
      .flatMap((keyword) => String(keyword || "").replace(/;/g, ",").split(","))
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .filter((keyword) => {
        const normalized = keyword.toLowerCase();
        if (state.keywordBlacklist.has(normalized) || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
  };

  const hasLocalMetadataDecision = (sidecar = {}) => {
    const metadataState = sidecar.metadataState || "unreviewed";
    if (metadataState && metadataState !== "unreviewed") return true;
    return ["metadata", "approve", "metadata-rework"].includes(sidecar.lastAction || "");
  };

  const seededMetadataForItem = (item) => {
    const metadata = item?.applePhotosMetadata || {};
    return {
      title: metadata.seedTitle || metadata.title || "",
      keywords: cleanKeywordList(metadata.seedKeywords?.length ? metadata.seedKeywords : metadata.keywords || []),
      locationLabel: metadata.locationLabel || "",
      locationKeywords: cleanKeywordList(metadata.locationKeywords || []),
    };
  };

  const effectiveMetadataForItem = (item) => {
    const sidecar = item?.sidecarState || {};
    if (hasLocalMetadataDecision(sidecar)) {
      return {
        title: sidecar.title || "",
        keywords: cleanKeywordList(Array.isArray(sidecar.keywords) ? sidecar.keywords : []),
      };
    }
    return seededMetadataForItem(item);
  };

  const metadataPayloadValuesForIndex = (index) => {
    const values = effectiveMetadataForItem(state.items[index]);
    return {
      title: values.title || "",
      keywords: cleanKeywordList(values.keywords || []),
    };
  };

  const loadKeywordBlacklist = async () => {
    try {
      const response = await fetch("./assets/owner-actions/keyword-blacklist.json", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const keywords = Array.isArray(payload?.keywords) ? payload.keywords : [];
      state.keywordBlacklist = new Set(keywords
        .map((keyword) => String(keyword || "").trim().toLowerCase())
        .filter(Boolean));
      if (state.hasWindow && isReviewPage()) renderSurface();
    } catch {
      state.keywordBlacklist = new Set();
    }
  };

  const rowFormForIndex = (index) => surface?.querySelector(`[data-sidecar-row-form][data-sidecar-index="${index}"]`);

  const checkedReworkCategories = (form) => Array.from(form?.querySelectorAll("[data-sidecar-rework-category]:checked") || [])
    .map((input) => input.value)
    .filter((value) => reworkCategoryByValue.has(value));

  const defaultReworkNote = (category) => reworkCategoryByValue.get(category)?.note || "";

  const generatedReworkNotePrefix = (categories = "") => reworkCategoryValues(categories)
    .map(defaultReworkNote)
    .filter(Boolean)
    .join("; ");

  const combinedReworkNote = (categories = "", manualNote = "") => {
    const prefix = generatedReworkNotePrefix(categories);
    const manual = String(manualNote || "").trim();
    if (!prefix) return manual;
    if (!manual) return prefix;
    if (manual === prefix || manual.startsWith(`${prefix};`)) return manual;
    return `${prefix}; ${manual}`;
  };

  const manualReworkNoteFromForm = (form) => {
    const note = form?.querySelector("[data-sidecar-rework-comment]");
    const current = String(note?.value || "").trim();
    const prefix = String(note?.dataset.sidecarReworkPrefix || "").trim();
    if (!prefix || !current) return current;
    if (current === prefix) return "";
    if (current.startsWith(`${prefix};`)) return current.slice(prefix.length + 1).trim();
    return current;
  };

  const syncReworkNoteFromCategories = (form) => {
    const note = form?.querySelector("[data-sidecar-rework-comment]");
    if (!note) return "";
    const categories = reworkCategoryValue(checkedReworkCategories(form));
    const manual = manualReworkNoteFromForm(form);
    const prefix = generatedReworkNotePrefix(categories);
    note.dataset.sidecarReworkPrefix = prefix;
    note.value = combinedReworkNote(categories, manual);
    return note.value;
  };

  const rowMetadataValues = (index) => {
    const item = state.items[index];
    const sidecar = item?.sidecarState || {};
    const form = rowFormForIndex(index);
    if (!form) {
      return {
        ...metadataPayloadValuesForIndex(index),
        reworkCategory: sidecar.reworkCategory || "",
        reworkComment: sidecar.reworkComment || "",
      };
    }
    const data = new FormData(form);
    return {
      title: String(data.get("title") || "").trim(),
      keywords: parseKeywords(data.get("keywords") || ""),
      reworkCategory: reworkCategoryValue(checkedReworkCategories(form)),
      reworkComment: String(data.get("reworkComment") || "").trim(),
    };
  };

  const metadataDecisionForIndex = (index, metadataState = "proposed") => ({
    assetId: itemId(state.items[index]),
    action: "metadata",
    ...rowMetadataValues(index),
    metadataState,
  });

  const metadataPayloadForIndex = (index, metadataState = "proposed") => {
    const { assetId, ...payload } = metadataDecisionForIndex(index, metadataState);
    return payload;
  };

  const reworkDecisionForIndex = (index, overrides = {}) => {
    const values = rowMetadataValues(index);
    return {
      assetId: itemId(state.items[index]),
      action: "metadata-rework",
      title: values.title,
      keywords: values.keywords,
      reworkCategory: overrides.reworkCategory ?? values.reworkCategory,
      reworkComment: overrides.reworkComment ?? values.reworkComment,
    };
  };

  const reworkPayloadForIndex = (index, overrides = {}) => {
    const { assetId, ...payload } = reworkDecisionForIndex(index, overrides);
    return payload;
  };

  const setReworkCategoryValue = (form, category) => {
    const selected = new Set(reworkCategoryValues(category));
    form?.querySelectorAll("[data-sidecar-rework-category]").forEach((input) => {
      input.checked = selected.has(input.value);
    });
  };

  const setRowFieldValue = (index, field, value) => {
    const form = rowFormForIndex(index);
    if (!form) return;
    if (field === "title") {
      const input = form.querySelector('[name="title"]');
      if (input) input.value = value;
    } else if (field === "keywords") {
      const input = form.querySelector('[name="keywords"]');
      if (input) input.value = value;
    }
  };

  const sameShootReviewIndexes = (sourceIndex) => {
    if (!isReviewPage() || !matchesReviewFilters(state.items[sourceIndex])) return [];
    const ordered = visibleIndexes();
    const sourcePosition = ordered.indexOf(sourceIndex);
    if (sourcePosition < 0) return [];
    const sourceTime = captureTime(state.items[sourceIndex]);
    if (!Number.isFinite(sourceTime)) return [sourceIndex];
    const targets = [];
    for (let position = sourcePosition; position < ordered.length; position += 1) {
      const index = ordered[position];
      const time = captureTime(state.items[index]);
      if (!Number.isFinite(time) || time - sourceTime > shootWindowMs) break;
      targets.push(index);
    }
    return targets;
  };

  const reworkCategoryMarkup = (index, selected = "") => `
    <fieldset class="sidecar-rework-categories" data-sidecar-rework-group>
      <legend>AI rework</legend>
      <div class="sidecar-rework-options">
        ${reworkCategories.map((category) => `
          <label class="sidecar-rework-option">
            <input type="checkbox" name="reworkCategory-${index}" value="${escapeHtml(category.value)}" data-sidecar-rework-category ${reworkCategoryValues(selected).includes(category.value) ? "checked" : ""}/>
            <span>${escapeHtml(category.label)}</span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;

  const burstSurvivorPositions = (size) => {
    const positions = new Set();
    if (size <= 1) positions.add(1);
    else if (size <= 5) positions.add(2);
    else {
      for (let position = 2; position <= size; position += 4) positions.add(position);
    }
    return positions;
  };

  const isStandardBurstPhoto = (item) => {
    if (!item || item.tombstoneState === "active" || isVideo(item) || item.eligible === false) return false;
    const time = Date.parse(item.creationDate || "");
    if (!Number.isFinite(time)) return false;
    const width = Number(item.pixelWidth || 0);
    const height = Number(item.pixelHeight || 0);
    if (width > 0 && height > 0 && Math.max(width / height, height / width) >= 2.0) return false;
    const pickState = item.sidecarState?.pickState || "undecided";
    return pickState !== "rejected" && pickState !== "hidden";
  };

  const burstCullPlan = () => {
    const candidates = visibleIndexes()
      .map((index) => ({ index, item: state.items[index], time: Date.parse(state.items[index]?.creationDate || "") }))
      .filter(({ item, time }) => isStandardBurstPhoto(item) && Number.isFinite(time))
      .sort((left, right) => (left.time - right.time) || (left.index - right.index));
    const groups = [];
    let current = [];
    let previous = null;
    candidates.forEach((candidate) => {
      if (previous && candidate.time - previous.time < burstWindowMs) current.push(candidate);
      else {
        if (current.length) groups.push(current);
        current = [candidate];
      }
      previous = candidate;
    });
    if (current.length) groups.push(current);

    const burstGroups = [];
    const rejectIndexes = new Set();
    let pickedSurvivorCount = 0;
    groups.forEach((group) => {
      if (group.length <= 1) return;
      const picked = group.filter(({ item }) => item.sidecarState?.pickState === "picked");
      const survivors = picked.length
        ? new Set(picked.map(({ index }) => index))
        : new Set([...burstSurvivorPositions(group.length)]
          .map((position) => group[position - 1]?.index)
          .filter((index) => Number.isFinite(index)));
      if (!survivors.size && group[0]) survivors.add(group[0].index);
      pickedSurvivorCount += picked.length;
      const rejected = [];
      group.forEach(({ index, item }) => {
        const pickState = item.sidecarState?.pickState || "undecided";
        if (survivors.has(index) || pickState === "picked" || pickState === "rejected" || pickState === "hidden") return;
        rejectIndexes.add(index);
        rejected.push(index);
      });
      if (rejected.length) {
        burstGroups.push({
          size: group.length,
          kept: [...survivors],
          rejected,
          startedAt: group[0]?.item?.creationDate || "",
        });
      }
    });
    return {
      burstGroups,
      rejectIndexes: [...rejectIndexes].sort((left, right) => left - right),
      pickedSurvivorCount,
    };
  };

  const renderCounts = (summary = state.summary) => {
    if (!countsRoot) return;
    if (!summary) {
      countsRoot.innerHTML = "";
      return;
    }
    countsRoot.innerHTML = `
      <div><dt>Window</dt><dd>${state.items.length.toLocaleString()}</dd></div>
      <div><dt>Showing</dt><dd>${visibleIndexes().length.toLocaleString()}</dd></div>
      <div><dt>Indexed</dt><dd>${Number(summary.indexedCount || 0).toLocaleString()}</dd></div>
      <div><dt>Pending</dt><dd>${Number(summary.pendingSyncCount || 0).toLocaleString()}</dd></div>
      <div><dt>Tombstoned</dt><dd>${Number(summary.tombstoneCount || 0).toLocaleString()}</dd></div>
    `;
  };

  const hidePlanPanel = () => {
    if (!planPanel) return;
    planPanel.hidden = true;
    planPanel.classList.remove("is-upload-plan");
    planPanel.dataset.sidecarPlanKind = "";
    if (planOutput) planOutput.innerHTML = "";
    document.body.classList.remove("sidecar-has-plan");
  };

  const renderPageChrome = () => {
    const config = pageConfigs[state.page] || pageConfigs.culling;
    const reviewActive = isReviewPage();
    if (surfaceEyebrow) surfaceEyebrow.textContent = config.eyebrow;
    if (surfaceTitle) surfaceTitle.textContent = config.title;
    document.body.dataset.sidecarActivePage = state.page;
    if (uploadPlanButton) {
      uploadPlanButton.hidden = !reviewActive;
      uploadPlanButton.disabled = !reviewActive;
    }
    if (!reviewActive && planPanel?.dataset.sidecarPlanKind === "upload") hidePlanPanel();
    if (reviewActive && planPanel?.hidden) renderUploadRailStatus();
    pageTabs.forEach((button) => {
      const selected = button.dataset.sidecarPage === state.page;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.classList.toggle("is-active", selected);
    });
  };

  const renderCullingGrid = (indexes) => {
    const itemMarkup = indexes.map((index) => {
      const item = state.items[index];
      const id = itemId(item);
      const selected = state.selectedIndexes.has(index);
      const label = item.filename || id;
      return `
        <article class="${decisionClasses("sidecar-card", item, selected)}" ${decisionAttrs(item)} data-sidecar-index="${index}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <div class="sidecar-thumb ${isVideo(item) ? "sidecar-video-surface" : ""}" data-sidecar-video-shell data-sidecar-index="${index}">
            <img data-sidecar-preview data-sidecar-preview-src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(label)}" loading="lazy"/>
            ${previewFallbackMarkup}
            ${videoBadge(item, index)}
            ${ratingStars(item)}
          </div>
          <div class="sidecar-card-copy">
            <strong>${escapeHtml(label)}</strong>
            <small>${escapeHtml(mediaLine(item))}</small>
            <div class="sidecar-badges">${sidecarBadges(item)}</div>
          </div>
        </article>
      `;
    }).join("");
    surface.innerHTML = `
      <div class="sidecar-culling-items">
        <button class="sidecar-window-step sidecar-window-step-back" type="button" data-sidecar-window-slide="-1" aria-label="Previous window" title="Previous window">
          <span aria-hidden="true">&lt;&lt;</span>
        </button>
        ${itemMarkup}
        <button class="sidecar-window-step sidecar-window-step-forward" type="button" data-sidecar-window-slide="1" aria-label="Next window" title="Next window">
          <span aria-hidden="true">&gt;&gt;</span>
        </button>
      </div>
    `;
  };

  const aiReviewResultMarkup = () => {
    const result = state.aiReviewResult;
    if (!result) return "";
    const proposed = Number(result.proposedCount || 0);
    const skipped = Number(result.skippedCount || 0);
    const scoped = Number(result.scopedCount || result.plannedCount || 0);
    const bits = [
      `${proposed.toLocaleString()} proposed`,
      `${skipped.toLocaleString()} skipped`,
      scoped ? `${scoped.toLocaleString()} scoped` : "",
    ].filter(Boolean);
    return `<span class="sidecar-review-ai-result">Last pass: ${escapeHtml(bits.join(" · "))}</span>`;
  };

  const renderEditingList = (indexes) => {
    const multi = selectedItemCount() > 1;
    const aiButtonLabel = state.aiReviewRunning ? "Running..." : "Run AI proposals";
    surface.innerHTML = `
      <div class="sidecar-review-toolbar">
        <button class="btn secondary sidecar-review-ai-action" type="button" data-sidecar-ai-propose-current ${indexes.length && !state.aiReviewRunning ? "" : "disabled"}>${aiButtonLabel}</button>
        ${aiReviewResultMarkup()}
      </div>
      <div class="sidecar-editing-list ${multi ? "has-multi-selection" : ""}">
        ${indexes.map((index) => renderEditingRow(index)).join("")}
      </div>
    `;
  };

  const renderEditingRow = (index) => {
    const item = state.items[index];
    const sidecar = item.sidecarState || {};
    const id = itemId(item);
    const label = item.filename || id;
    const selected = state.selectedIndexes.has(index);
    const metadataValues = effectiveMetadataForItem(item);
    const keywords = metadataValues.keywords.join(", ");
    const reworkPrefix = generatedReworkNotePrefix(sidecar.reworkCategory || "");
    const reworkComment = combinedReworkNote(sidecar.reworkCategory || "", sidecar.reworkComment || "");
    return `
      <article class="${decisionClasses("sidecar-editing-row", item, selected)}" ${decisionAttrs(item)} data-sidecar-index="${index}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
        <div class="sidecar-editing-preview ${isVideo(item) ? "sidecar-video-surface" : ""}" data-sidecar-video-shell data-sidecar-index="${index}">
          <img data-sidecar-preview data-sidecar-preview-src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(label)}" loading="lazy"/>
          ${previewFallbackMarkup}
          ${videoBadge(item, index)}
          ${ratingStars(item)}
        </div>
        <div class="sidecar-editing-current">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(mediaLine(item))}</small>
          <div class="sidecar-badges">${sidecarBadges(item)}</div>
        </div>
        <form class="sidecar-editing-form" data-sidecar-row-form data-sidecar-index="${index}">
          <label class="sidecar-editing-field">
            <span class="sidecar-editing-field-heading">
              <span>Title</span>
              <button class="sidecar-propagate-field" type="button" data-sidecar-propagate-field="title" data-sidecar-index="${index}" title="Propagate this title to current and following picked rows in the same two-hour shoot window" aria-label="Propagate title">↓</button>
            </span>
            <input type="text" name="title" value="${escapeHtml(metadataValues.title || "")}" placeholder="Title for Photos and future catalog"/>
          </label>
          <label class="sidecar-editing-field">
            <span class="sidecar-editing-field-heading">
              <span>Keywords</span>
              <button class="sidecar-propagate-field" type="button" data-sidecar-propagate-field="keywords" data-sidecar-index="${index}" title="Propagate these keywords to current and following picked rows in the same two-hour shoot window" aria-label="Propagate keywords">↓</button>
            </span>
            <textarea name="keywords" placeholder="Comma-separated descriptive keywords">${escapeHtml(keywords)}</textarea>
          </label>
          ${reworkCategoryMarkup(index, sidecar.reworkCategory || "")}
          <label class="sidecar-rework-note">
            <span>Rework note</span>
            <textarea name="reworkComment" data-sidecar-rework-comment data-sidecar-rework-prefix="${escapeHtml(reworkPrefix)}" placeholder="Optional instruction for the next AI pass">${escapeHtml(reworkComment)}</textarea>
          </label>
        </form>
        <div class="sidecar-editing-actions">
          <button class="sidecar-chip" type="button" data-sidecar-row-submit data-sidecar-index="${index}">Stage</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="approve" data-sidecar-index="${index}" aria-pressed="${sidecar.metadataState === "approved" ? "true" : "false"}">Approve</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="metadata-rework" data-sidecar-index="${index}" aria-pressed="${sidecar.metadataState === "rework" ? "true" : "false"}">AI rework</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-propagate data-sidecar-index="${index}">Propagate</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="pick" data-sidecar-index="${index}" aria-pressed="${sidecar.pickState === "picked" ? "true" : "false"}">Pick</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="unpick" data-sidecar-index="${index}" aria-pressed="${sidecar.pickState === "undecided" ? "true" : "false"}">Unpick</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="reject" data-sidecar-index="${index}" aria-pressed="${sidecar.pickState === "rejected" ? "true" : "false"}">Reject</button>
        </div>
      </article>
    `;
  };

  const renderSurface = () => {
    if (!surface) return;
    const config = pageConfigs[state.page] || pageConfigs.culling;
    surface.classList.toggle("is-editing-list", isReviewPage());
    surface.classList.toggle("is-culling-window", !isReviewPage());
    if (!state.items.length) {
      surface.innerHTML = `<p class="empty-basket">${escapeHtml(config.empty)}</p>`;
      if (previewStatusRoot) previewStatusRoot.hidden = true;
      renderCounts();
      return;
    }
    reconcileSelection();
    const indexes = visibleIndexes();
    if (!indexes.length) {
      surface.innerHTML = `<p class="empty-basket">${escapeHtml(config.filteredEmpty)}</p>`;
      if (previewStatusRoot) previewStatusRoot.hidden = true;
      renderCounts();
      return;
    }
    if (isReviewPage()) renderEditingList(indexes);
    else renderCullingGrid(indexes);
    wirePreviewFallbacks(surface);
    renderCounts();
  };

  const renderWindowLoading = () => {
    if (!surface || state.items.length) return;
    surface.classList.remove("is-editing-list", "is-culling-window");
    surface.innerHTML = `
      <div class="sidecar-window-loading" role="status" aria-live="polite">
        <span class="sidecar-loading-spinner" aria-hidden="true"></span>
        <span><strong>Loading Sidecar window</strong><small>Reading the local Photos index and Owner decisions</small></span>
      </div>
      <div class="sidecar-loading-tiles" aria-hidden="true">
        ${Array.from({ length: 12 }, () => '<span class="sidecar-loading-tile"></span>').join("")}
      </div>
    `;
    surface.setAttribute("aria-busy", "true");
    if (previewStatusRoot) previewStatusRoot.hidden = true;
  };

  const renderWindowFailure = (message = "Sidecar could not load this window.") => {
    if (!surface) return;
    surface.removeAttribute("aria-busy");
    surface.innerHTML = `
      <div class="sidecar-window-failure" role="alert">
        <strong>Sidecar window unavailable</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    if (previewStatusRoot) previewStatusRoot.hidden = true;
  };

  const cardForIndex = (index) => surface?.querySelector(`.sidecar-card[data-sidecar-index="${index}"], .sidecar-editing-row[data-sidecar-index="${index}"]`);

  const refreshRenderedItem = (index) => {
    const item = state.items[index];
    if (!item) return true;
    const element = cardForIndex(index);
    if (!element) return !matchesFilters(item);
    const baseClass = element.classList.contains("sidecar-editing-row") ? "sidecar-editing-row" : "sidecar-card";
    const selected = state.selectedIndexes.has(index);
    element.className = decisionClasses(baseClass, item, selected);
    element.setAttribute("aria-selected", selected ? "true" : "false");
    syncDecisionAttrs(element, item);

    const badges = element.querySelector(".sidecar-badges");
    if (badges) badges.innerHTML = sidecarBadges(item);

    const starRoot = element.querySelector(".sidecar-stars");
    const starMarkup = ratingStars(item);
    if (starRoot && starMarkup) starRoot.outerHTML = starMarkup;
    else if (starRoot) starRoot.remove();
    else if (starMarkup) {
      element.querySelector(".sidecar-thumb, .sidecar-editing-preview")?.insertAdjacentHTML("beforeend", starMarkup);
    }

    const sidecar = item.sidecarState || {};
    const pressedStates = {
      approve: sidecar.metadataState === "approved",
      "metadata-rework": sidecar.metadataState === "rework",
      pick: sidecar.pickState === "picked",
      unpick: sidecar.pickState === "undecided",
      reject: sidecar.pickState === "rejected",
    };
    Object.entries(pressedStates).forEach(([action, pressed]) => {
      element.querySelector(`[data-sidecar-row-action="${action}"]`)?.setAttribute("aria-pressed", pressed ? "true" : "false");
    });
    const form = element.querySelector("[data-sidecar-row-form]");
    if (form) {
      setReworkCategoryValue(form, sidecar.reworkCategory || "");
      const metadataValues = effectiveMetadataForItem(item);
      const titleInput = form.querySelector('[name="title"]');
      if (titleInput && document.activeElement !== titleInput) titleInput.value = metadataValues.title || "";
      const keywordsInput = form.querySelector('[name="keywords"]');
      if (keywordsInput && document.activeElement !== keywordsInput) keywordsInput.value = (metadataValues.keywords || []).join(", ");
      const note = form.querySelector("[data-sidecar-rework-comment]");
      if (note && document.activeElement !== note) {
        const prefix = generatedReworkNotePrefix(sidecar.reworkCategory || "");
        note.dataset.sidecarReworkPrefix = prefix;
        note.value = combinedReworkNote(sidecar.reworkCategory || "", sidecar.reworkComment || "");
      }
    }
    return true;
  };

  const refreshRenderedItems = (indexes) => {
    const uniqueIndexes = [...new Set(indexes)].filter((index) => Number.isFinite(index) && index >= 0);
    return uniqueIndexes.every((index) => refreshRenderedItem(index));
  };

  const clearVideoMessage = (shell) => {
    shell?.querySelectorAll("[data-sidecar-video-message]").forEach((message) => message.remove());
  };

  const setVideoMessage = (shell, message, title = "") => {
    if (!shell || !message) return;
    clearVideoMessage(shell);
    const messageRoot = document.createElement("span");
    messageRoot.className = "sidecar-video-message";
    messageRoot.dataset.sidecarVideoMessage = "true";
    messageRoot.textContent = message;
    if (title) messageRoot.title = title;
    shell.append(messageRoot);
  };

  const compactVideoMessage = (message = "") => compactPreviewMessage(message);

  const videoPreviewErrorMessage = async (response, fallback = "Local video preview is unavailable.") => {
    let payload = null;
    try {
      payload = await response.clone().json();
    } catch (_error) {
      payload = null;
    }
    return payload?.error || response.statusText || fallback;
  };

  const preflightVideoPreview = async (item) => {
    const response = await fetch(videoUrl(item), { headers: { Range: "bytes=0-0" } });
    if (!response.ok && response.status !== 206) {
      throw new Error(await videoPreviewErrorMessage(response));
    }
  };

  const updateGridSelection = (previousIndexes = new Set()) => {
    if (!surface) return;
    const indexes = new Set([...previousIndexes, ...selectedIndexes()]);
    indexes.add(state.selectedIndex);
    indexes.forEach((index) => {
      if (index < 0) return;
      const card = cardForIndex(index);
      if (!card) return;
      const selected = state.selectedIndexes.has(index);
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-selected", selected ? "true" : "false");
    });
  };

  const playVideoInPlace = async (shell, item, { autoplay = true } = {}) => {
    if (!shell || !item || !isVideo(item)) return;
    document.querySelectorAll(".sidecar-video-surface.is-playing-video").forEach((activeShell) => {
      if (activeShell === shell) return;
      activeShell.querySelectorAll(".sidecar-inline-video").forEach((video) => {
        video.pause();
        video.remove();
      });
      activeShell.classList.remove("is-playing-video");
    });
    shell.querySelectorAll(".sidecar-inline-video").forEach((video) => video.remove());
    clearVideoMessage(shell);
    shell.classList.add("is-loading-video");
    try {
      await preflightVideoPreview(item);
    } catch (error) {
      const message = error.message || "Local video preview is unavailable. Sidecar did not force an iCloud download.";
      shell.classList.remove("is-loading-video", "is-playing-video");
      setVideoMessage(shell, compactVideoMessage(message), message);
      setStatus(message);
      return;
    }
    shell.classList.remove("is-loading-video");
    shell.insertAdjacentHTML("beforeend", videoPlayerMarkup(item, autoplay));
    shell.classList.add("is-playing-video");
    const video = shell.querySelector(".sidecar-inline-video");
    if (!video) return;
    video.addEventListener("error", () => {
      shell.classList.remove("is-loading-video", "is-playing-video");
      video.remove();
      const message = "Local video preview is unavailable. Sidecar did not force an iCloud download.";
      setVideoMessage(shell, compactVideoMessage(message), message);
      setStatus(message);
    }, { once: true });
    video.addEventListener("canplay", () => {
      clearVideoMessage(shell);
      setStatus("Local video preview ready.");
    }, { once: true });
    if (autoplay) {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {
          video.muted = true;
          video.setAttribute("muted", "");
          const mutedPlayResult = video.play();
          if (mutedPlayResult && typeof mutedPlayResult.then === "function") {
            mutedPlayResult
              .then(() => setStatus("Local video preview playing muted; use controls for sound."))
              .catch(() => setStatus("Local video preview is ready; use the play control to start."));
          } else {
            setStatus("Local video preview playing muted; use controls for sound.");
          }
        });
      }
    }
  };

  const stopInlineVideos = (root = document) => {
    root.querySelectorAll(".sidecar-inline-video").forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
  };

  const closeQuickLook = () => {
    const quickLook = $("[data-sidecar-quick-look]");
    if (!quickLook) return;
    stopInlineVideos(quickLook);
    quickLook.remove();
    state.quickLookIndex = -1;
    document.body.classList.remove("sidecar-has-quick-look");
  };

  const renderQuickLook = () => {
    const item = state.items[state.quickLookIndex] || selectedItem();
    if (!item) return;
    const index = state.quickLookIndex >= 0 ? state.quickLookIndex : state.selectedIndex;
    const label = item.filename || itemId(item);
    const quickLook = document.createElement("div");
    quickLook.className = "sidecar-quick-look";
    quickLook.dataset.sidecarQuickLook = "true";
    quickLook.setAttribute("role", "dialog");
    quickLook.setAttribute("aria-modal", "true");
    quickLook.setAttribute("aria-label", `Preview ${label}`);
    quickLook.innerHTML = `
      <button class="sidecar-quick-look-close" type="button" data-sidecar-quick-look-close aria-label="Close preview">×</button>
      <figure class="sidecar-quick-look-card">
        <div class="sidecar-quick-look-media ${isVideo(item) ? "sidecar-video-surface" : ""}" data-sidecar-video-shell data-sidecar-index="${index}">
          <img data-sidecar-preview src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(label)}"/>
          ${previewFallbackMarkup}
          ${videoBadge(item, index, "Play video")}
        </div>
        ${quickLookStatus(item)}
        <figcaption>
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(mediaLine(item))}</span>
        </figcaption>
        ${quickLookMetadata(item)}
      </figure>
    `;
    const existingQuickLook = $("[data-sidecar-quick-look]");
    if (existingQuickLook) {
      stopInlineVideos(existingQuickLook);
      existingQuickLook.remove();
    }
    document.body.append(quickLook);
    document.body.classList.add("sidecar-has-quick-look");
    wirePreviewFallbacks(quickLook);
    if (isVideo(item)) {
      playVideoInPlace(quickLook.querySelector("[data-sidecar-video-shell]"), item);
    }
  };

  const syncQuickLookToSelection = () => {
    if (state.quickLookIndex < 0) return;
    if (state.selectedIndex < 0 || !state.items[state.selectedIndex]) {
      closeQuickLook();
      return;
    }
    state.quickLookIndex = state.selectedIndex;
    renderQuickLook();
  };

  const switchToCullingIfReviewEmpty = (message = "Review window is empty; returning to Culling.") => {
    if (!isReviewPage() || !state.hasWindow || visibleIndexes().length) return false;
    state.page = "culling";
    syncPageUrl();
    renderPageChrome();
    reconcileSelection(state.selectedIndex);
    renderSurface();
    syncQuickLookToSelection();
    saveWindowState();
    setStatus(message);
    return true;
  };

  const openQuickLook = (index = state.selectedIndex) => {
    if (!state.items.length || index < 0 || !state.items[index]) return;
    state.quickLookIndex = index;
    renderQuickLook();
  };

  const selectIndex = (index, { extend = false, toggle = false, scroll = true } = {}) => {
    if (!state.items.length) {
      state.selectedIndex = -1;
      state.selectedIndexes = new Set();
      state.selectedAssetIds = new Set();
      state.selectedAssetId = "";
      state.selectionAnchorIndex = -1;
      state.selectionAnchorAssetId = "";
      renderSurface();
      return;
    }
    const visible = new Set(visibleIndexes());
    if (!visible.has(index)) return;
    const bounded = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, state.items.length - 1));
    if (state.selectedIndex >= 0 && bounded !== state.selectedIndex) {
      state.autoAdvanceDirection = bounded < state.selectedIndex ? -1 : 1;
    }
    const previousIndexes = selectedSelectionSet();
    let nextIndexes;
    if (extend) {
      const anchor = state.selectionAnchorIndex >= 0 ? state.selectionAnchorIndex : (state.selectedIndex >= 0 ? state.selectedIndex : bounded);
      const start = Math.min(anchor, bounded);
      const end = Math.max(anchor, bounded);
      nextIndexes = toggle ? new Set(previousIndexes) : new Set();
      for (let rangeIndex = start; rangeIndex <= end; rangeIndex += 1) {
        if (visible.has(rangeIndex)) nextIndexes.add(rangeIndex);
      }
    } else if (toggle) {
      nextIndexes = new Set(previousIndexes);
      if (nextIndexes.has(bounded)) nextIndexes.delete(bounded);
      else nextIndexes.add(bounded);
      state.selectionAnchorIndex = bounded;
    } else {
      nextIndexes = new Set([bounded]);
      state.selectionAnchorIndex = bounded;
    }
    state.selectedIndexes = nextIndexes;
    if (nextIndexes.has(bounded)) state.selectedIndex = bounded;
    else state.selectedIndex = selectedIndexes()[0] ?? -1;
    syncSelectionAssetState();
    updateGridSelection(previousIndexes);
    syncQuickLookToSelection();
    if (scroll && state.selectedIndex >= 0) cardForIndex(state.selectedIndex)?.scrollIntoView({ block: "nearest" });
  };

  const mergeChangedItem = (assetId, nextState, pendingCount = 1) => {
    const index = state.items.findIndex((item) => itemId(item) === assetId);
    if (index < 0) return -1;
    const item = state.items[index];
    const { tombstoneState, pendingSyncCount, ...sidecarState } = nextState || {};
    item.sidecarState = { ...(item.sidecarState || {}), ...sidecarState };
    if (typeof tombstoneState !== "undefined") item.tombstoneState = tombstoneState || "";
    if (Number.isFinite(Number(pendingSyncCount))) item.pendingSyncCount = Number(pendingSyncCount);
    else item.pendingSyncCount = Math.max(Number(item.pendingSyncCount || 0), pendingCount);
    return index;
  };

  const applyBridgeQueuedItems = (items = []) => {
    const queuedIds = new Set(items.map((item) => item.assetId).filter(Boolean));
    if (!queuedIds.size) return 0;
    let changed = 0;
    state.items.forEach((item) => {
      if (!queuedIds.has(itemId(item))) return;
      item.uploadBridgeState = "active";
      item.uploadBridge = {
        ...(item.uploadBridge || item.mockUpload || {}),
        state: "active",
      };
      changed += 1;
    });
    if (changed) {
      reconcileSelection(state.selectedIndex);
      renderSurface();
      if (!switchToCullingIfReviewEmpty()) syncQuickLookToSelection();
    }
    return changed;
  };

  const applyChangedItems = (changedItems, visibilityBefore, {
    preferredIndex = state.selectedIndex,
    preferredAssetId = state.selectedAssetId,
    previousActive = state.selectedIndex,
    previousSelection = new Set(),
    previousSelectionAssetIds = null,
    preserveSelection = false,
    restoreSelection = null,
  } = {}) => {
    const changedIndexes = [];
    changedItems.forEach((item) => {
      const changedIndex = mergeChangedItem(item.assetId, item.state || {}, item.pendingSyncCount ?? item.changedFamilies?.length ?? 1);
      if (changedIndex >= 0) changedIndexes.push(changedIndex);
    });
    if (restoreSelection) restoreSelectionSnapshot(restoreSelection);
    else reconcileSelection(preferredIndex, {
      preserveSelection,
      previousSelection,
      preferredAssetId,
      previousSelectionAssetIds,
    });
    const visibilityChanged = changedIndexes.some((index) => visibilityBefore.get(index) !== matchesFilters(state.items[index]));
    if (visibilityChanged || !refreshRenderedItems([...changedIndexes, previousActive, ...previousSelection, ...selectedIndexes()])) {
      renderSurface();
    } else {
      renderCounts();
    }
    const switchedToCulling = switchToCullingIfReviewEmpty();
    if (!switchedToCulling) syncQuickLookToSelection();
    return { changedIndexes, visibilityChanged, switchedToCulling };
  };

  const colorDecisionPayload = (color) => {
    if (!color) return { action: "color", color: "" };
    const targets = selectedItems();
    const allTargetsAlreadyColor = targets.length > 0 && targets.every((item) => (item.sidecarState?.color || "") === color);
    return { action: "color", color: allTargetsAlreadyColor ? "" : color };
  };

  const actionLabel = (payload) => {
    if (payload.action === "color" && !payload.color) return "clear color";
    if (payload.action === "color") return `${payload.color} color`;
    if (payload.action === "metadata-rework") {
      const label = reworkCategoryLabel(payload.reworkCategory);
      return label ? `AI rework (${label})` : "AI rework";
    }
    if (payload.action === "metadata" && payload.metadataState === "approved") return "metadata approval";
    if (payload.action === "metadata") return "metadata";
    return payload.action;
  };

  const pushUndoEntry = (label, changedItems, beforeStates, selection) => {
    const items = changedItems
      .map((item) => ({
        assetId: item.assetId,
        before: beforeStates.get(item.assetId),
        changedFamilies: Array.isArray(item.changedFamilies) ? item.changedFamilies : [],
      }))
      .filter((item) => item.assetId && item.before && item.changedFamilies.length);
    if (!items.length) return;
    state.undoStack.push({
      label,
      items,
      selection,
      createdAt: Date.now(),
    });
    if (state.undoStack.length > undoLimit) state.undoStack.splice(0, state.undoStack.length - undoLimit);
  };

  const pickStateUndoPayload = (assetId, pickState) => {
    const action = {
      picked: "pick",
      rejected: "reject",
      hidden: "hide",
      undecided: "unpick",
    }[pickState || "undecided"] || "unpick";
    return { assetId, action };
  };

  const undoPayloadsForEntry = (entry) => entry.items.flatMap((item) => {
    const previous = item.before || {};
    const families = new Set(item.changedFamilies || []);
    const payloads = [];
    if (families.has("tombstone")) {
      payloads.push({
        assetId: item.assetId,
        action: previous.tombstoneState === "active" ? "tombstone" : "restore",
        reason: "undo",
      });
    }
    if (families.has("rating")) payloads.push({ assetId: item.assetId, action: "rating", rating: previous.rating || 0 });
    if (families.has("color")) payloads.push({ assetId: item.assetId, action: "color", color: previous.color || "" });
    if (families.has("pick_state")) payloads.push(pickStateUndoPayload(item.assetId, previous.pickState));
    if (families.has("metadata")) {
      payloads.push({
        assetId: item.assetId,
        action: "metadata",
        title: previous.title || "",
        keywords: Array.isArray(previous.keywords) ? previous.keywords : [],
        metadataState: previous.metadataState || "unreviewed",
        reworkCategory: previous.reworkCategory || "",
        reworkComment: previous.reworkComment || "",
      });
    }
    return payloads;
  });

  const postDecision = async (payload, { advance = true, indexes = null, recordUndo = true } = {}) => {
    const targetIndexes = Array.isArray(indexes) ? indexes : selectedIndexes();
    if (!targetIndexes.length) return;
    const previousActive = state.selectedIndex;
    const previousSelection = selectedSelectionSet();
    const selectionBefore = selectionSnapshot();
    const beforeStates = beforeStatesForIndexes(targetIndexes);
    const visibilityBefore = visibilityForIndexes(targetIndexes);
    const decisions = targetIndexes
      .map((index) => state.items[index])
      .filter(Boolean)
      .map((item) => ({ assetId: itemId(item), ...payload }));
    if (!decisions.length) return;

    setStatus(`Staging ${actionLabel(payload)} on ${decisions.length.toLocaleString()} item${decisions.length === 1 ? "" : "s"}...`);
    await waitForStatusPaint();
    const endpoint = decisions.length === 1 ? "/__sidecar/decision?summary=0" : "/__sidecar/decisions?summary=0";
    const body = decisions.length === 1 ? decisions[0] : { decisions };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      const error = new Error(result.error || "Could not stage Sidecar decision.");
      if (response.status >= 500 && state.hasWindow) {
        setStatus(`The decision response was interrupted. Reconciling ${decisions.length.toLocaleString()} item${decisions.length === 1 ? "" : "s"} from Owner cloud...`);
        const reconciled = await loadWindow();
        if (reconciled?.sidecarCloud?.ok) {
          setStatus(`Owner cloud state reconciled after an interrupted decision response. Accepted changes are reflected; retry only items that remain.`);
          return;
        }
      }
      throw error;
    }

    const changedItems = decisions.length === 1 ? [result] : (result.items || []);
    if (recordUndo) pushUndoEntry(actionLabel(payload), changedItems, beforeStates, selectionBefore);
    if (result.summary) state.summary = result.summary;
    else refreshSummaryQuietly();
    const preferredIndex = advance && !indexes && decisions.length === 1
      ? nextVisibleFrom(previousActive, state.autoAdvanceDirection)
      : previousActive;
    const preferredAssetId = preferredIndex >= 0
      ? itemId(state.items[preferredIndex])
      : selectionBefore.selectedAssetId;
    if (advance && !indexes && decisions.length === 1) {
      scheduleSelectionAfterLoad({ index: preferredIndex, assetId: preferredAssetId });
    }
    const applyResult = applyChangedItems(changedItems, visibilityBefore, {
      preferredIndex,
      preferredAssetId,
      previousActive,
      previousSelection,
      previousSelectionAssetIds: selectionBefore.selectedAssetIds,
      preserveSelection: !indexes && decisions.length > 1,
    });
    refreshUploadRailQuietly();
    if ((applyResult.visibilityChanged || applyResult.switchedToCulling) && state.hasWindow) {
      await loadWindow();
    }
    setStatus(`Saved ${actionLabel(payload)} on ${decisions.length.toLocaleString()} item${decisions.length === 1 ? "" : "s"} to Owner cloud. Photos write-back is pending commit.`);
  };

  const postDecisions = async (decisions, message, completeMessage = "", {
    recordUndo = true,
    undoLabel = "cloud decisions",
    restoreSelection = null,
    preserveSelection = false,
  } = {}) => {
    if (!decisions.length) return;
    const assetIds = decisions.map((decision) => String(decision.assetId || decision.asset_id || decision.localIdentifier || "")).filter(Boolean);
    const targetIndexes = indexesForAssetIds(assetIds);
    const previousActive = state.selectedIndex;
    const previousSelection = selectedSelectionSet();
    const selectionBefore = selectionSnapshot();
    const beforeStates = beforeStatesForIndexes(targetIndexes);
    const visibilityBefore = visibilityForIndexes(targetIndexes);
    setStatus(message || `Saving ${decisions.length.toLocaleString()} cloud decisions...`);
    await waitForStatusPaint();
    const response = await fetch("/__sidecar/decisions?summary=0", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      const error = new Error(result.error || "Could not stage Sidecar decisions.");
      if (response.status >= 500 && state.hasWindow) {
        setStatus(`The bulk decision response was interrupted. Reconciling ${decisions.length.toLocaleString()} items from Owner cloud...`);
        const reconciled = await loadWindow();
        if (reconciled?.sidecarCloud?.ok) {
          setStatus("Owner cloud state reconciled after an interrupted bulk response. Accepted changes are reflected; retry only items that remain.");
          return;
        }
      }
      throw error;
    }
    const changedItems = result.items || [];
    if (recordUndo) pushUndoEntry(undoLabel, changedItems, beforeStates, selectionBefore);
    if (result.summary) state.summary = result.summary;
    else refreshSummaryQuietly();
    const applyResult = applyChangedItems(changedItems, visibilityBefore, {
      preferredIndex: state.selectedIndex,
      preferredAssetId: selectionBefore.selectedAssetId,
      previousActive,
      previousSelection,
      previousSelectionAssetIds: selectionBefore.selectedAssetIds,
      preserveSelection,
      restoreSelection,
    });
    refreshUploadRailQuietly();
    if ((applyResult.visibilityChanged || applyResult.switchedToCulling) && state.hasWindow) {
      await loadWindow();
    }
    setStatus(completeMessage || `Saved ${Number(result.count || decisions.length).toLocaleString()} cloud decisions. Photos write-back is pending commit.`);
  };

  const undoLastDecision = async () => {
    if (!state.undoStack.length) {
      setStatus("Nothing to undo.");
      return;
    }
    const entry = state.undoStack.pop();
    const decisions = undoPayloadsForEntry(entry);
    if (!decisions.length) {
      setStatus("Nothing to undo.");
      return;
    }
    const remaining = state.undoStack.length;
    const remainingLabel = remaining ? `${remaining.toLocaleString()} undo step${remaining === 1 ? "" : "s"} remaining.` : "Undo stack is empty.";
    try {
      await postDecisions(
        decisions,
        `Undoing ${entry.label}...`,
        `Undid ${entry.label}. ${remainingLabel}`,
        {
          recordUndo: false,
          restoreSelection: entry.selection,
        },
      );
    } catch (error) {
      state.undoStack.push(entry);
      throw error;
    }
  };

  const approveSelectedItems = async () => {
    const indexes = selectedIndexes();
    if (!indexes.length) return;
    if (indexes.length === 1) {
      const { title, keywords } = rowMetadataValues(indexes[0]);
      await postDecision({ action: "approve", title, keywords });
      return;
    }
    const decisions = indexes.map((index) => ({
      assetId: itemId(state.items[index]),
      action: "approve",
      ...rowMetadataValues(index),
    }));
    await postDecisions(
      decisions,
      `Approving metadata on ${indexes.length.toLocaleString()} item${indexes.length === 1 ? "" : "s"}...`,
      `Approved metadata on ${indexes.length.toLocaleString()} item${indexes.length === 1 ? "" : "s"}. Photos write-back is pending commit.`,
      { undoLabel: "metadata approval", preserveSelection: true },
    );
  };

  const performBurstCull = async () => {
    if (!state.items.length) {
      setStatus("Load a current window before culling bursts.");
      return;
    }
    const plan = burstCullPlan();
    const rejectCount = plan.rejectIndexes.length;
    const groupCount = plan.burstGroups.length;
    if (!rejectCount) {
      setStatus("No rejectable burst extras found among the visible current-window photos.");
      return;
    }
    const pickedNote = plan.pickedSurvivorCount
      ? ` ${plan.pickedSurvivorCount.toLocaleString()} picked photo${plan.pickedSurvivorCount === 1 ? " was" : "s were"} kept automatically.`
      : "";
    const confirmed = window.confirm(
      `Cull bursts in the visible current window?\n\n`
      + `This will locally reject ${rejectCount.toLocaleString()} burst extra photo${rejectCount === 1 ? "" : "s"} from ${groupCount.toLocaleString()} burst group${groupCount === 1 ? "" : "s"}.${pickedNote}\n\n`
      + "Videos, picked, already rejected/hidden, tombstoned, and wide/panoramic photos are skipped. Rejected items remain recoverable until you empty the wastebasket.",
    );
    if (!confirmed) {
      setStatus("Burst cull canceled.");
      return;
    }
    const decisions = plan.rejectIndexes.map((index) => ({
      assetId: itemId(state.items[index]),
      action: "reject",
    }));
    await postDecisions(
      decisions,
      `Culling ${rejectCount.toLocaleString()} burst extra photo${rejectCount === 1 ? "" : "s"} locally...`,
      `Rejected ${rejectCount.toLocaleString()} burst extra photo${rejectCount === 1 ? "" : "s"} from ${groupCount.toLocaleString()} visible burst group${groupCount === 1 ? "" : "s"}. Photos write-back is pending commit.`,
      { undoLabel: "burst cull" },
    );
  };

  const librarySliceParams = (offset, limit) => {
    const params = new URLSearchParams();
    params.set("limit", String(Math.max(1, Math.min(1000, Number(limit || getLimit())))));
    params.set("offset", String(Math.max(0, Number(offset || 0))));
    const filters = state.filters || cloneDefaultFilters();
    (filters.ratings || []).forEach((value) => params.append("rating", value));
    (filters.colors || []).forEach((value) => params.append("color", value));
    (filters.mediaTypes || []).forEach((value) => params.append("mediaType", value));
    const pickStates = isReviewPage() ? ["picked"] : (filters.pickStates || []);
    pickStates.forEach((value) => params.append("pickState", value));
    if (state.searchQuery) params.set("q", state.searchQuery);
    return params;
  };

  const fetchPhotoKitLibrarySlice = async (offset, limit) => {
    const params = librarySliceParams(offset, limit);
    const response = await fetch(`/__sidecar/library?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load current window.");
    payload.source = payload.source || "apple-photos";
    return payload;
  };

  const fetchIndexedLibrarySlice = async (offset, limit) => {
    const params = librarySliceParams(offset, limit);
    const response = await fetch(`/__sidecar/index-window?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load local Photos index window.");
    if (payload.indexStatus) renderIndexStatus(payload.indexStatus);
    return payload;
  };

  const fetchLibrarySlice = async (offset, limit, { allowPhotoKitFallback = true } = {}) => {
    const payload = await fetchIndexedLibrarySlice(offset, limit);
    const indexedCount = Number(payload.indexedCount || payload.sidecarSummary?.indexedCount || 0);
    if (indexedCount || !allowPhotoKitFallback) return payload;
    setStatus("Local Photos index is empty; loading this window once from Apple Photos. Scheduled Photos sync will make future windows faster.");
    await waitForStatusPaint();
    return fetchPhotoKitLibrarySlice(offset, limit);
  };

  const loadWindow = async () => {
    state.filters = readFiltersFromControls();
    const limit = getLimit();
    const offset = getOffset();
    const selectionBeforeLoad = selectionSnapshot();
    setStatus("Loading matching items from local Photos index...");
    renderWindowLoading();
    await waitForStatusPaint();
    let payload = await fetchLibrarySlice(offset, limit);
    let effectiveOffset = offset;
    let filteredCount = Number(payload.filteredIndexedCount || payload.indexedCount || 0);
    const maxOffset = Math.max(0, filteredCount - limit);
    if (offset > maxOffset) {
      effectiveOffset = maxOffset;
      setOffset(effectiveOffset);
      payload = await fetchLibrarySlice(effectiveOffset, limit);
    }
    let windowItems = uniqueItemsById(payload.items);
    let nextSourceOffset = Number(payload.nextOffset || (effectiveOffset + windowItems.length));
    state.items = windowItems;
    state.summary = payload.sidecarSummary || state.summary;
    state.hasWindow = true;
    state.filteredIndexedCount = filteredCount;
    if ((selectionBeforeLoad.selectedAssetIds || []).length || selectionBeforeLoad.selectedIndex >= 0) {
      restoreSelectionSnapshot(selectionBeforeLoad);
    } else {
      setInitialSelection();
    }
    renderPageChrome();
    renderSurface();
    surface?.removeAttribute("aria-busy");
    const firstVisibleCount = visibleIndexes().length;
    if (firstVisibleCount < limit && nextSourceOffset < filteredCount) {
      setStatus(`Loaded ${firstVisibleCount.toLocaleString()} matching item${firstVisibleCount === 1 ? "" : "s"}; scanning the local index for more...`);
      await waitForStatusPaint();
    }
    let refillFetches = 1;
    while (
      visibleIndexes().length < limit
      && windowItems.length
      && nextSourceOffset < filteredCount
      && refillFetches < refillMaxFetches
    ) {
      const refillPayload = await fetchLibrarySlice(nextSourceOffset, refillBatchSize);
      const refillItems = uniqueItemsById(refillPayload.items);
      if (!refillItems.length) break;
      const previousItemCount = windowItems.length;
      const previousSourceOffset = nextSourceOffset;
      windowItems = uniqueItemsById([...windowItems, ...refillItems]);
      state.items = windowItems;
      payload = {
        ...payload,
        ...refillPayload,
        items: windowItems,
        sidecarSummary: refillPayload.sidecarSummary || payload.sidecarSummary,
      };
      filteredCount = Number(refillPayload.filteredIndexedCount || refillPayload.indexedCount || filteredCount);
      nextSourceOffset = Number(refillPayload.nextOffset || (nextSourceOffset + refillItems.length));
      refillFetches += 1;
      setStatus(`Loaded ${visibleIndexes().length.toLocaleString()} of ${limit.toLocaleString()} matching items; scanning the local index for more...`);
      if (windowItems.length === previousItemCount && nextSourceOffset <= previousSourceOffset) break;
    }
    state.summary = payload.sidecarSummary || state.summary;
    state.hasWindow = true;
    state.filteredIndexedCount = filteredCount;
    state.windowCursorOffset = nextSourceOffset;
    state.undoStack = [];
    if (applyPendingSelectionAfterLoad()) {
      // A decision made the previous card disappear; keep culling on its neighbor.
    } else if ((selectionBeforeLoad.selectedAssetIds || []).length || selectionBeforeLoad.selectedIndex >= 0) {
      restoreSelectionSnapshot(selectionBeforeLoad);
    } else {
      setInitialSelection();
    }
    renderPageChrome();
    renderSurface();
    surface?.removeAttribute("aria-busy");
    saveWindowState();
    let uploadRailPayload = null;
    let uploadRailError = null;
    if (isReviewPage() && visibleIndexes().length) {
      refreshUploadRailQuietly(0);
    } else if (isReviewPage()) {
      try {
        uploadRailPayload = await refreshUploadRail({ silent: true });
      } catch (error) {
        uploadRailError = error;
        renderUploadRailStatus(error.message || "Unknown error", true);
      }
    }
    const keepEmptyReviewForBridge = isReviewPage()
      && !visibleIndexes().length
      && bridgeQueuedCountFromPayload(uploadRailPayload || {}) > 0;
    if (!keepEmptyReviewForBridge && switchToCullingIfReviewEmpty()) {
      await waitForStatusPaint();
      return loadWindow();
    }
    const sourceLabel = payload.source === "sidecar-index" ? "local Photos index" : "Apple Photos fallback";
    const currentFilteredCount = Number(payload.filteredIndexedCount || payload.indexedCount || 0);
    const indexedNote = payload.source === "sidecar-index"
      ? ` Active ${state.searchQuery ? "filters/search match" : "filters match"} ${currentFilteredCount.toLocaleString()} item${currentFilteredCount === 1 ? "" : "s"}.`
      : " Refresh the local Photos index for faster future windows.";
    const visibleCount = visibleIndexes().length;
    const startLabel = visibleCount ? effectiveOffset + 1 : 0;
    const endLabel = effectiveOffset + visibleCount;
    const loadedMessage = `Showing matching item${visibleCount === 1 ? "" : "s"} ${startLabel.toLocaleString()}-${endLabel.toLocaleString()} from ${sourceLabel}. Showing ${visibleCount.toLocaleString()} of ${limit.toLocaleString()} visible preview${limit === 1 ? "" : "s"}.${indexedNote}`;
    setStatus(loadedMessage);
    if (uploadRailError && isReviewPage()) {
      setStatus(`${loadedMessage} Upload Bridge unavailable: ${uploadRailError.message || "unknown error"}`);
    }
    return payload;
  };

  const loadAndFillWindow = async () => {
    await loadWindow();
  };

  const slideWindow = async (direction) => {
    const currentOffset = getOffset();
    const limit = getLimit();
    const filteredCount = Math.max(0, Number(state.filteredIndexedCount || state.items.length || 0));
    const maxOffset = Math.max(0, filteredCount - limit);
    const nextOffset = direction >= 0
      ? Math.min(currentOffset + limit, maxOffset)
      : Math.max(0, currentOffset - limit);
    setStatus(`${direction >= 0 ? "Loading next" : "Loading previous"} ${limit.toLocaleString()} matching item${limit === 1 ? "" : "s"}...`);
    setOffset(nextOffset);
    await waitForStatusPaint();
    await loadWindow();
  };

  const loadSummary = async ({ silent = false } = {}) => {
    const response = await fetch("/__sidecar/summary");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar summary.");
    state.summary = payload;
    renderCounts();
    renderIndexStatus({ ...(state.indexStatus || {}), sidecarSummary: payload });
    if (!silent) setStatus(`${Number(payload.pendingSyncCount || 0).toLocaleString()} pending Photos write-back changes.`);
  };

  const runSummaryRefresh = async () => {
    if (summaryRefreshPromise) {
      summaryRefreshQueued = true;
      return summaryRefreshPromise;
    }
    summaryRefreshPromise = loadSummary({ silent: true })
      .catch((error) => {
        setStatus(`Summary refresh failed: ${error.message || "unknown error"}`);
      })
      .finally(() => {
        summaryRefreshPromise = null;
        if (summaryRefreshQueued) {
          summaryRefreshQueued = false;
          refreshSummaryQuietly();
        }
      });
    return summaryRefreshPromise;
  };

  const refreshSummaryQuietly = (delay = 400) => {
    if (summaryRefreshTimer) window.clearTimeout(summaryRefreshTimer);
    summaryRefreshTimer = window.setTimeout(() => {
      summaryRefreshTimer = null;
      runSummaryRefresh();
    }, delay);
  };

  const currentWindowUploadReadiness = () => {
    const totals = { picked: 0, approved: 0, needsReview: 0, visiblePicked: 0, visibleApproved: 0, visibleNeedsReview: 0 };
    state.items.forEach((item) => {
      if (!isVisibleBaseItem(item) || !isPickedItem(item)) return;
      const approved = item.sidecarState?.metadataState === "approved";
      totals.picked += 1;
      if (approved) totals.approved += 1;
      else totals.needsReview += 1;
      if (matchesReviewFilters(item)) {
        totals.visiblePicked += 1;
        if (approved) totals.visibleApproved += 1;
        else totals.visibleNeedsReview += 1;
      }
    });
    return totals;
  };

  const bridgeQueuedCountFromPayload = (payload = {}) => {
    const summary = payload.uploadBridgeSummary || payload.mockUploadSummary || {};
    return Number(summary.bridgeQueuedCount || summary.mockUploadedCount || payload.bridgeQueuedCount || payload.mockUploadedCount || 0);
  };

  const bridgeUploadableCountFromPayload = (payload = {}) => {
    const summary = payload.uploadBridgeSummary || payload.mockUploadSummary || {};
    const explicit = summary.uploadableItemCount ?? payload.uploadableItemCount;
    if (explicit !== undefined && explicit !== null) return Number(explicit || 0);
    return bridgeQueuedCountFromPayload(payload);
  };

  const uploadBridgeStatsFromPayload = (payload = {}) => {
    const result = payload?.bridgeResult || payload?.mockResult || null;
    const summary = payload?.uploadBridgeSummary || payload?.mockUploadSummary || {};
    const source = result || summary || payload || {};
    const queued = Number(source.bridgeQueuedCount || source.mockUploadedCount || payload.bridgeQueuedCount || payload.mockUploadedCount || 0);
    const uploadable = Number(source.uploadableItemCount ?? payload.uploadableItemCount ?? queued);
    const fullyCovered = Number(source.fullyCoveredItemCount || Math.max(0, queued - uploadable));
    const partiallyCovered = Number(source.partiallyCoveredItemCount || 0);
    const collisions = Number(source.collisionCount || payload.collisionCount || 0);
    const coveredKeys = Number(source.coveredKeyCount || payload.coveredKeyCount || 0);
    const missingKeys = Number(source.missingKeyCount || payload.missingKeyCount || 0);
    const blockedExports = Number(source.blockedExportFailureCount || payload.blockedExportFailureCount || 0);
    const blockedAttempts = Number(source.blockedExportAttemptCount || payload.blockedExportAttemptCount || 0);
    const metadataBlocked = Number(source.metadataBlockedQueuedCount || payload.metadataBlockedQueuedCount || payload.metadataBlockedCount || 0);
    const latestQueuedAt = source.latestQueuedAt || source.latestUploadedAt || "";
    return {
      queued,
      uploadable,
      fullyCovered,
      partiallyCovered,
      collisions,
      coveredKeys,
      missingKeys,
      blockedExports,
      blockedAttempts,
      metadataBlocked,
      latestQueuedAt,
    };
  };

  const uploadBridgeMetricStripMarkup = (metrics = []) => `
    <div class="sidecar-upload-bridge-metrics" aria-label="Upload Bridge counts">
      ${metrics.map((metric) => `
        <div class="sidecar-upload-bridge-metric${metric.tone ? ` is-${escapeHtml(metric.tone)}` : ""}">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
          ${metric.note ? `<small>${escapeHtml(metric.note)}</small>` : ""}
        </div>
      `).join("")}
    </div>
  `;

  const uploadBridgeProgressMarkup = () => {
    const progress = state.uploadBridgeRun;
    if (!progress) {
      return `
        <div class="sidecar-upload-bridge-progress is-idle">
          <strong>Real upload idle.</strong>
          <span>Private originals go to private R2; public previews go to public R2. Owner catalog registration is still separate.</span>
        </div>
      `;
    }
    const totals = progress.totals || {};
    const completed = Number(totals.completedCount || 0);
    const requested = Number(totals.requestedCount || progress.requestedCount || 0);
    const uploadedItems = Number(totals.uploadedItemCount || 0);
    const uploadedKeys = Number(totals.uploadedKeyCount || 0);
    const skipped = Number(totals.skippedCollisionCount || 0);
    const failedItems = Number(totals.failedItemCount || 0);
    const failedKeys = Number(totals.failedUploadCount || 0);
    const initialQueue = Number(progress.initialQueuedCount ?? progress.requestedCount ?? requested);
    const queueRemaining = Math.max(0, initialQueue - uploadedItems);
    const uploadingValue = progress.running
      ? `${Math.min(completed + 1, requested).toLocaleString()}/${requested.toLocaleString()}`
      : `${completed.toLocaleString()}/${requested.toLocaleString()}`;
    const entries = Array.isArray(progress.entries) ? progress.entries.slice(-12) : [];
    const lines = Array.isArray(progress.lines) ? progress.lines.slice(-12) : [];
    return `
      <div class="sidecar-upload-bridge-progress${progress.running ? " is-running" : ""}${progress.cancelRequested ? " is-canceling" : ""}${failedItems || failedKeys ? " has-warning" : ""}">
        ${uploadBridgeMetricStripMarkup([
          { label: "Queue", value: queueRemaining.toLocaleString(), note: "remaining" },
          { label: "Uploading", value: uploadingValue, note: progress.running ? "current run" : "complete" },
          { label: "Uploaded", value: uploadedItems.toLocaleString(), note: `${uploadedKeys.toLocaleString()} key${uploadedKeys === 1 ? "" : "s"}` },
          { label: "Collisions", value: skipped.toLocaleString(), note: "skipped keys", tone: skipped ? "warning" : "" },
        ])}
        <strong>${escapeHtml(progress.message || (progress.running ? "Real upload running..." : "Real upload finished."))}</strong>
        <span>${completed.toLocaleString()} of ${requested.toLocaleString()} item${requested === 1 ? "" : "s"} processed.</span>
        <span>${uploadedKeys.toLocaleString()} uploaded key${uploadedKeys === 1 ? "" : "s"} · ${skipped.toLocaleString()} skipped collision key${skipped === 1 ? "" : "s"} · ${failedItems.toLocaleString()} failed item${failedItems === 1 ? "" : "s"} · ${failedKeys.toLocaleString()} failed key${failedKeys === 1 ? "" : "s"}</span>
        ${entries.length ? `
          <ol class="sidecar-upload-progress-list">
            ${entries.map((entry) => `
              <li class="sidecar-upload-progress-item">
                ${entry.assetId ? `
                  <span class="sidecar-upload-progress-thumb">
                    <img data-sidecar-preview data-sidecar-preview-src="${escapeHtml(previewUrl({ localIdentifier: entry.assetId }))}" alt="" loading="lazy"/>
                    ${previewFallbackMarkup}
                  </span>
                ` : ""}
                <span>
                  <strong>${escapeHtml(entry.filename || entry.photoId || entry.assetId || "Upload Bridge item")}</strong>
                  <small>${escapeHtml(entry.detail || "")}</small>
                </span>
              </li>
            `).join("")}
          </ol>
        ` : lines.length ? `
          <ol class="sidecar-upload-progress-list is-text-only">
            ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ol>
        ` : ""}
      </div>
    `;
  };

  const updateUploadBridgeProgress = () => {
    const progressRoot = planOutput?.querySelector("[data-sidecar-upload-bridge-progress]");
    if (progressRoot) {
      progressRoot.innerHTML = uploadBridgeProgressMarkup();
      wirePreviewFallbacks(progressRoot);
    }
  };

  const uploadPlanSummaryMarkup = (payload, itemCount) => {
    const windowPlan = currentWindowUploadReadiness();
    const globalPicked = Number(payload.pickedCount ?? 0);
    const globalReady = Number(payload.approvedPickedCount ?? itemCount);
    const globalNeedsReview = Number(payload.pickedNeedsReviewCount ?? 0);
    const metadataBlocked = Number(payload.metadataBlockedCount || 0);
    const currentLine = windowPlan.picked
      ? `${windowPlan.picked.toLocaleString()} picked current-window item${windowPlan.picked === 1 ? "" : "s"}: ${windowPlan.approved.toLocaleString()} metadata-approved, ${windowPlan.needsReview.toLocaleString()} still need Review approval.`
      : "No picked items in the current window.";
    const visibleLine = windowPlan.visiblePicked && windowPlan.visiblePicked !== windowPlan.picked
      ? `<p>${windowPlan.visiblePicked.toLocaleString()} picked item${windowPlan.visiblePicked === 1 ? "" : "s"} match the current Review filters.</p>`
      : "";
    const globalLine = globalPicked
      ? `<p>${globalPicked.toLocaleString()} picked item${globalPicked === 1 ? "" : "s"} indexed globally: ${globalReady.toLocaleString()} approved but not yet queued, ${globalNeedsReview.toLocaleString()} still need Review approval.</p>`
      : "";
    const metadataBlockedLine = metadataBlocked
      ? `<p><strong>${metadataBlocked.toLocaleString()} approved picked item${metadataBlocked === 1 ? "" : "s"} blocked from Upload Bridge</strong> until they have a clear gallery/country signal and non-generic title.</p>`
      : "";
    return `
      <p>${escapeHtml(currentLine)}</p>
      ${visibleLine}
      ${globalLine}
      ${metadataBlockedLine}
    `;
  };

  const uploadBridgeSummaryMarkup = (payload) => {
    const result = payload?.bridgeResult || payload?.mockResult;
    const summary = payload?.uploadBridgeSummary || payload?.mockUploadSummary;
    if (!result && !summary) return "";
    const stats = uploadBridgeStatsFromPayload(payload);
    const queued = stats.queued;
    if (!queued) return "";
    const { uploadable, fullyCovered, partiallyCovered, collisions, coveredKeys, missingKeys, blockedExports, blockedAttempts, metadataBlocked } = stats;
    const remaining = result ? Number(payload.count || 0) : null;
    const latestQueuedAt = stats.latestQueuedAt || "";
    const latestRun = latestQueuedAt ? ` Latest queue run: ${escapeHtml(latestQueuedAt)}.` : "";
    const lead = result
      ? `Queued ${queued.toLocaleString()} item${queued === 1 ? "" : "s"} across the Upload Bridge; ${remaining.toLocaleString()} remain.`
      : `${queued.toLocaleString()} item${queued === 1 ? "" : "s"} queued across the Upload Bridge; ${uploadable.toLocaleString()} still need R2 upload; ${fullyCovered.toLocaleString()} already fully uploaded or covered.${latestRun}`;
    const warning = collisions
      ? `<strong>${collisions.toLocaleString()} bridged item${collisions === 1 ? "" : "s"} collide with existing R2 coverage.</strong>`
      : "<strong>No existing R2 collisions found for bridged items.</strong>";
    return `
      <div class="sidecar-upload-bridge-result${collisions ? " has-warning" : ""}">
        ${uploadBridgeMetricStripMarkup([
          { label: "Queue", value: uploadable.toLocaleString(), note: "need upload" },
          { label: "Uploading", value: state.uploadBridgeUploading ? "live" : "0", note: state.uploadBridgeUploading ? "running" : "idle" },
          { label: "Uploaded", value: fullyCovered.toLocaleString(), note: "covered items" },
          { label: "Collisions", value: collisions.toLocaleString(), note: "items", tone: collisions ? "warning" : "" },
          { label: "Blocked", value: blockedExports.toLocaleString(), note: "export failures", tone: blockedExports ? "warning" : "" },
          { label: "Metadata", value: metadataBlocked.toLocaleString(), note: "blocked", tone: metadataBlocked ? "warning" : "" },
        ])}
        <span>${lead}</span>
        <span>${warning}</span>
        ${partiallyCovered ? `<span>${partiallyCovered.toLocaleString()} item${partiallyCovered === 1 ? "" : "s"} are partially uploaded and will resume missing keys.</span>` : ""}
        ${blockedExports ? `<span>${blockedExports.toLocaleString()} item${blockedExports === 1 ? "" : "s"} are blocked after Apple Photos export failure${blockedAttempts ? ` across ${blockedAttempts.toLocaleString()} attempt${blockedAttempts === 1 ? "" : "s"}` : ""}.</span>` : ""}
        ${metadataBlocked ? `<span>${metadataBlocked.toLocaleString()} queued item${metadataBlocked === 1 ? "" : "s"} are blocked from real upload because approved metadata lacks a safe public gallery signal.</span>` : ""}
        ${coveredKeys ? `<span>${coveredKeys.toLocaleString()} planned key${coveredKeys === 1 ? "" : "s"} already exist in Owner R2/bridge ledger state.</span>` : ""}
        ${missingKeys ? `<span>${missingKeys.toLocaleString()} planned key${missingKeys === 1 ? "" : "s"} still missing from R2/bridge ledger coverage.</span>` : ""}
      </div>
    `;
  };

  const renderPlan = (title, eyebrow, payload, kind = "") => {
    if (!planPanel || !planOutput) return;
    planPanel.hidden = false;
    planPanel.classList.toggle("is-upload-plan", kind === "upload");
    planPanel.dataset.sidecarPlanKind = kind || "";
    document.body.classList.add("sidecar-has-plan");
    if (planTitle) planTitle.textContent = title;
    if (planEyebrow) planEyebrow.textContent = eyebrow;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const assetIds = items.map((item) => item.assetId).filter(Boolean);
    const message = payload.message ? `<p>${escapeHtml(payload.message)}</p>` : "";
    const uploadSummary = kind === "upload" ? uploadPlanSummaryMarkup(payload, items.length) : "";
    const emptyMessage = kind === "upload" ? "No rows are ready for Upload Bridge yet." : "No rows.";
    if (kind === "upload") {
      const planStats = uploadBridgeStatsFromPayload(payload);
      state.uploadBridgePlanStats = planStats;
      const uploadableCount = bridgeUploadableCountFromPayload(payload);
      const uploadMax = Math.max(1, Math.min(uploadBridgeMaxItems, uploadableCount || uploadBridgeMaxItems));
      const uploadValue = Math.max(1, Math.min(uploadMax, Number(state.uploadBridgeRequestedCount || 1)));
      const uploadDisabled = state.uploadBridgeUploading || uploadableCount <= 0;
      if (planTitle) planTitle.textContent = `Upload Bridge${items.length ? ` (${items.length.toLocaleString()})` : ""}`;
      planOutput.innerHTML = `
        <div class="sidecar-plan-actions">
          <button class="btn secondary" type="button" data-sidecar-upload-bridge-action ${assetIds.length ? "" : "disabled"}>Queue ready items</button>
        </div>
        <div class="sidecar-real-upload-controls">
          <label>
            <span>Items to upload</span>
            <input type="number" min="1" max="${uploadMax}" step="1" value="${uploadValue}" data-sidecar-real-upload-count ${uploadDisabled ? "disabled" : ""}/>
          </label>
          <div class="sidecar-real-upload-buttons">
            <button class="btn secondary sidecar-real-upload-action" type="button" data-sidecar-real-upload ${uploadDisabled ? "disabled" : ""}>Real upload</button>
            <button class="btn secondary sidecar-stop-upload-action" type="button" data-sidecar-real-upload-cancel ${state.uploadBridgeUploading ? "" : "disabled"}>${state.uploadBridgeCancelRequested ? "Stopping..." : "Stop upload"}</button>
          </div>
        </div>
        <div data-sidecar-upload-bridge-progress>
          ${uploadBridgeProgressMarkup()}
        </div>
        ${uploadSummary}
        ${uploadBridgeSummaryMarkup(payload)}
        <div class="sidecar-plan-list sidecar-upload-plan-list">
          ${items.slice(0, 80).map((item) => `
            <div class="sidecar-upload-plan-tile" title="${escapeHtml(item.filename || item.assetId || "")}" aria-label="${escapeHtml(item.filename || item.assetId || "Upload-ready item")}">
              <img data-sidecar-preview data-sidecar-preview-src="${escapeHtml(previewUrl({ localIdentifier: item.assetId }))}" alt="" loading="lazy"/>
              ${previewFallbackMarkup}
            </div>
          `).join("") || `<p>${escapeHtml(emptyMessage)}</p>`}
        </div>
      `;
      wirePreviewFallbacks(planPanel);
      planOutput.querySelector("[data-sidecar-upload-bridge-action]")?.addEventListener("click", () => {
        queueUploadBridge(assetIds).catch((error) => setStatus(error.message));
      });
      planOutput.querySelector("[data-sidecar-real-upload]")?.addEventListener("click", (event) => {
        executeUploadBridge(event.currentTarget).catch((error) => setStatus(error.message));
      });
      planOutput.querySelector("[data-sidecar-real-upload-cancel]")?.addEventListener("click", (event) => {
        cancelUploadBridge(event.currentTarget).catch((error) => setStatus(error.message));
      });
      return;
    }
    planOutput.innerHTML = `
      <p><strong>${items.length.toLocaleString()}</strong> row${items.length === 1 ? "" : "s"}.</p>
      ${message}
      ${uploadSummary}
      <div class="sidecar-plan-list">
        ${items.slice(0, 80).map((item) => `
          <div class="sidecar-plan-row">
            <strong>${escapeHtml(item.filename || item.assetId || item.syncId || "")}</strong>
            <small>${escapeHtml(item.fieldFamily || item.eligibleReason || "")}</small>
            <small>${escapeHtml(item.capturedAt || item.createdAt || "")}</small>
          </div>
        `).join("") || `<p>${escapeHtml(emptyMessage)}</p>`}
      </div>
    `;
  };

  const renderUploadRailStatus = (message = "Checking approved picked rows and upload readiness...", failed = false) => {
    if (!planPanel || !planOutput || !isReviewPage()) return;
    planPanel.hidden = false;
    planPanel.classList.add("is-upload-plan");
    planPanel.dataset.sidecarPlanKind = "upload";
    document.body.classList.add("sidecar-has-plan");
    if (planTitle) planTitle.textContent = failed ? "Upload Bridge unavailable" : "Upload Bridge";
    if (planEyebrow) planEyebrow.textContent = "Review rail";
    planOutput.innerHTML = `
      <div class="sidecar-upload-bridge-progress ${failed ? "has-warning" : "is-running"}" role="${failed ? "alert" : "status"}">
        <strong>${failed ? "Could not refresh the Review rail." : "Loading Review rail..."}</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
  };

  const loadPlan = async (kind, { silent = false } = {}) => {
    if (kind === "upload" && !isReviewPage()) {
      if (planPanel?.dataset.sidecarPlanKind === "upload") hidePlanPanel();
      if (!silent) setStatus("Upload Bridge is available from Review.");
      return null;
    }
    if (kind === "upload") renderUploadRailStatus();
    const endpoint = kind === "upload" ? "/__sidecar/upload-plan" : "/__sidecar/commit-plan";
    const response = await fetch(endpoint);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar plan.");
    renderPlan(kind === "upload" ? "Next Upload Bridge Eligibility" : "Pending Photos Write-Back", kind === "upload" ? "Upload Bridge" : "Commit plan", payload, kind);
    if (kind === "upload") {
      const readiness = currentWindowUploadReadiness();
      const statusSuffix = Number(payload.count || 0)
        ? `${Number(payload.count || 0).toLocaleString()} ready row${Number(payload.count || 0) === 1 ? "" : "s"}.`
        : `${readiness.needsReview.toLocaleString()} picked current-window item${readiness.needsReview === 1 ? "" : "s"} still need Review approval.`;
      if (!silent) setStatus(`Upload Bridge refreshed: ${statusSuffix}`);
    } else if (!silent) {
      setStatus("Photos commit plan refreshed.");
    }
    return payload;
  };

  const refreshUploadRail = async (options = {}) => {
    return loadPlan("upload", options);
  };

  const runUploadRailRefresh = async () => {
    if (!isReviewPage()) return null;
    if (uploadRailRefreshPromise) {
      uploadRailRefreshQueued = true;
      return uploadRailRefreshPromise;
    }
    uploadRailRefreshPromise = refreshUploadRail({ silent: true })
      .catch((error) => {
        renderUploadRailStatus(error.message || "Unknown error", true);
        setStatus(`Upload Bridge refresh failed: ${error.message || "unknown error"}`);
        return null;
      })
      .finally(() => {
        uploadRailRefreshPromise = null;
        if (uploadRailRefreshQueued) {
          uploadRailRefreshQueued = false;
          refreshUploadRailQuietly();
        }
      });
    return uploadRailRefreshPromise;
  };

  const refreshUploadRailQuietly = (delay = 650) => {
    if (!isReviewPage()) return;
    if (uploadRailRefreshTimer) window.clearTimeout(uploadRailRefreshTimer);
    uploadRailRefreshTimer = window.setTimeout(() => {
      uploadRailRefreshTimer = null;
      runUploadRailRefresh();
    }, delay);
  };

  const queueUploadBridge = async (assetIds) => {
    const cleanIds = Array.isArray(assetIds) ? assetIds.filter(Boolean) : [];
    if (!cleanIds.length) {
      setStatus("No upload-ready rows to queue across the bridge.");
      return;
    }
    setStatus(`Upload Bridge checking ${cleanIds.length.toLocaleString()} row${cleanIds.length === 1 ? "" : "s"} against Owner R2 state...`);
    const response = await fetch("/__sidecar/upload-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: cleanIds, limit: Math.max(500, cleanIds.length) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not queue Upload Bridge rows.");
    const remainingPlan = payload.remainingPlan || { ok: true, count: 0, items: [] };
    remainingPlan.mockResult = payload;
    renderPlan("Next Upload Bridge Eligibility", "Upload Bridge", remainingPlan, "upload");
    const hiddenCurrentWindowCount = applyBridgeQueuedItems(payload.items || []);
    const collisions = Number(payload.collisionCount || 0);
    const coveredKeys = Number(payload.coveredKeyCount || 0);
    const warning = collisions
      ? ` ${collisions.toLocaleString()} item${collisions === 1 ? "" : "s"} had current R2 key coverage across ${coveredKeys.toLocaleString()} key${coveredKeys === 1 ? "" : "s"}.`
      : " No current R2 key collisions found.";
    const hiddenWindow = hiddenCurrentWindowCount
      ? ` ${hiddenCurrentWindowCount.toLocaleString()} current-window item${hiddenCurrentWindowCount === 1 ? "" : "s"} hidden from Culling/Review.`
      : "";
    if (hiddenCurrentWindowCount && state.hasWindow) {
      await loadWindow();
    }
    const queued = Number(payload.bridgeQueuedCount || payload.mockUploadedCount || 0);
    setStatus(`Upload Bridge queued ${queued.toLocaleString()} row${queued === 1 ? "" : "s"} and removed them from active Culling/Review.${hiddenWindow}${warning}`);
  };

  const readUploadBridgeEvent = (event) => {
    if (!state.uploadBridgeRun) {
      const planStats = state.uploadBridgePlanStats || {};
      state.uploadBridgeRun = {
        running: true,
        requestedCount: Number(event.count || 1),
        uploadId: event.uploadId || "",
        cancelRequested: false,
        initialQueuedCount: Number(planStats.uploadable || event.count || 1),
        initialCollisionCount: Number(planStats.collisions || 0),
        totals: { requestedCount: Number(event.count || 1), uploadedItemCount: 0, failedItemCount: 0 },
        lines: [],
        entries: [],
        message: "",
      };
    }
    const progress = state.uploadBridgeRun;
    if (event.event === "start") {
      progress.running = true;
      progress.uploadId = event.uploadId || progress.uploadId || "";
      progress.requestedCount = Number(event.count || progress.requestedCount || 1);
      if (!progress.initialQueuedCount) {
        const planStats = state.uploadBridgePlanStats || {};
        progress.initialQueuedCount = Number(planStats.uploadable || progress.requestedCount || 1);
      }
      progress.totals = { requestedCount: progress.requestedCount, uploadedItemCount: 0, failedItemCount: 0 };
      progress.lines = [];
      progress.entries = [];
      progress.message = event.message || "Real upload starting...";
    } else if (event.event === "planning") {
      progress.running = true;
      progress.message = event.message || "Planning Upload Bridge batch...";
      progress.lines = [...(progress.lines || []), progress.message].slice(-12);
    } else if (event.event === "planned") {
      const summary = event.summary || {};
      const plannedCount = Number(event.count || summary.selectedCount || progress.requestedCount || 1);
      const planningSeconds = Number(summary.planningSeconds || 0);
      progress.running = plannedCount > 0;
      progress.requestedCount = plannedCount || progress.requestedCount;
      progress.totals = { ...(progress.totals || {}), requestedCount: progress.requestedCount };
      progress.message = event.message || `Planned ${plannedCount.toLocaleString()} Upload Bridge item${plannedCount === 1 ? "" : "s"}.`;
      progress.lines = [
        ...(progress.lines || []),
        planningSeconds
          ? `${progress.message} Planning took ${planningSeconds.toFixed(1)}s.`
          : progress.message,
      ].slice(-12);
    } else if (event.event === "item-start") {
      progress.running = true;
      progress.message = event.message || `Uploading item ${event.index || ""}...`;
    } else if (event.event === "item-complete") {
      progress.totals = event.totals || progress.totals || {};
      const item = event.item || {};
      const summary = event.summary || {};
      const uploaded = Number(summary.uploadedKeyCount || 0);
      const skipped = Number(summary.skippedCollisionCount || 0);
      const failedItems = Number(summary.failedCount || 0);
      const failedKeys = Number(summary.failedUploadCount || 0);
      const name = item.filename || item.photoId || item.assetId || "Upload Bridge item";
      const timings = item.timings || {};
      const timingDetail = Number(timings.totalSeconds || 0)
        ? ` · ${Number(timings.totalSeconds).toFixed(1)}s`
        : "";
      const detail = `${event.status || item.status || "done"} (${uploaded} uploaded, ${skipped} skipped, ${failedItems || failedKeys} failed)${timingDetail}`;
      progress.entries = [
        ...(progress.entries || []),
        {
          assetId: item.assetId || "",
          photoId: item.photoId || "",
          filename: name,
          detail,
        },
      ].slice(-12);
      progress.lines = [...(progress.lines || []), `${name}: ${detail}`].slice(-12);
      progress.message = failedItems || failedKeys
        ? `Real upload skipped failed item ${name}.`
        : `Real upload processed ${name}.`;
    } else if (event.event === "cancelled") {
      progress.running = false;
      progress.cancelRequested = true;
      progress.totals = event.totals || progress.totals || {};
      progress.lines = [...(progress.lines || []), event.message || "Upload Bridge interrupted."].slice(-12);
      progress.message = event.message || "Upload Bridge interrupted.";
    } else if (event.event === "error") {
      progress.running = false;
      progress.totals = event.totals || progress.totals || {};
      progress.lines = [...(progress.lines || []), `Error: ${event.error || "Upload failed"}`].slice(-12);
      progress.entries = [
        ...(progress.entries || []),
        {
          filename: "Upload error",
          detail: event.error || "Upload failed",
        },
      ].slice(-12);
      progress.message = event.error || "Real upload failed.";
    } else if (event.event === "done") {
      progress.running = false;
      progress.cancelRequested = Boolean(event.cancelled);
      progress.totals = event.totals || progress.totals || {};
      progress.message = event.message || "Real upload finished.";
    }
    setStatus(progress.message || "Upload Bridge real upload updated.");
    updateUploadBridgeProgress();
  };

  const streamUploadBridgeEvents = async (response) => {
    if (!response.body || typeof response.body.getReader !== "function") {
      const text = await response.text();
      text.split(/\r?\n/).filter(Boolean).forEach((line) => readUploadBridgeEvent(JSON.parse(line)));
      return null;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalEvent = null;
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          readUploadBridgeEvent(event);
          if (event.event === "done") finalEvent = event;
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      readUploadBridgeEvent(event);
      if (event.event === "done") finalEvent = event;
    }
    return finalEvent;
  };

  const executeUploadBridge = async (control) => {
    if (state.uploadBridgeUploading) return;
    const countInput = planOutput?.querySelector("[data-sidecar-real-upload-count]");
    const requestedCount = Math.max(1, Math.min(uploadBridgeMaxItems, Number(countInput?.value || 1)));
    state.uploadBridgeRequestedCount = requestedCount;
    if (countInput) countInput.value = String(requestedCount);
    const planStats = state.uploadBridgePlanStats || {};
    state.uploadBridgeUploading = true;
    state.uploadBridgeCancelRequested = false;
    const uploadId = (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    state.uploadBridgeRun = {
      running: true,
      uploadId,
      cancelRequested: false,
      requestedCount,
      initialQueuedCount: Number(planStats.uploadable || requestedCount),
      initialCollisionCount: Number(planStats.collisions || 0),
      totals: { requestedCount, uploadedItemCount: 0, failedItemCount: 0 },
      lines: [],
      entries: [],
      message: `Starting real upload for ${requestedCount.toLocaleString()} item${requestedCount === 1 ? "" : "s"}...`,
    };
    if (control) {
      control.disabled = true;
      control.classList.add("is-busy");
      control.setAttribute("aria-busy", "true");
    }
    const cancelControl = planOutput?.querySelector("[data-sidecar-real-upload-cancel]");
    if (cancelControl) {
      cancelControl.disabled = false;
      cancelControl.textContent = "Stop upload";
      cancelControl.removeAttribute("aria-busy");
    }
    if (countInput) countInput.disabled = true;
    updateUploadBridgeProgress();
    setStatus(state.uploadBridgeRun.message);
    await waitForStatusPaint();
    try {
      const response = await fetch("/__sidecar/upload-bridge-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: requestedCount, uploadId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Could not start Upload Bridge real upload.");
      }
      const finalEvent = await streamUploadBridgeEvents(response);
      const finalPlan = finalEvent?.uploadPlan;
      state.uploadBridgeUploading = false;
      state.uploadBridgeCancelRequested = false;
      if (state.uploadBridgeRun) state.uploadBridgeRun.running = false;
      if (finalPlan?.ok) renderPlan("Upload Bridge", "Upload Bridge", finalPlan, "upload");
      else await refreshUploadRail({ silent: true });
      const totals = finalEvent?.totals || state.uploadBridgeRun?.totals || {};
      const finishedLabel = finalEvent?.cancelled ? "Real upload interrupted" : "Real upload complete";
      setStatus(`${finishedLabel}: ${Number(totals.completedCount || 0).toLocaleString()} processed item${Number(totals.completedCount || 0) === 1 ? "" : "s"}, ${Number(totals.uploadedItemCount || 0).toLocaleString()} uploaded item${Number(totals.uploadedItemCount || 0) === 1 ? "" : "s"}, ${Number(totals.uploadedKeyCount || 0).toLocaleString()} uploaded key${Number(totals.uploadedKeyCount || 0) === 1 ? "" : "s"}, ${Number(totals.failedItemCount || 0).toLocaleString()} failed item${Number(totals.failedItemCount || 0) === 1 ? "" : "s"}.`);
    } finally {
      state.uploadBridgeUploading = false;
      state.uploadBridgeCancelRequested = false;
      if (state.uploadBridgeRun) state.uploadBridgeRun.running = false;
      if (control?.isConnected) {
        control.disabled = false;
        control.classList.remove("is-busy");
        control.removeAttribute("aria-busy");
      }
      if (countInput?.isConnected) countInput.disabled = false;
      if (cancelControl?.isConnected) {
        cancelControl.disabled = true;
        cancelControl.textContent = "Stop upload";
        cancelControl.classList.remove("is-busy");
        cancelControl.removeAttribute("aria-busy");
      }
      updateUploadBridgeProgress();
    }
  };

  const cancelUploadBridge = async (control) => {
    const uploadId = state.uploadBridgeRun?.uploadId || "";
    if (!state.uploadBridgeUploading || !uploadId || state.uploadBridgeCancelRequested) return;
    state.uploadBridgeCancelRequested = true;
    if (state.uploadBridgeRun) {
      state.uploadBridgeRun.cancelRequested = true;
      state.uploadBridgeRun.message = "Interrupt requested. The current item will finish, then the upload will stop.";
    }
    if (control) {
      control.disabled = true;
      control.classList.add("is-busy");
      control.setAttribute("aria-busy", "true");
      control.textContent = "Stopping...";
    }
    updateUploadBridgeProgress();
    setStatus(state.uploadBridgeRun?.message || "Interrupt requested.");
    try {
      const response = await fetch("/__sidecar/upload-bridge-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not interrupt Upload Bridge.");
      setStatus(payload.message || "Upload Bridge interrupt requested.");
    } catch (error) {
      state.uploadBridgeCancelRequested = false;
      if (state.uploadBridgeRun) state.uploadBridgeRun.cancelRequested = false;
      if (control?.isConnected) {
        control.disabled = false;
        control.classList.remove("is-busy");
        control.removeAttribute("aria-busy");
        control.textContent = "Stop upload";
      }
      updateUploadBridgeProgress();
      throw error;
    }
  };

  const setPage = async (page) => {
    state.page = normalizePage(page);
    setOffset(0);
    state.windowCursorOffset = 0;
    state.windowBackStack = [];
    state.windowForwardStack = [];
    syncPageUrl();
    renderPageChrome();
    renderSurface();
    saveWindowState();
    await loadWindow();
  };

  const emptyWastebasket = async () => {
    if (!window.confirm("Tombstone all rejected or hidden Sidecar items in the indexed wastebasket?")) return;
    setStatus("Emptying Sidecar wastebasket...");
    const response = await fetch("/__sidecar/empty-wastebasket", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not empty wastebasket.");
    (payload.items || []).forEach((item) => {
      mergeChangedItem(item.assetId, item.state || {}, item.changedFamilies?.length || 1);
    });
    state.summary = payload.summary || state.summary;
    reconcileSelection(state.selectedIndex);
    renderSurface();
    syncQuickLookToSelection();
    refreshUploadRailQuietly();
    setStatus(`Tombstoned ${Number(payload.count || 0).toLocaleString()} discarded item${Number(payload.count || 0) === 1 ? "" : "s"}. Photos write-back is pending commit.`);
  };

  const claimShortcut = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleShortcut = async (event) => {
    const tag = String(event.target?.tagName || "").toLowerCase();
    const isTextEntry = tag === "input" || tag === "textarea" || tag === "select";
    const key = event.key;
    if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && (key === "z" || key === "Z")) {
      if (isTextEntry) return;
      claimShortcut(event);
      try {
        await undoLastDecision();
      } catch (error) {
        setStatus(error.message || "Could not undo the last Sidecar decision.");
      }
      return;
    }
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextEntry) return;
    try {
      if (key === " " || key === "Spacebar") {
        claimShortcut(event);
        if (state.quickLookIndex >= 0) closeQuickLook();
        else openQuickLook();
      } else if (key === "c" || key === "C") {
        claimShortcut(event);
        await setPage(isReviewPage() ? "culling" : "review");
      } else if (key === "Escape" && state.quickLookIndex >= 0) {
        claimShortcut(event);
        closeQuickLook();
      } else if (/^[1-5]$/.test(key)) {
        claimShortcut(event);
        await postDecision({ action: "rating", rating: Number(key) });
      } else if (key === "0") {
        claimShortcut(event);
        await postDecision({ action: "rating", rating: 0 });
      } else if (colorShortcuts[key]) {
        claimShortcut(event);
        await postDecision(colorDecisionPayload(colorShortcuts[key]), { advance: false });
      } else if (key === "p" || key === "P") {
        claimShortcut(event);
        await postDecision({ action: "pick" });
      } else if (key === "a" || key === "A") {
        claimShortcut(event);
        await approveSelectedItems();
      } else if (key === "x" || key === "X") {
        claimShortcut(event);
        await postDecision({ action: "reject" });
      } else if (key === "h" || key === "H") {
        claimShortcut(event);
        await postDecision({ action: "hide" });
      } else if (key === "u" || key === "U") {
        claimShortcut(event);
        await postDecision({ action: "unpick" });
      } else if (key === "ArrowRight" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowUp") {
        claimShortcut(event);
        stepVisibleSelection(key, { extend: event.shiftKey });
      }
    } catch (error) {
      setStatus(error.message || "Sidecar shortcut failed.");
    }
  };

  const stageRowMetadata = async (index, metadataState = "proposed") => {
    const form = rowFormForIndex(index);
    if (!form) return;
    await postDecision(metadataPayloadForIndex(index, metadataState), { advance: false, indexes: [index] });
  };

  const stageRowRework = async (index, overrides = {}) => {
    const form = rowFormForIndex(index);
    if (!form) return;
    const payload = reworkPayloadForIndex(index, overrides);
    if (!payload.reworkCategory && !payload.reworkComment) {
      payload.reworkComment = defaultAiReviewNote;
      const note = form.querySelector("[data-sidecar-rework-comment]");
      if (note && !String(note.value || "").trim()) note.value = defaultAiReviewNote;
    }
    await postDecision(payload, { advance: false, indexes: [index] });
  };

  const runForegroundAiReview = async () => {
    if (!isReviewPage()) return;
    const indexes = visibleIndexes();
    const assetIds = indexes.map((index) => itemId(state.items[index])).filter(Boolean);
    if (!assetIds.length) {
      setStatus("No visible picked Review rows are available for an AI title pass.");
      return;
    }
    state.aiReviewRunning = true;
    setStatus(`Running AI title pass for ${assetIds.length.toLocaleString()} visible picked Review row${assetIds.length === 1 ? "" : "s"}...`);
    renderSurface();
    await waitForStatusPaint();
    try {
      const response = await fetch("/__sidecar/ai-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetIds,
          limit: assetIds.length,
          maxRung: "filename-gps",
          includeSummary: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not run the AI title pass.");
      state.aiReviewResult = payload;
      if (payload.summary) state.summary = payload.summary;
      else refreshSummaryQuietly();
      await loadWindow();
      const proposed = Number(payload.proposedCount || 0);
      const skipped = Number(payload.skippedCount || 0);
      setStatus(`AI title pass complete: ${proposed.toLocaleString()} proposal${proposed === 1 ? "" : "s"}, ${skipped.toLocaleString()} skipped.`);
    } finally {
      state.aiReviewRunning = false;
      renderSurface();
    }
  };

  const propagateReviewField = async (index, field) => {
    if (field !== "title" && field !== "keywords") return;
    const targets = sameShootReviewIndexes(index);
    if (!targets.length) {
      setStatus("No current-window picked rows are available for this propagation.");
      return;
    }
    const sourceValues = rowMetadataValues(index);
    const value = field === "title" ? sourceValues.title : sourceValues.keywords.join(", ");
    targets.forEach((targetIndex) => setRowFieldValue(targetIndex, field, value));
    const decisions = targets.map((targetIndex) => metadataDecisionForIndex(targetIndex, "approved"));
    await postDecisions(
      decisions,
      `Propagating ${field} through this two-hour shoot window...`,
      `Propagated ${field} to ${targets.length.toLocaleString()} picked row${targets.length === 1 ? "" : "s"} and approved their metadata locally.`,
      { undoLabel: `propagate ${field}` },
    );
  };

  const propagateReviewDecision = async (index) => {
    const item = state.items[index];
    const sidecar = item?.sidecarState || {};
    const targets = sameShootReviewIndexes(index);
    if (!targets.length) {
      setStatus("No current-window picked rows are available for this propagation.");
      return;
    }
    const sourceValues = rowMetadataValues(index);
    let decisions = [];
    let label = "";
    if (sidecar.pickState === "rejected") {
      decisions = targets.map((targetIndex) => ({ assetId: itemId(state.items[targetIndex]), action: "reject" }));
      label = "reject decision";
    } else if (sourceValues.reworkCategory || sourceValues.reworkComment || sidecar.metadataState === "rework") {
      const reworkCategory = sourceValues.reworkCategory || sidecar.reworkCategory || "";
      const reworkComment = sourceValues.reworkComment || sidecar.reworkComment || "";
      decisions = targets.map((targetIndex) => reworkDecisionForIndex(targetIndex, { reworkCategory, reworkComment }));
      label = reworkCategoryLabel(reworkCategory) ? `AI rework (${reworkCategoryLabel(reworkCategory)})` : "AI rework";
    } else if (sidecar.metadataState === "approved") {
      decisions = targets.map((targetIndex) => metadataDecisionForIndex(targetIndex, "approved"));
      label = "metadata approval";
    }
    if (!decisions.length) {
      setStatus("Approve the row or choose an AI rework category before propagating.");
      return;
    }
    await postDecisions(
      decisions,
      `Propagating ${label} through this two-hour shoot window...`,
      `Propagated ${label} to ${targets.length.toLocaleString()} picked row${targets.length === 1 ? "" : "s"}. Photos write-back is pending commit.`,
      { undoLabel: `propagate ${label}` },
    );
  };

  surface?.addEventListener("click", async (event) => {
    const windowSlideButton = event.target.closest("[data-sidecar-window-slide]");
    if (windowSlideButton) {
      event.preventDefault();
      try {
        await slideWindow(Number(windowSlideButton.dataset.sidecarWindowSlide || 1));
      } catch (error) {
        setStatus(error.message || "Could not load that Sidecar window.");
      }
      return;
    }
    const inlineVideoButton = event.target.closest("[data-sidecar-video-inline]");
    if (inlineVideoButton) {
      event.preventDefault();
      const index = Number(inlineVideoButton.dataset.sidecarIndex || -1);
      const item = state.items[index];
      if (item) {
        selectIndex(index, { scroll: false });
        playVideoInPlace(inlineVideoButton.closest("[data-sidecar-video-shell]"), item);
      }
      return;
    }
    const aiReviewButton = event.target.closest("[data-sidecar-ai-propose-current]");
    if (aiReviewButton) {
      event.preventDefault();
      try {
        await withBusyControl(aiReviewButton, "Running...", () => runForegroundAiReview());
      } catch (error) {
        setStatus(error.message || "Could not run the AI title pass.");
        state.aiReviewRunning = false;
        renderSurface();
      }
      return;
    }
    const fieldPropagate = event.target.closest("[data-sidecar-propagate-field]");
    if (fieldPropagate) {
      event.preventDefault();
      try {
        await withBusyControl(fieldPropagate, "...", () => (
          propagateReviewField(Number(fieldPropagate.dataset.sidecarIndex || -1), fieldPropagate.dataset.sidecarPropagateField || "")
        ));
      } catch (error) {
        setStatus(error.message || "Could not propagate the Review field.");
      }
      return;
    }
    const rowSubmit = event.target.closest("[data-sidecar-row-submit]");
    if (rowSubmit) {
      try {
        await withBusyControl(rowSubmit, "Staging...", () => stageRowMetadata(Number(rowSubmit.dataset.sidecarIndex || -1)));
      } catch (error) {
        setStatus(error.message || "Could not stage row metadata.");
      }
      return;
    }
    const rowPropagate = event.target.closest("[data-sidecar-row-propagate]");
    if (rowPropagate) {
      try {
        await withBusyControl(rowPropagate, "Propagating...", () => propagateReviewDecision(Number(rowPropagate.dataset.sidecarIndex || -1)));
      } catch (error) {
        setStatus(error.message || "Could not propagate the Review decision.");
      }
      return;
    }
    const rowAction = event.target.closest("[data-sidecar-row-action]");
    if (rowAction) {
      try {
        const index = Number(rowAction.dataset.sidecarIndex || -1);
        const action = rowAction.dataset.sidecarRowAction || "";
        const busyLabel = {
          approve: "Approving...",
          "metadata-rework": "Flagging...",
          pick: "Picking...",
          unpick: "Unpicking...",
          reject: "Rejecting...",
        }[action] || "Staging...";
        await withBusyControl(rowAction, busyLabel, async () => {
          if (action === "approve") await stageRowMetadata(index, "approved");
          else if (action === "metadata-rework") await stageRowRework(index);
          else {
            await postDecision({ action }, {
              advance: false,
              indexes: [index],
            });
          }
        });
      } catch (error) {
        setStatus(error.message || "Could not stage row decision.");
      }
      return;
    }
    if (event.target.closest("input, textarea, select, button")) return;
    const card = event.target.closest("[data-sidecar-index]");
    if (!card) return;
    selectIndex(Number(card.dataset.sidecarIndex || 0), {
      extend: event.shiftKey,
      toggle: event.metaKey || event.ctrlKey,
    });
  });

  surface?.addEventListener("change", async (event) => {
    const categoryInput = event.target.closest("[data-sidecar-rework-category]");
    if (!categoryInput) return;
    const form = categoryInput.closest("[data-sidecar-row-form]");
    if (!form) return;
    const index = Number(form.dataset.sidecarIndex || -1);
    const reworkComment = syncReworkNoteFromCategories(form);
    const reworkCategory = reworkCategoryValue(checkedReworkCategories(form));
    try {
      await stageRowRework(index, {
        reworkCategory,
        reworkComment: reworkComment.trim(),
      });
    } catch (error) {
      setStatus(error.message || "Could not stage AI rework category.");
    }
  });

  surface?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-sidecar-row-form]");
    if (!form) return;
    event.preventDefault();
    try {
      await stageRowMetadata(Number(form.dataset.sidecarIndex || -1));
    } catch (error) {
      setStatus(error.message || "Could not stage row metadata.");
    }
  });

  document.addEventListener("click", (event) => {
    const quickLook = event.target.closest("[data-sidecar-quick-look]");
    if (!quickLook) return;
    const inlineVideoButton = event.target.closest("[data-sidecar-video-inline]");
    if (inlineVideoButton) {
      event.preventDefault();
      const index = Number(inlineVideoButton.dataset.sidecarIndex || state.quickLookIndex);
      playVideoInPlace(inlineVideoButton.closest("[data-sidecar-video-shell]"), state.items[index]);
      return;
    }
    if (event.target.closest("[data-sidecar-quick-look-close]") || event.target === quickLook) {
      event.preventDefault();
      closeQuickLook();
    }
  });

  pageTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setPage(button.dataset.sidecarPage || "culling").catch((error) => setStatus(error.message));
    });
  });

  filterInputs.forEach((input) => {
    input.addEventListener("change", () => {
      applyFilterChanges().catch((error) => setStatus(error.message));
    });
  });

  filterToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const family = button.dataset.sidecarFilterToggle;
      const checked = button.dataset.sidecarFilterChecked === "true";
      filterInputs.forEach((input) => {
        if (input.dataset.sidecarFilter === family) input.checked = checked;
      });
      applyFilterChanges().catch((error) => setStatus(error.message));
    });
  });

  searchInput?.addEventListener("input", () => {
    updateSearchClearState();
    if (searchChangeTimer) window.clearTimeout(searchChangeTimer);
    searchChangeTimer = window.setTimeout(() => {
      applySearchChanges().catch((error) => setStatus(error.message));
    }, 350);
  });
  searchInput?.addEventListener("search", () => {
    if (searchChangeTimer) window.clearTimeout(searchChangeTimer);
    applySearchChanges().catch((error) => setStatus(error.message));
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (searchChangeTimer) window.clearTimeout(searchChangeTimer);
    applySearchChanges().catch((error) => setStatus(error.message));
  });
  clearSearchButton?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (searchChangeTimer) window.clearTimeout(searchChangeTimer);
    applySearchChanges().catch((error) => setStatus(error.message));
  });

  $("[data-sidecar-limit]")?.addEventListener("change", () => {
    setOffset(0);
    state.windowCursorOffset = 0;
    state.windowBackStack = [];
    state.windowForwardStack = [];
    loadAndFillWindow().catch((error) => setStatus(error.message));
  });
  burstCullButton?.addEventListener("click", () => performBurstCull().catch((error) => setStatus(error.message)));
  emptyWastebasketButton?.addEventListener("click", () => emptyWastebasket().catch((error) => setStatus(error.message)));
  $("[data-sidecar-summary]")?.addEventListener("click", () => loadSummary().catch((error) => setStatus(error.message)));
  $("[data-sidecar-upload-plan]")?.addEventListener("click", () => loadPlan("upload").catch((error) => setStatus(error.message)));
  $("[data-sidecar-commit-plan]")?.addEventListener("click", () => loadPlan("commit").catch((error) => setStatus(error.message)));
  document.addEventListener("keydown", handleShortcut, true);

  applyStoredWindow();
  updateSearchClearState();
  syncPageUrl();
  renderPageChrome();
  renderWindowLoading();
  loadKeywordBlacklist();
  refreshIndexStatus({ silent: true }).catch(() => {});
  fetch("/__sidecar/version")
    .then((response) => response.json())
    .then((payload) => {
      if (versionRoot) versionRoot.textContent = `v${payload.version || versionFallback}`;
    })
    .catch(() => {
      if (versionRoot) versionRoot.textContent = versionFallbackLabel;
    });
  loadAndFillWindow().catch((error) => {
    setStatus(error.message);
    renderWindowFailure(error.message);
    loadSummary().catch(() => {});
  });
})();
