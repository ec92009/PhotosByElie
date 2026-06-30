(() => {
  const $ = (selector) => document.querySelector(selector);
  const status = $("[data-sidecar-status]");
  const versionRoot = $("[data-sidecar-version]");
  const surface = $("[data-sidecar-grid]");
  const surfaceEyebrow = $("[data-sidecar-grid-eyebrow]");
  const surfaceTitle = $("[data-sidecar-grid-title]");
  const detail = $("[data-sidecar-detail]");
  const countsRoot = $("[data-sidecar-counts]");
  const planPanel = $("[data-sidecar-plan-panel]");
  const planEyebrow = $("[data-sidecar-plan-eyebrow]");
  const planTitle = $("[data-sidecar-plan-title]");
  const planOutput = $("[data-sidecar-plan-output]");
  const loadButton = $("[data-sidecar-load]");
  const slideBackButton = $("[data-sidecar-slide-back]");
  const slideForwardButton = $("[data-sidecar-slide-forward]");
  const burstCullButton = $("[data-sidecar-burst-cull]");
  const emptyWastebasketButton = $("[data-sidecar-empty-wastebasket]");
  const pageTabs = Array.from(document.querySelectorAll("[data-sidecar-page]"));
  const filterInputs = Array.from(document.querySelectorAll("[data-sidecar-filter]"));

  const storageKey = "photosByElie.sidecar.window.v2";
  const pageConfigs = {
    culling: {
      eyebrow: "Culling",
      title: "Current window",
      empty: "Load a window to begin.",
      filteredEmpty: "No items in the current window match these filters.",
    },
    editing: {
      eyebrow: "Editing",
      title: "Title and keyword rows",
      empty: "Load a window to edit.",
      filteredEmpty: "No editable rows in the current window match these filters.",
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
  const shootWindowMs = 2 * 60 * 60 * 1000;
  const burstWindowMs = 1000;
  const previewFallbackMarkup = `<span class="sidecar-thumb-fallback">Preview unavailable</span>`;

  const normalizePage = (value) => (pageConfigs[value] ? value : "culling");
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

  const readStoredWindow = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null") || null;
    } catch {
      return null;
    }
  };

  const state = {
    page: normalizePage(new URLSearchParams(window.location.search).get("page") || readStoredWindow()?.page || "culling"),
    items: [],
    selectedIndex: -1,
    selectedIndexes: new Set(),
    selectionAnchorIndex: -1,
    summary: null,
    filters: normalizeFilters(readStoredWindow()?.filters || cloneDefaultFilters()),
    hasWindow: Boolean(readStoredWindow()?.hasWindow),
  };

  const escapeHtml = (value = "") => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const getLimit = () => Math.max(1, Number($("[data-sidecar-limit]")?.value || 96));
  const getOffset = () => Math.max(0, Number($("[data-sidecar-offset]")?.value || 0));
  const setOffset = (offset) => {
    const input = $("[data-sidecar-offset]");
    if (input) input.value = String(Math.max(0, offset));
  };

  const applyStoredWindow = () => {
    const stored = readStoredWindow();
    if (!stored) {
      filterInputs.forEach((input) => { input.checked = true; });
      return;
    }
    const dateFrom = $("[data-sidecar-date-from]");
    const dateTo = $("[data-sidecar-date-to]");
    const limit = $("[data-sidecar-limit]");
    const offset = $("[data-sidecar-offset]");
    if (dateFrom && typeof stored.dateFrom === "string") dateFrom.value = stored.dateFrom;
    if (dateTo && typeof stored.dateTo === "string") dateTo.value = stored.dateTo;
    if (limit && stored.limit) limit.value = String(stored.limit);
    if (offset && Number.isFinite(Number(stored.offset))) offset.value = String(Math.max(0, Number(stored.offset)));
    filterInputs.forEach((input) => {
      const key = filterKeyByName[input.dataset.sidecarFilter];
      input.checked = Boolean(key && state.filters[key]?.includes(input.value));
    });
  };

  const readFiltersFromControls = () => {
    const filters = { ratings: [], colors: [], pickStates: [], mediaTypes: [] };
    filterInputs.forEach((input) => {
      const key = filterKeyByName[input.dataset.sidecarFilter];
      if (key && input.checked) filters[key].push(input.value);
    });
    return normalizeFilters(filters);
  };

  const saveWindowState = () => {
    const payload = {
      page: state.page,
      dateFrom: $("[data-sidecar-date-from]")?.value || "",
      dateTo: $("[data-sidecar-date-to]")?.value || "",
      limit: getLimit(),
      offset: getOffset(),
      filters: state.filters,
      hasWindow: state.hasWindow,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Local persistence is a convenience; Sidecar remains usable without it.
    }
  };

  const formatDate = (value = "") => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  };

  const itemId = (item) => String(item?.localIdentifier || item?.assetId || "").trim();
  const previewUrl = (item) => `/__sidecar/preview/${encodeURIComponent(itemId(item))}?maxPixel=900`;
  const videoUrl = (item) => `/__sidecar/video/${encodeURIComponent(itemId(item))}`;
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
  const mediaLabel = (item) => {
    const duration = formatDuration(item?.duration || 0);
    return `${isVideo(item) ? "video" : "photo"}${duration ? ` · ${duration}` : ""}`;
  };
  const videoBadge = (item) => isVideo(item)
    ? `<span class="sidecar-media-badge" aria-label="Video${formatDuration(item.duration) ? `, ${formatDuration(item.duration)}` : ""}">VIDEO${formatDuration(item.duration) ? ` ${escapeHtml(formatDuration(item.duration))}` : ""}</span>`
    : "";
  const selectedItem = () => state.items[state.selectedIndex] || null;
  const selectedIndexes = () => Array.from(state.selectedIndexes || [])
    .filter((index) => index >= 0 && index < state.items.length)
    .sort((left, right) => left - right);
  const selectedItems = () => selectedIndexes().map((index) => state.items[index]).filter(Boolean);
  const selectedItemCount = () => selectedIndexes().length;
  const selectedSelectionSet = () => new Set(selectedIndexes());

  const pickFilterValue = (item) => {
    const pickState = item.sidecarState?.pickState || "undecided";
    if (pickState === "picked") return "picked";
    if (pickState === "rejected" || pickState === "hidden") return "rejected";
    return "undecided";
  };

  const matchesFilters = (item) => {
    if (!item || item.tombstoneState === "active") return false;
    const sidecar = item.sidecarState || {};
    const rating = String(Math.max(0, Math.min(5, Number(sidecar.rating || 0))));
    const color = sidecar.color || "none";
    return state.filters.ratings.includes(rating)
      && state.filters.colors.includes(color)
      && state.filters.pickStates.includes(pickFilterValue(item))
      && state.filters.mediaTypes.includes(mediaTypeValue(item));
  };

  const visibleIndexes = () => state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesFilters(item))
    .map(({ index }) => index);

  const firstVisibleIndex = () => visibleIndexes()[0] ?? -1;
  const nextVisibleAfter = (index) => {
    const visible = visibleIndexes();
    return visible.find((visibleIndex) => visibleIndex > index) ?? visible[visible.length - 1] ?? -1;
  };
  const stepVisibleSelection = (direction) => {
    const visible = visibleIndexes();
    if (!visible.length) return;
    const currentPosition = visible.indexOf(state.selectedIndex);
    const fallbackPosition = direction > 0 ? 0 : visible.length - 1;
    const nextPosition = currentPosition < 0
      ? fallbackPosition
      : Math.max(0, Math.min(visible.length - 1, currentPosition + direction));
    selectIndex(visible[nextPosition]);
  };

  const reconcileSelection = (preferredIndex = null) => {
    const visible = new Set(visibleIndexes());
    if (preferredIndex !== null && preferredIndex >= 0 && visible.has(preferredIndex)) {
      state.selectedIndex = preferredIndex;
      state.selectedIndexes = new Set([preferredIndex]);
      state.selectionAnchorIndex = preferredIndex;
      return;
    }
    const retained = selectedIndexes().filter((index) => visible.has(index));
    if (retained.length) {
      state.selectedIndexes = new Set(retained);
      state.selectedIndex = retained.includes(state.selectedIndex) ? state.selectedIndex : retained[0];
      state.selectionAnchorIndex = state.selectedIndex;
      return;
    }
    const first = firstVisibleIndex();
    state.selectedIndex = first;
    state.selectedIndexes = first >= 0 ? new Set([first]) : new Set();
    state.selectionAnchorIndex = first;
  };

  const setInitialSelection = () => {
    const first = firstVisibleIndex();
    state.selectedIndex = first;
    state.selectedIndexes = first >= 0 ? new Set([first]) : new Set();
    state.selectionAnchorIndex = first;
  };

  const wirePreviewFallbacks = (root) => {
    root?.querySelectorAll("img[data-sidecar-preview]").forEach((img) => {
      const markMissing = () => {
        img.closest(".sidecar-thumb, .sidecar-detail-preview, .sidecar-editing-preview")?.classList.add("is-missing");
        img.removeAttribute("src");
      };
      img.addEventListener("error", markMissing, { once: true });
      if (img.complete && img.naturalWidth === 0) markMissing();
    });
  };

  const sidecarBadges = (item) => {
    const sidecar = item.sidecarState || {};
    const badges = [];
    if (sidecar.color) badges.push(sidecar.color);
    if (isVideo(item)) badges.push(`video${formatDuration(item.duration) ? ` ${formatDuration(item.duration)}` : ""}`);
    if (sidecar.pickState && sidecar.pickState !== "undecided") badges.push(sidecar.pickState);
    if (sidecar.metadataState && sidecar.metadataState !== "unreviewed") badges.push(sidecar.metadataState);
    if (item.tombstoneState === "active") badges.push("tombstoned");
    if (item.pendingSyncCount) badges.push(`${item.pendingSyncCount} pending`);
    return badges.map((badge) => `<span class="sidecar-badge">${escapeHtml(badge)}</span>`).join("");
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

  const decisionAttrs = (item) => {
    const sidecar = item.sidecarState || {};
    const attrs = [];
    if (sidecar.color) attrs.push(`data-sidecar-color="${escapeHtml(sidecar.color)}"`);
    if (sidecar.pickState) attrs.push(`data-sidecar-pick="${escapeHtml(sidecar.pickState)}"`);
    if (item.tombstoneState) attrs.push(`data-sidecar-tombstone="${escapeHtml(item.tombstoneState)}"`);
    const rating = Number(sidecar.rating || 0);
    if (rating > 0) attrs.push(`data-sidecar-rating="${rating}"`);
    return attrs.join(" ");
  };

  const ratingStars = (item) => {
    const rating = Math.max(0, Math.min(5, Number(item.sidecarState?.rating || 0)));
    return rating ? `<span class="sidecar-stars" aria-label="${rating} star rating">${"&#9733;".repeat(rating)}</span>` : "";
  };

  const parseKeywords = (value = "") => String(value || "")
    .replace(/;/g, ",")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  const metadataFormValues = () => {
    const form = detail?.querySelector("[data-sidecar-metadata-form]");
    const data = form ? new FormData(form) : new FormData();
    return {
      title: String(data.get("title") || "").trim(),
      keywords: parseKeywords(data.get("keywords") || ""),
    };
  };

  const sameShootIndexes = () => {
    const source = selectedItem();
    const sourceTime = Date.parse(source?.creationDate || "");
    if (!Number.isFinite(sourceTime)) return state.selectedIndex >= 0 ? [state.selectedIndex] : [];
    return state.items
      .map((item, index) => ({ index, time: Date.parse(item.creationDate || "") }))
      .filter(({ index, time }) => index >= state.selectedIndex && Number.isFinite(time) && Math.abs(time - sourceTime) <= shootWindowMs)
      .map(({ index }) => index);
  };

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

  const renderPageChrome = () => {
    const config = pageConfigs[state.page] || pageConfigs.culling;
    if (surfaceEyebrow) surfaceEyebrow.textContent = config.eyebrow;
    if (surfaceTitle) surfaceTitle.textContent = config.title;
    if (loadButton) loadButton.textContent = "Load window";
    document.body.dataset.sidecarActivePage = state.page;
    pageTabs.forEach((button) => {
      const selected = button.dataset.sidecarPage === state.page;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.classList.toggle("is-active", selected);
    });
  };

  const renderCullingGrid = (indexes) => {
    surface.innerHTML = indexes.map((index) => {
      const item = state.items[index];
      const id = itemId(item);
      const selected = state.selectedIndexes.has(index);
      const label = item.filename || id;
      return `
        <article class="${decisionClasses("sidecar-card", item, selected)}" ${decisionAttrs(item)} data-sidecar-index="${index}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <div class="sidecar-thumb">
            <img data-sidecar-preview src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(label)}" loading="lazy"/>
            ${previewFallbackMarkup}
            ${videoBadge(item)}
            ${ratingStars(item)}
          </div>
          <div class="sidecar-card-copy">
            <strong>${escapeHtml(label)}</strong>
            <small>${escapeHtml(formatDate(item.creationDate))} · ${escapeHtml(mediaLabel(item))}</small>
            <div class="sidecar-badges">${sidecarBadges(item)}</div>
          </div>
        </article>
      `;
    }).join("");
  };

  const renderEditingList = (indexes) => {
    const multi = selectedItemCount() > 1;
    surface.innerHTML = `
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
    const keywords = Array.isArray(sidecar.keywords) ? sidecar.keywords.join(", ") : "";
    return `
      <article class="${decisionClasses("sidecar-editing-row", item, selected)}" ${decisionAttrs(item)} data-sidecar-index="${index}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
        <div class="sidecar-editing-preview">
          <img data-sidecar-preview src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(label)}" loading="lazy"/>
          ${previewFallbackMarkup}
          ${videoBadge(item)}
          ${ratingStars(item)}
        </div>
        <div class="sidecar-editing-current">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(formatDate(item.creationDate))} · ${escapeHtml(mediaLabel(item))}</small>
          <div class="sidecar-badges">${sidecarBadges(item)}</div>
        </div>
        <form class="sidecar-editing-form" data-sidecar-row-form data-sidecar-index="${index}">
          <label>
            <span>Title</span>
            <input type="text" name="title" value="${escapeHtml(sidecar.title || "")}" placeholder="Title for Photos and future catalog"/>
          </label>
          <label>
            <span>Keywords</span>
            <textarea name="keywords" placeholder="Comma-separated descriptive keywords">${escapeHtml(keywords)}</textarea>
          </label>
        </form>
        <div class="sidecar-editing-actions">
          <button class="sidecar-chip" type="button" data-sidecar-row-submit data-sidecar-index="${index}">Stage</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="approve" data-sidecar-index="${index}" aria-pressed="${sidecar.metadataState === "approved" ? "true" : "false"}">Approve</button>
          <button class="sidecar-chip" type="button" data-sidecar-row-action="metadata-rework" data-sidecar-index="${index}" aria-pressed="${sidecar.metadataState === "rework" ? "true" : "false"}">AI rework</button>
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
    surface.classList.toggle("is-editing-list", state.page === "editing");
    if (!state.items.length) {
      surface.innerHTML = `<p class="empty-basket">${escapeHtml(config.empty)}</p>`;
      renderCounts();
      renderDetail();
      return;
    }
    reconcileSelection();
    const indexes = visibleIndexes();
    if (!indexes.length) {
      surface.innerHTML = `<p class="empty-basket">${escapeHtml(config.filteredEmpty)}</p>`;
      renderCounts();
      renderDetail();
      return;
    }
    if (state.page === "editing") renderEditingList(indexes);
    else renderCullingGrid(indexes);
    wirePreviewFallbacks(surface);
    renderCounts();
  };

  const cardForIndex = (index) => surface?.querySelector(`[data-sidecar-index="${index}"]`);

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

  const chip = (label, action, value, active = false) => `
    <button class="sidecar-chip" type="button" data-sidecar-action="${escapeHtml(action)}" data-sidecar-value="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>
  `;

  const renderDetail = () => {
    const item = selectedItem();
    if (!detail) return;
    if (state.page === "editing") {
      detail.innerHTML = `<p class="empty-basket">Use the editing rows to stage titles and keywords.</p>`;
      return;
    }
    if (!item) {
      detail.innerHTML = `<p class="empty-basket">Select a photo to edit.</p>`;
      return;
    }
    const sidecar = item.sidecarState || {};
    const keywords = Array.isArray(sidecar.keywords) ? sidecar.keywords.join(", ") : "";
    const titleInputId = `sidecar-title-${state.selectedIndex}`;
    const keywordsInputId = `sidecar-keywords-${state.selectedIndex}`;
    const selectionCount = selectedItemCount();
    const selectionNote = selectionCount > 1
      ? `<p class="sidecar-selection-note">${selectionCount.toLocaleString()} selected. Decision buttons apply to the selection; metadata fields edit the active item.</p>`
      : "";
    detail.innerHTML = `
      <div class="sidecar-detail-preview">
        <img data-sidecar-preview src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(item.filename || itemId(item))}"/>
        ${previewFallbackMarkup}
        ${videoBadge(item)}
      </div>
      <div>
        <strong>${escapeHtml(item.filename || itemId(item))}</strong>
        <p class="owner-card-note">${escapeHtml(formatDate(item.creationDate))} · ${escapeHtml(mediaLabel(item))} · ${escapeHtml(itemId(item))}</p>
        ${selectionNote}
      </div>
      ${isVideo(item) ? `
        <div class="sidecar-video-actions">
          <button class="sidecar-chip" type="button" data-sidecar-video-toggle>Play preview</button>
          <span class="owner-card-note">Local video only. Sidecar will not force iCloud downloads here.</span>
        </div>
        <div class="sidecar-video-panel" data-sidecar-video-panel hidden>
          <video controls preload="metadata" poster="${escapeHtml(previewUrl(item))}" src="${escapeHtml(videoUrl(item))}"></video>
        </div>
      ` : ""}
      <div class="sidecar-decision-row" aria-label="Rating">
        ${[1, 2, 3, 4, 5].map((value) => chip(`${value}`, "rating", String(value), Number(sidecar.rating || 0) === value)).join("")}
        ${chip("0", "rating", "0", Number(sidecar.rating || 0) === 0)}
      </div>
      <div class="sidecar-decision-row" aria-label="Color">
        ${["red", "yellow", "green", "blue", "purple"].map((value) => chip(value, "color", value, sidecar.color === value)).join("")}
        ${chip("clear", "color", "", !sidecar.color)}
      </div>
      <div class="sidecar-button-row">
        ${chip("Pick", "pick", "", sidecar.pickState === "picked")}
        ${chip("Unpick", "unpick", "", sidecar.pickState === "undecided")}
        ${chip("Reject", "reject", "", sidecar.pickState === "rejected")}
        ${chip("Hide", "hide", "", sidecar.pickState === "hidden")}
        ${chip("Approve", "approve", "", sidecar.metadataState === "approved")}
        ${chip("AI rework", "metadata-rework", "", sidecar.metadataState === "rework")}
      </div>
      <form class="sidecar-edit-form" data-sidecar-metadata-form>
        <div class="sidecar-edit-field">
          <div class="sidecar-field-heading">
            <label for="${titleInputId}">Title</label>
            <button class="sidecar-propagate-field" type="button" data-sidecar-propagate-field="title" aria-label="Propagate title down" title="Propagate this title to current and following rows in the same two-hour shoot window">↓</button>
          </div>
          <input id="${titleInputId}" type="text" name="title" value="${escapeHtml(sidecar.title || "")}" placeholder="Title for Photos and future catalog"/>
        </div>
        <div class="sidecar-edit-field">
          <div class="sidecar-field-heading">
            <label for="${keywordsInputId}">Keywords</label>
            <button class="sidecar-propagate-field" type="button" data-sidecar-propagate-field="keywords" aria-label="Propagate keywords down" title="Propagate these keywords to current and following rows in the same two-hour shoot window">↓</button>
          </div>
          <textarea id="${keywordsInputId}" name="keywords" placeholder="Comma-separated descriptive keywords">${escapeHtml(keywords)}</textarea>
        </div>
        <div class="sidecar-metadata-actions">
          <button class="btn secondary" type="submit">Stage metadata</button>
          <button class="btn secondary" type="button" data-sidecar-propagate-field="metadata">Propagate metadata</button>
        </div>
      </form>
    `;
    wirePreviewFallbacks(detail);
  };

  const toggleVideoPreview = () => {
    const panel = detail?.querySelector("[data-sidecar-video-panel]");
    const button = detail?.querySelector("[data-sidecar-video-toggle]");
    if (!panel || !button) return;
    const nextHidden = !panel.hidden;
    panel.hidden = nextHidden;
    button.textContent = nextHidden ? "Play preview" : "Hide preview";
  };

  const selectIndex = (index, { extend = false, toggle = false, scroll = true } = {}) => {
    if (!state.items.length) {
      state.selectedIndex = -1;
      state.selectedIndexes = new Set();
      state.selectionAnchorIndex = -1;
      renderSurface();
      renderDetail();
      return;
    }
    const visible = new Set(visibleIndexes());
    if (!visible.has(index)) return;
    const bounded = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, state.items.length - 1));
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
    updateGridSelection(previousIndexes);
    renderDetail();
    if (scroll && state.selectedIndex >= 0) cardForIndex(state.selectedIndex)?.scrollIntoView({ block: "nearest" });
  };

  const mergeChangedItem = (assetId, nextState, pendingCount = 1) => {
    const index = state.items.findIndex((item) => itemId(item) === assetId);
    if (index < 0) return -1;
    const item = state.items[index];
    const { tombstoneState, ...sidecarState } = nextState || {};
    item.sidecarState = { ...(item.sidecarState || {}), ...sidecarState };
    if (typeof tombstoneState !== "undefined") item.tombstoneState = tombstoneState;
    item.pendingSyncCount = Math.max(Number(item.pendingSyncCount || 0), pendingCount);
    return index;
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
    return payload.action;
  };

  const postDecision = async (payload, { advance = true, indexes = null } = {}) => {
    const targetIndexes = Array.isArray(indexes) ? indexes : selectedIndexes();
    if (!targetIndexes.length) return;
    const previousActive = state.selectedIndex;
    const decisions = targetIndexes
      .map((index) => state.items[index])
      .filter(Boolean)
      .map((item) => ({ assetId: itemId(item), ...payload }));
    if (!decisions.length) return;

    setStatus(`Staging ${actionLabel(payload)} on ${decisions.length.toLocaleString()} item${decisions.length === 1 ? "" : "s"}...`);
    const endpoint = decisions.length === 1 ? "/__sidecar/decision" : "/__sidecar/decisions";
    const body = decisions.length === 1 ? decisions[0] : { decisions };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not stage Sidecar decision.");

    const changedItems = decisions.length === 1 ? [result] : (result.items || []);
    changedItems.forEach((item) => {
      mergeChangedItem(item.assetId, item.state || {}, item.changedFamilies?.length || 1);
    });
    state.summary = result.summary || state.summary;
    const preferredIndex = advance && !indexes && decisions.length === 1 ? nextVisibleAfter(previousActive) : previousActive;
    reconcileSelection(preferredIndex);
    renderSurface();
    renderDetail();
    setStatus(`Staged ${actionLabel(payload)} on ${decisions.length.toLocaleString()} item${decisions.length === 1 ? "" : "s"}. Photos write-back is pending commit.`);
  };

  const postDecisions = async (decisions, message, completeMessage = "") => {
    if (!decisions.length) return;
    setStatus(message || `Staging ${decisions.length.toLocaleString()} local decisions...`);
    const response = await fetch("/__sidecar/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not stage Sidecar decisions.");
    (result.items || []).forEach((item) => {
      mergeChangedItem(item.assetId, item.state || {}, item.changedFamilies?.length || 1);
    });
    state.summary = result.summary || state.summary;
    reconcileSelection(state.selectedIndex);
    renderSurface();
    renderDetail();
    setStatus(completeMessage || `Staged ${Number(result.count || decisions.length).toLocaleString()} local decisions. Photos write-back is pending commit.`);
  };

  const propagateMetadataField = async (field) => {
    const source = selectedItem();
    if (!source) return;
    const sourceValues = metadataFormValues();
    const targets = sameShootIndexes();
    const decisions = targets.map((index) => {
      const target = state.items[index];
      const sidecar = target.sidecarState || {};
      const isSource = index === state.selectedIndex;
      const existingTitle = isSource ? sourceValues.title : String(sidecar.title || "");
      const existingKeywords = isSource
        ? sourceValues.keywords
        : (Array.isArray(sidecar.keywords) ? sidecar.keywords : []);
      return {
        assetId: itemId(target),
        action: "metadata",
        title: field === "keywords" ? existingTitle : sourceValues.title,
        keywords: field === "title" ? existingKeywords : sourceValues.keywords,
        metadataState: "proposed",
      };
    });
    const label = field === "metadata" ? "title and keywords" : field;
    await postDecisions(
      decisions,
      `Propagating ${label} locally...`,
      `Propagated ${label} to ${decisions.length.toLocaleString()} same-shoot assets. Photos write-back is pending commit.`,
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
    );
  };

  const loadWindow = async () => {
    state.filters = readFiltersFromControls();
    const params = new URLSearchParams();
    const limit = String(getLimit());
    const offset = String(getOffset());
    const dateFrom = $("[data-sidecar-date-from]")?.value || "";
    const dateTo = $("[data-sidecar-date-to]")?.value || "";
    params.set("limit", limit);
    params.set("offset", offset);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    setStatus("Loading current Apple Photos window...");
    const response = await fetch(`/__sidecar/library?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load current window.");
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.summary = payload.sidecarSummary || state.summary;
    state.hasWindow = true;
    setInitialSelection();
    renderPageChrome();
    renderSurface();
    renderDetail();
    saveWindowState();
    setStatus(`Loaded window ${Number(offset).toLocaleString()}-${(Number(offset) + state.items.length).toLocaleString()} from Apple Photos. Showing ${visibleIndexes().length.toLocaleString()} after filters.`);
  };

  const slideWindow = async (direction) => {
    setOffset(getOffset() + (direction * getLimit()));
    await loadWindow();
  };

  const loadSummary = async () => {
    const response = await fetch("/__sidecar/summary");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar summary.");
    state.summary = payload;
    renderCounts();
    setStatus(`${Number(payload.pendingSyncCount || 0).toLocaleString()} pending Photos write-back changes.`);
  };

  const renderPlan = (title, eyebrow, payload) => {
    if (!planPanel || !planOutput) return;
    planPanel.hidden = false;
    if (planTitle) planTitle.textContent = title;
    if (planEyebrow) planEyebrow.textContent = eyebrow;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const message = payload.message ? `<p>${escapeHtml(payload.message)}</p>` : "";
    planOutput.innerHTML = `
      <p><strong>${items.length.toLocaleString()}</strong> row${items.length === 1 ? "" : "s"}.</p>
      ${message}
      <div class="sidecar-plan-list">
        ${items.slice(0, 80).map((item) => `
          <div class="sidecar-plan-row">
            <strong>${escapeHtml(item.filename || item.assetId || item.syncId || "")}</strong>
            <small>${escapeHtml(item.fieldFamily || item.eligibleReason || "")}</small>
            <small>${escapeHtml(item.capturedAt || item.createdAt || "")}</small>
          </div>
        `).join("") || "<p>No rows.</p>"}
      </div>
    `;
  };

  const loadPlan = async (kind) => {
    const endpoint = kind === "upload" ? "/__sidecar/upload-plan" : "/__sidecar/commit-plan";
    const response = await fetch(endpoint);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load Sidecar plan.");
    renderPlan(kind === "upload" ? "Next Upload Eligibility" : "Pending Photos Write-Back", kind === "upload" ? "Upload plan" : "Commit plan", payload);
    setStatus(kind === "upload" ? "Upload plan refreshed." : "Photos commit plan refreshed.");
  };

  const setPage = (page) => {
    state.page = normalizePage(page);
    const url = new URL(window.location.href);
    if (state.page === "culling") url.searchParams.delete("page");
    else url.searchParams.set("page", state.page);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    renderPageChrome();
    renderSurface();
    renderDetail();
    saveWindowState();
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
    renderDetail();
    setStatus(`Tombstoned ${Number(payload.count || 0).toLocaleString()} discarded item${Number(payload.count || 0) === 1 ? "" : "s"}. Photos write-back is pending commit.`);
  };

  const handleShortcut = async (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const key = event.key;
    try {
      if (/^[1-5]$/.test(key)) {
        event.preventDefault();
        await postDecision({ action: "rating", rating: Number(key) });
      } else if (key === "0") {
        event.preventDefault();
        await postDecision({ action: "rating", rating: 0 });
      } else if (colorShortcuts[key]) {
        event.preventDefault();
        await postDecision(colorDecisionPayload(colorShortcuts[key]), { advance: false });
      } else if (key === "p" || key === "P") {
        event.preventDefault();
        await postDecision({ action: "pick" });
      } else if (key === "a" || key === "A") {
        event.preventDefault();
        await postDecision({ action: "approve" });
      } else if (key === "x" || key === "X") {
        event.preventDefault();
        await postDecision({ action: "reject" });
      } else if (key === "h" || key === "H") {
        event.preventDefault();
        await postDecision({ action: "hide" });
      } else if (key === "u" || key === "U") {
        event.preventDefault();
        await postDecision({ action: "unpick" });
      } else if (key === "ArrowRight" || key === "ArrowDown") {
        event.preventDefault();
        stepVisibleSelection(1);
      } else if (key === "ArrowLeft" || key === "ArrowUp") {
        event.preventDefault();
        stepVisibleSelection(-1);
      }
    } catch (error) {
      setStatus(error.message || "Sidecar shortcut failed.");
    }
  };

  const stageRowMetadata = async (index) => {
    const form = surface?.querySelector(`[data-sidecar-row-form][data-sidecar-index="${index}"]`);
    if (!form) return;
    const data = new FormData(form);
    await postDecision({
      action: "metadata",
      title: data.get("title") || "",
      keywords: parseKeywords(data.get("keywords") || ""),
      metadataState: "proposed",
    }, { advance: false, indexes: [index] });
  };

  surface?.addEventListener("click", async (event) => {
    const rowSubmit = event.target.closest("[data-sidecar-row-submit]");
    if (rowSubmit) {
      try {
        await stageRowMetadata(Number(rowSubmit.dataset.sidecarIndex || -1));
      } catch (error) {
        setStatus(error.message || "Could not stage row metadata.");
      }
      return;
    }
    const rowAction = event.target.closest("[data-sidecar-row-action]");
    if (rowAction) {
      try {
        await postDecision({ action: rowAction.dataset.sidecarRowAction }, {
          advance: false,
          indexes: [Number(rowAction.dataset.sidecarIndex || -1)],
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

  detail?.addEventListener("click", async (event) => {
    const propagateButton = event.target.closest("[data-sidecar-propagate-field]");
    if (propagateButton) {
      try {
        await propagateMetadataField(propagateButton.dataset.sidecarPropagateField || "");
      } catch (error) {
        setStatus(error.message || "Could not propagate metadata.");
      }
      return;
    }
    const videoButton = event.target.closest("[data-sidecar-video-toggle]");
    if (videoButton) {
      toggleVideoPreview();
      return;
    }
    const button = event.target.closest("[data-sidecar-action]");
    if (!button) return;
    try {
      const action = button.dataset.sidecarAction;
      const value = button.dataset.sidecarValue || "";
      if (action === "rating") await postDecision({ action, rating: Number(value) }, { advance: false });
      else if (action === "color") await postDecision(colorDecisionPayload(value), { advance: false });
      else await postDecision({ action }, { advance: action !== "metadata-rework" });
    } catch (error) {
      setStatus(error.message || "Could not stage decision.");
    }
  });

  detail?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-sidecar-metadata-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    try {
      await postDecision({
        action: "metadata",
        title: data.get("title") || "",
        keywords: parseKeywords(data.get("keywords") || ""),
        metadataState: "proposed",
      }, { advance: false, indexes: [state.selectedIndex] });
    } catch (error) {
      setStatus(error.message || "Could not stage metadata.");
    }
  });

  pageTabs.forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.sidecarPage || "culling"));
  });

  filterInputs.forEach((input) => {
    input.addEventListener("change", () => {
      state.filters = readFiltersFromControls();
      reconcileSelection(state.selectedIndex);
      renderSurface();
      renderDetail();
      setStatus(`Showing ${visibleIndexes().length.toLocaleString()} of ${state.items.length.toLocaleString()} current-window items after filters.`);
      saveWindowState();
    });
  });

  loadButton?.addEventListener("click", () => loadWindow().catch((error) => setStatus(error.message)));
  slideBackButton?.addEventListener("click", () => slideWindow(-1).catch((error) => setStatus(error.message)));
  slideForwardButton?.addEventListener("click", () => slideWindow(1).catch((error) => setStatus(error.message)));
  burstCullButton?.addEventListener("click", () => performBurstCull().catch((error) => setStatus(error.message)));
  emptyWastebasketButton?.addEventListener("click", () => emptyWastebasket().catch((error) => setStatus(error.message)));
  $("[data-sidecar-summary]")?.addEventListener("click", () => loadSummary().catch((error) => setStatus(error.message)));
  $("[data-sidecar-upload-plan]")?.addEventListener("click", () => loadPlan("upload").catch((error) => setStatus(error.message)));
  $("[data-sidecar-commit-plan]")?.addEventListener("click", () => loadPlan("commit").catch((error) => setStatus(error.message)));
  document.addEventListener("keydown", handleShortcut);

  applyStoredWindow();
  renderPageChrome();
  renderSurface();
  renderDetail();
  fetch("/__sidecar/version")
    .then((response) => response.json())
    .then((payload) => {
      if (versionRoot) versionRoot.textContent = `v${payload.version || "122.3"}`;
    })
    .catch(() => {
      if (versionRoot) versionRoot.textContent = "v122.3";
    });
  loadWindow().catch((error) => {
    setStatus(error.message);
    loadSummary().catch(() => {});
  });
})();
