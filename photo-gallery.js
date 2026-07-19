((async () => {
await window.photosByElieCatalogReady;
await window.photosByElieHiddenActionsReady;
const galleryHrefForKey = (key) => `./gallery.html?gallery=${encodeURIComponent(key)}`;
const selectionGalleryKey = "selection";
const selectionGalleryAliases = new Set([selectionGalleryKey, "make-selection", "make-your-selection"]);
const panoramaGalleryKey = "panoramas";
const panoramaGalleryAliases = new Set([panoramaGalleryKey, "pano", "panos", "panorama"]);
const baseGalleryCollections = ["france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"];
const selectionGalleryCollections = baseGalleryCollections;
const requestedGalleryKey = String(new URLSearchParams(window.location.search).get("gallery") || "").trim().toLowerCase();
if (window.photosByElieCollectionIsRetired?.(requestedGalleryKey)) {
  const replacement = window.photosByElieVersionedHref?.("./gallery.html?gallery=selection") || "./gallery.html?gallery=selection";
  window.location.replace(replacement);
  return;
}
const isSelectionGalleryKey = (key) => selectionGalleryAliases.has(key);
const isPanoramaGalleryKey = (key) => panoramaGalleryAliases.has(key);
const galleryKeyFromPage = () => {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("gallery") || document.body.dataset.gallery || "";
  const normalized = requested.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (isSelectionGalleryKey(normalized)) return selectionGalleryKey;
  if (isPanoramaGalleryKey(normalized)) return panoramaGalleryKey;
  if (normalized && window.photosByElieData?.[normalized]) return normalized;
  const pageSlug = (window.location.pathname.split("/").pop() || "").replace(/\.html$/i, "");
  if (isPanoramaGalleryKey(pageSlug)) return panoramaGalleryKey;
  if (pageSlug && window.photosByElieData?.[pageSlug]) return pageSlug;
  return "france";
};
const selectionPhotos = () => selectionGalleryCollections
  .flatMap((key) => window.photosByElieData?.[key]?.photos || []);
const panoramaPhotos = () => {
  const seen = new Set();
  return baseGalleryCollections
    .flatMap((key) => window.photosByElieData?.[key]?.photos || [])
    .filter((photo) => {
      if (!photo?.id || seen.has(photo.id) || window.photosByElieIsVideo?.(photo)) return false;
      if (!window.photosByEliePhotoIsPanorama?.(photo)) return false;
      seen.add(photo.id);
      return true;
    });
};
const makeSelectionGallery = () => ({
  number: "",
  title: "Search",
  description: "",
  accent: "selection-gallery",
  photos: selectionPhotos(),
});
const makePanoramaGallery = () => ({
  number: "",
  title: "Panoramas",
  description: "",
  accent: "panoramas-gallery",
  photos: panoramaPhotos(),
});
const galleryForKey = (key) => {
  if (key === selectionGalleryKey) return makeSelectionGallery();
  if (key === panoramaGalleryKey) return makePanoramaGallery();
  return window.photosByElieData?.[key];
};
const galleryKey = galleryKeyFromPage();
const isSelectionGallery = galleryKey === selectionGalleryKey;
const isPanoramaGallery = galleryKey === panoramaGalleryKey;
document.body.dataset.gallery = galleryKey;
let gallery = galleryForKey(galleryKey);
const galleryRoot = document.querySelector("[data-gallery-root]");
const galleryStatus = document.querySelector("[data-gallery-status]");
const hiddenActions = window.photosByElieHiddenActions;
const reserveStore = window.photosByElieReserve;
const likedStore = window.photosByElieLiked;
const localModerationEnabled = Boolean(hiddenActions?.enabled);
const ownerCullingEnabled = Boolean(hiddenActions?.cullingEnabled);
const reserveFillEnabled = false;
const galleryActions = document.querySelector("[data-gallery-actions]");
const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
let selectedIndex = 0;
const selectedPhotoIds = new Set();
let lastCulledPhotoIds = [];
let ownerCullToolbar = null;
const pageSize = 24;
const showAllChunkSize = pageSize * 4;
const showAllChunkDelayMs = 16;
const densityKey = "photosbyelie-gallery-columns";
const fitModeKey = "photosbyelie-gallery-fit-mode";
let densityInput = null;
let densityValue = null;
let fitModeButtons = [];
let viewControls = null;
let renderedGalleryPhotos = [];
let visibleLimit = pageSize;
let moreButton = null;
let moreDoubleButton = null;
let showAllButton = null;
let showAllRenderToken = 0;
const filterStateKey = `photosbyelie-gallery-filters-${galleryKey}`;
const detailSequenceKey = "photosbyelie-detail-sequence";
const galleryReturnStateKey = "photosbyelie-gallery-return-state";
const diversityBucketMinutes = 10;
const photoFilter = window.photosByEliePhotoFilter;
const defaultFilterState = {
  query: "",
  orientation: "all",
  minSize: "all",
  mood: "all",
  subject: "all",
  sort: "newest",
  mediaType: "all",
  dateFrom: "",
  dateTo: ""
};
const persistedFilterKeys = ["orientation", "minSize", "mood", "subject", "mediaType", "dateFrom", "dateTo"];
let filterBar = null;
let filterToggle = null;
let reviewVisibleButton = null;
let ownerSuperSearchIndex = new Map();
let ownerSuperSearchPromise = null;

const shortcutKey = (label) => `<kbd>${label}</kbd>`;

const syncOwnerCullToolbar = () => {
  if (!ownerCullToolbar) return;
  const count = selectedPhotoIds.size;
  ownerCullToolbar.querySelector("[data-owner-cull-count]").textContent = `${count} selected`;
  ownerCullToolbar.querySelector("[data-owner-cull-hide]").disabled = count === 0;
  ownerCullToolbar.querySelector("[data-owner-cull-clear]").disabled = count === 0;
  ownerCullToolbar.querySelector("[data-owner-cull-undo]").disabled = lastCulledPhotoIds.length === 0;
};

const ensureOwnerCullToolbar = () => {
  if (!ownerCullingEnabled || !galleryActions || ownerCullToolbar) return;
  ownerCullToolbar = document.createElement("div");
  ownerCullToolbar.className = "owner-cull-toolbar";
  ownerCullToolbar.setAttribute("aria-label", "Owner culling controls");
  ownerCullToolbar.innerHTML = `
    <strong data-owner-cull-count>0 selected</strong>
    <button class="btn secondary" type="button" data-owner-cull-select-visible>Select visible</button>
    <button class="btn" type="button" data-owner-cull-hide disabled>Move to Waste Basket</button>
    <button class="btn secondary" type="button" data-owner-cull-clear disabled>Clear</button>
    <button class="btn secondary" type="button" data-owner-cull-undo disabled>Undo</button>
  `;
  galleryActions.prepend(ownerCullToolbar);
  ownerCullToolbar.querySelector("[data-owner-cull-select-visible]").addEventListener("click", () => {
    renderedGalleryPhotos.slice(0, 500).forEach((photo) => selectedPhotoIds.add(photo.id));
    renderGallery();
  });
  ownerCullToolbar.querySelector("[data-owner-cull-clear]").addEventListener("click", () => {
    selectedPhotoIds.clear();
    renderGallery();
  });
  ownerCullToolbar.querySelector("[data-owner-cull-hide]").addEventListener("click", async () => {
    const ids = [...selectedPhotoIds].slice(0, 500);
    if (!ids.length) return;
    try {
      setGalleryStatus(`Moving ${ids.length} photo${ids.length === 1 ? "" : "s"} to Waste Basket...`);
      await hiddenActions.markMany(ids);
      lastCulledPhotoIds = ids;
      selectedPhotoIds.clear();
      renderGallery();
      setGalleryStatus(`${ids.length} photo${ids.length === 1 ? "" : "s"} moved to Waste Basket.`);
    } catch (error) {
      setGalleryStatus(error?.message || "Could not move the selected photos to Waste Basket.");
    }
  });
  ownerCullToolbar.querySelector("[data-owner-cull-undo]").addEventListener("click", async () => {
    if (!lastCulledPhotoIds.length) return;
    const ids = [...lastCulledPhotoIds];
    try {
      setGalleryStatus(`Restoring ${ids.length} photo${ids.length === 1 ? "" : "s"}...`);
      await hiddenActions.undoMany(ids);
      lastCulledPhotoIds = [];
      renderGallery();
      setGalleryStatus(`${ids.length} photo${ids.length === 1 ? "" : "s"} restored.`);
    } catch (error) {
      setGalleryStatus(error?.message || "Could not undo the last basket move.");
    }
  });
  syncOwnerCullToolbar();
};
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const dateLocale = () => {
  const language = window.photosByElieI18n?.language?.() || document.documentElement.lang || navigator.language || "en";
  if (language === "es") return "es-ES";
  if (language === "fr") return "fr-FR";
  return "en-GB";
};

const formatGalleryDate = (value) => {
  const normalized = photoFilter.dateFilterValue(value);
  if (!normalized) return t("gallery.any_date");
  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) return t("gallery.any_date");
  const parts = new Intl.DateTimeFormat(dateLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return [parts.day, parts.month, parts.year].filter(Boolean).join(" ");
};
const renderSharedPhotoCard = (options) => window.photosByElieGalleryCard?.renderPhotoCard?.(options) || "";
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
const seeMoreLabel = (count) => t("home.see_more_count", { count });
const seeAllLabel = (count) => t("home.see_all_count", { count });
const localizedCollectionTitle = () => {
  if (isSelectionGallery) return t("gallery.make_selection");
  if (isPanoramaGallery) return t("collection.panoramas");
  const key = `collection.${galleryKey}`;
  const translated = t(key);
  return translated && translated !== key ? translated : gallery?.title || "";
};
const likedPhotoIds = () => new Set(likedStore?.read?.().map((item) => item.photoId) || []);
const shouldShowKeyboardHints = () => window.photosByElieInputMode?.shouldShowKeyboardHints?.() ?? true;
const ensureGalleryKeyboardHint = () => {
  if (!galleryRoot || !ownerCullingEnabled || document.querySelector("[data-gallery-shortcut-hint]")) return;
  const hint = document.createElement("p");
  hint.className = "keyboard-hint gallery-keyboard-hint";
  hint.dataset.galleryShortcutHint = "";
  hint.innerHTML = [
    "Owner shortcuts:",
    `${shortcutKey("X")} block`,
    `${shortcutKey("L")} like`,
    `${shortcutKey("U")} undo`,
    ...(localModerationEnabled ? [
      `${shortcutKey("D")} discard`,
      `${shortcutKey("T")} title`,
      `${shortcutKey("K")} keywords`,
      `${shortcutKey("R")} review`
    ] : []),
    `${shortcutKey("Z")} view`,
    `${shortcutKey("Arrows")} select`,
    `${shortcutKey("Enter")} detail`,
    `${shortcutKey("Double-click")} detail`
  ].join(" <span aria-hidden=\"true\">|</span> ");
  hint.hidden = !shouldShowKeyboardHints();
  galleryRoot.before(hint);
};
window.addEventListener("photosbyelie:inputmodechange", () => {
  const hint = document.querySelector("[data-gallery-shortcut-hint]");
  if (hint) hint.hidden = !ownerCullingEnabled || !shouldShowKeyboardHints();
});

const readFilterState = () => {
  const params = new URLSearchParams(window.location.search);
  const urlQuery = params.get("q") || params.get("search") || "";
  if (isSelectionGallery) return { ...defaultFilterState, query: urlQuery };
  try {
    const savedState = JSON.parse(localStorage.getItem(filterStateKey) || "{}");
    const persistedState = Object.fromEntries(
      persistedFilterKeys.map((key) => [key, savedState[key] || defaultFilterState[key]])
    );
    return { ...defaultFilterState, ...persistedState, query: urlQuery };
  } catch {
    return { ...defaultFilterState, query: urlQuery };
  }
};

let filterState = readFilterState();

let pendingGalleryReturnState = null;
try {
  const payload = JSON.parse(sessionStorage.getItem(galleryReturnStateKey) || "null");
  const maxReturnAgeMs = 1000 * 60 * 60 * 2;
  if (
    payload?.source === "detail"
    && payload.collectionKey === galleryKey
    && payload.photoId
    && Date.now() - Number(payload.createdAt || 0) < maxReturnAgeMs
  ) {
    pendingGalleryReturnState = payload;
    if (payload.filterState && typeof payload.filterState === "object") {
      filterState = { ...defaultFilterState, ...payload.filterState };
    }
  }
} catch {
  pendingGalleryReturnState = null;
}

const writeFilterState = () => {
  if (isSelectionGallery) return;
  const persistedState = Object.fromEntries(
    persistedFilterKeys.map((key) => [key, filterState[key] || defaultFilterState[key]])
  );
  localStorage.setItem(filterStateKey, JSON.stringify(persistedState));
};

const writeDetailSequenceContext = (photos) => {
  try {
    sessionStorage.setItem(detailSequenceKey, JSON.stringify({
      source: "gallery",
      collectionKey: galleryKey,
      collectionTitle: gallery?.title || "",
      photoIds: photos.map((photo) => photo.id),
      filterState,
      visibleLimit: visibleLimit >= photos.length ? "all" : visibleLimit,
      createdAt: Date.now()
    }));
  } catch {
    // Detail navigation can fall back to the full catalog if sessionStorage is unavailable.
  }
};

const restorePendingGalleryReturn = () => {
  const photoId = pendingGalleryReturnState?.photoId;
  if (!photoId || !galleryRoot) return;
  pendingGalleryReturnState = null;
  try {
    sessionStorage.removeItem(galleryReturnStateKey);
  } catch {}
  const card = [...galleryRoot.querySelectorAll("[data-photo-id]")]
    .find((item) => item.dataset.photoId === photoId);
  if (!card) return;
  window.requestAnimationFrame(() => {
    card.scrollIntoView({ block: "center", inline: "nearest" });
    card.querySelector("[data-photo-link]")?.focus?.({ preventScroll: true });
  });
};

const clearPendingGalleryReturn = () => {
  if (!pendingGalleryReturnState) return;
  pendingGalleryReturnState = null;
  try {
    sessionStorage.removeItem(galleryReturnStateKey);
  } catch {}
};

const metadataValue = (photo, label) => (
  (photo?.metadata || []).find((item) => item.label === label)?.value || ""
);

const splitKeywordText = (value) => String(value || "")
  .split(/[;,]/)
  .map((keyword) => keyword.trim())
  .filter(Boolean);

const uniqueKeywords = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const setMetadataValue = (photo, label, value) => {
  if (!Array.isArray(photo.metadata)) photo.metadata = [];
  const item = photo.metadata.find((entry) => entry.label === label);
  if (item) {
    item.value = value;
    return;
  }
  photo.metadata.unshift({ label, value });
};

const showNativePicker = (control) => {
  if (!(control instanceof HTMLInputElement) || typeof control.showPicker !== "function") return;
  try {
    control.showPicker();
  } catch {
    // Some browsers only allow showPicker during direct user activation.
  }
};

const previewDimensions = (photo) => window.photosByEliePreviewDimensions?.(photo) || null;
const galleryFilterKeys = ["query", "orientation", "mediaType", "minSize", "mood", "subject", "dateFrom", "dateTo"];
const ownerSuperSearchText = (photo) => {
  if (!localModerationEnabled) return "";
  return ownerSuperSearchIndex.get(photo?.id)?.text || "";
};
const filterContext = () => ({
  collectionKey: galleryKey,
  collectionTitle: localizedCollectionTitle(),
  extraSearchText: ownerSuperSearchText,
});
const activeFilterCount = () => photoFilter.activeFilterCount(filterState, galleryFilterKeys);
const matchesFilterState = (photo) => photoFilter.matchesPhoto(photo, filterState, filterContext());
const sortPhotos = (photos) => photoFilter.sortItems(photos, filterState, filterContext());
const filteredVisiblePhotos = (photos = visiblePhotos()) => sortPhotos(photos.filter(matchesFilterState));

const ownerReviewFilterContext = (visibleItems = renderedGalleryPhotos, filteredItems = filteredVisiblePhotos()) => ({
  view: isSelectionGallery ? "search-gallery" : "gallery",
  collection_key: galleryKey,
  collection_title: localizedCollectionTitle(),
  filter_state: { ...filterState },
  active_filter_count: activeFilterCount(),
  query: String(filterState.query || ""),
  visible_count: visibleItems.length,
  filtered_total_count: filteredItems.length,
  visible_limit: visibleLimit >= filteredItems.length ? "all" : visibleLimit,
  url: window.location.pathname + window.location.search,
});

const uniquePhotoIds = (photos = []) => {
  const seen = new Set();
  const ids = [];
  for (const photo of photos) {
    const photoId = String(photo?.id || "").trim();
    if (!photoId || seen.has(photoId)) continue;
    seen.add(photoId);
    ids.push(photoId);
  }
  return ids;
};

const reviewQueueResultText = (result, requestedCount) => {
  const queued = Number(result?.queued_count ?? (result?.queued ? 1 : 0)) || 0;
  const already = Number(result?.already_pending_count ?? (result?.already_pending ? 1 : 0)) || 0;
  const failed = Number(result?.failed_count || 0) || 0;
  if (requestedCount === 1 && already) return "Already in title/keyword review.";
  if (requestedCount === 1 && queued) return "Sent to title/keyword review.";
  const parts = [`${queued.toLocaleString()} queued`];
  if (already) parts.push(`${already.toLocaleString()} already pending`);
  if (failed) parts.push(`${failed.toLocaleString()} failed`);
  return `${parts.join("; ")} for title/keyword review.`;
};

const queuePhotoForTitleKeywordReview = async (photo, source = "owner-gallery-r") => {
  if (!photo?.id) return null;
  if (!hiddenActions?.queueTitleKeywordReview) {
    throw new Error("Refresh Owner mode to load title/keyword review queueing.");
  }
  return hiddenActions.queueTitleKeywordReview(photo.id, {
    source,
    requestedBy: "owner",
    context: {
      ...ownerReviewFilterContext([photo]),
      photo_id: photo.id,
    },
  });
};

const queueVisiblePhotosForTitleKeywordReview = async () => {
  const visibleItems = [...renderedGalleryPhotos];
  const ids = uniquePhotoIds(visibleItems);
  if (!ids.length) {
    setGalleryStatus("No visible photos to send to title/keyword review.");
    return;
  }
  if (!hiddenActions?.queueTitleKeywordReviewMany) {
    throw new Error("Refresh Owner mode to load batch title/keyword review queueing.");
  }
  const filteredItems = filteredVisiblePhotos();
  const message = [
    `Send ${ids.length.toLocaleString()} visible media ${ids.length === 1 ? "item" : "items"} to title/keyword review?`,
    "",
    `Current filtered result set: ${filteredItems.length.toLocaleString()} ${filteredItems.length === 1 ? "item" : "items"}.`,
  ].join("\n");
  if (!window.confirm(message)) {
    setGalleryStatus("Review all visible canceled.");
    return;
  }
  const result = await hiddenActions.queueTitleKeywordReviewMany(ids, {
    source: "owner-gallery-review-all-visible",
    requestedBy: "owner",
    context: ownerReviewFilterContext(visibleItems, filteredItems),
  });
  setGalleryStatus(reviewQueueResultText(result, ids.length));
};

const syncReviewVisibleButton = (visibleItems = renderedGalleryPhotos, filteredTotal = null) => {
  if (!reviewVisibleButton) return;
  const count = uniquePhotoIds(visibleItems).length;
  reviewVisibleButton.disabled = count <= 0;
  reviewVisibleButton.textContent = count > 0
    ? `Review all visible (${count.toLocaleString()})`
    : "Review all visible";
  const total = Number(filteredTotal ?? count) || 0;
  reviewVisibleButton.title = count > 0
    ? `Send ${count.toLocaleString()} visible of ${total.toLocaleString()} filtered media items to title/keyword review`
    : "No visible media items to review";
};

const loadOwnerSuperSearchIndex = () => {
  if (!localModerationEnabled) return Promise.resolve(ownerSuperSearchIndex);
  if (ownerSuperSearchPromise) return ownerSuperSearchPromise;
  ownerSuperSearchPromise = fetch("./__photosbyelie/owner-super-search-index", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Owner expanded search is available only from the local Owner server.");
      return response.json();
    })
    .then((payload) => {
      const records = payload?.records && typeof payload.records === "object" ? payload.records : {};
      ownerSuperSearchIndex = new Map(Object.entries(records));
      return ownerSuperSearchIndex;
    })
    .catch((error) => {
      ownerSuperSearchPromise = null;
      throw error;
    });
  return ownerSuperSearchPromise;
};

const startOwnerSuperSearch = () => {
  if (!localModerationEnabled) return;
  loadOwnerSuperSearchIndex()
    .then(() => renderGallery({ scrollSelection: false }))
    .catch((error) => {
      if (String(filterState.query || "").trim()) {
        setGalleryStatus(error?.message || "Could not load Owner expanded search.");
      }
    });
};

const syncFilterToggle = () => {
  if (!filterToggle || !filterBar) return;
  const count = activeFilterCount();
  const label = t("gallery.search");
  filterToggle.textContent = count > 0 ? `${label} (${count})` : label;
  filterToggle.setAttribute("aria-expanded", filterBar.classList.contains("is-open") ? "true" : "false");
};

const syncFilterControls = () => {
  if (!filterBar) return;
  filterBar.querySelectorAll("[data-gallery-filter]").forEach((control) => {
    const key = control.dataset.galleryFilter;
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = Boolean(filterState[key]);
    } else {
      control.value = filterState[key] || (control instanceof HTMLSelectElement ? "all" : "");
    }
  });
  filterBar.querySelectorAll("[data-gallery-date-display]").forEach((display) => {
    display.textContent = formatGalleryDate(filterState[display.dataset.galleryDateDisplay]);
  });
  photoFilter.syncAdaptiveControls({
    root: filterBar,
    state: filterState,
    filterSelector: "data-gallery-filter",
    translate: t,
  });
  const searchInput = filterBar.querySelector("[data-gallery-search]");
  if (searchInput) searchInput.value = filterState.query || "";
  syncFilterToggle();
};

const ensureGalleryFilterControls = () => {
  if (filterBar || !gallery) return;
  const filterTarget = galleryActions || document.querySelector(".gallery-hero");
  if (!filterTarget) return;
  filterToggle = document.createElement("button");
  filterToggle.className = "btn secondary gallery-filter-toggle";
  filterToggle.type = "button";
  filterToggle.dataset.galleryFilterToggle = "";
  filterToggle.setAttribute("aria-controls", "gallery-filter-bar");
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.textContent = t("gallery.search");
  filterBar = document.createElement("form");
  filterBar.id = "gallery-filter-bar";
  filterBar.className = "gallery-filter-bar";
  if (isSelectionGallery) filterBar.classList.add("is-open", "is-selection-filter-open");
  filterBar.setAttribute("aria-label", t("a11y.gallery_filters"));
  filterBar.innerHTML = `
    <label class="gallery-search-label"><span data-i18n="gallery.search">Search</span><input type="search" data-gallery-search placeholder="${escapeHtml(t("gallery.search_placeholder"))}"/></label>
    <label class="gallery-date-label"><span data-i18n="gallery.date_from">Date from</span><span class="gallery-date-control"><span class="gallery-date-display" data-gallery-date-display="dateFrom" aria-hidden="true"></span><input class="gallery-date-native" type="date" data-gallery-filter="dateFrom" aria-label="${escapeHtml(t("gallery.date_from"))}"/></span></label>
    <label class="gallery-date-label"><span data-i18n="gallery.date_to">Date to</span><span class="gallery-date-control"><span class="gallery-date-display" data-gallery-date-display="dateTo" aria-hidden="true"></span><input class="gallery-date-native" type="date" data-gallery-filter="dateTo" aria-label="${escapeHtml(t("gallery.date_to"))}"/></span></label>
    <label><span data-i18n="gallery.media">Media</span><select data-gallery-filter="mediaType">
      <option value="all" data-i18n="gallery.all_media">All media</option>
      <option value="photo" data-i18n="gallery.photos">Photos</option>
      <option value="video" data-i18n="gallery.videos">Videos</option>
    </select></label>
    <label><span data-i18n="gallery.orientation">Orientation</span><select data-gallery-filter="orientation">
      <option value="all" data-i18n="gallery.all">All</option>
      <option value="pano" data-i18n="gallery.pano">Pano</option>
      <option value="landscape" data-i18n="gallery.landscape">Landscape</option>
      <option value="portrait" data-i18n="gallery.portrait">Portrait</option>
      <option value="square" data-i18n="gallery.square">Square</option>
    </select></label>
    <label><span data-i18n="gallery.min_size">Min size</span><select data-gallery-filter="minSize">
      <option value="all" data-i18n="gallery.any_size">Any size</option>
      <option value="1" data-i18n="gallery.size_1mp">1 MP+</option>
      <option value="3" data-i18n="gallery.size_3mp">3 MP+</option>
      <option value="6" data-i18n="gallery.size_6mp">6 MP+</option>
      <option value="10" data-i18n="gallery.size_10mp">10 MP+</option>
      <option value="20" data-i18n="gallery.size_20mp">20 MP+</option>
    </select></label>
    <label><span data-i18n="gallery.color_mood">Color mood</span><select data-gallery-filter="mood">
      <option value="all" data-i18n="gallery.all">All</option>
      <option value="warm" data-i18n="gallery.warm">Warm</option>
      <option value="cool" data-i18n="gallery.cool">Cool</option>
      <option value="neutral" data-i18n="gallery.neutral">Neutral</option>
      <option value="vivid" data-i18n="gallery.vivid">Vivid</option>
    </select></label>
    <label><span data-i18n="gallery.subject">Subject</span><select data-gallery-filter="subject">
      <option value="all" data-i18n="gallery.all">All</option>
      <option value="architecture" data-i18n="gallery.architecture">Architecture</option>
      <option value="water" data-i18n="gallery.water">Water/coast</option>
      <option value="art" data-i18n="gallery.art">Art/museum</option>
      <option value="people" data-i18n="gallery.people">People</option>
      <option value="nature" data-i18n="gallery.nature">Nature</option>
      <option value="city" data-i18n="gallery.city">City/travel</option>
    </select></label>
    <label class="gallery-sort-label"><span data-i18n="gallery.sort">Sort</span><select data-gallery-filter="sort">
      <option value="newest" data-i18n="gallery.newest">Newest first</option>
      <option value="oldest" data-i18n="gallery.oldest">Oldest first</option>
      <option value="collection" data-i18n="gallery.collection_order">Collection order</option>
      <option value="title" data-i18n="gallery.title">Title</option>
      <option value="megapixels-desc" data-i18n="gallery.largest_mp">Largest MP</option>
      <option value="megapixels-asc" data-i18n="gallery.smallest_mp">Smallest MP</option>
      <option value="price-desc" data-i18n="gallery.highest_price">Highest price</option>
      <option value="price-asc" data-i18n="gallery.lowest_price">Lowest price</option>
    </select></label>
    <button class="btn secondary gallery-filter-clear" type="button" data-clear-gallery-filters data-i18n="gallery.clear">Clear</button>
    ${localModerationEnabled ? `<button class="btn secondary gallery-filter-review-visible" type="button" data-owner-review-visible disabled>Review all visible</button>` : ""}
  `;
  if (galleryActions && isSelectionGallery) {
    galleryActions.after(filterBar);
  } else if (galleryActions) {
    galleryActions.append(filterToggle);
    galleryActions.after(filterBar);
  } else {
    filterTarget.after(filterToggle);
    filterToggle.after(filterBar);
  }
  window.photosByElieI18n?.apply?.();
  syncFilterControls();
  if (!isSelectionGallery) {
    filterToggle.addEventListener("click", () => {
      filterBar.classList.toggle("is-open");
      syncFilterToggle();
    });
  }
  filterBar.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  filterBar.querySelectorAll("input[type='date'][data-gallery-filter]").forEach((control) => {
    control.addEventListener("pointerdown", () => showNativePicker(control));
    control.addEventListener("click", () => showNativePicker(control));
    control.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      showNativePicker(control);
    });
  });
  filterBar.addEventListener("change", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLSelectElement || control instanceof HTMLInputElement) || !control.dataset.galleryFilter) return;
    const value = control instanceof HTMLInputElement && control.type === "checkbox"
      ? control.checked
      : control instanceof HTMLInputElement && control.type === "date"
        ? photoFilter.dateFilterValue(control.value)
        : control.value;
    filterState = { ...filterState, [control.dataset.galleryFilter]: value };
    syncFilterControls();
    writeFilterState();
    visibleLimit = pageSize;
    selectedIndex = 0;
    renderGallery();
  });
  filterBar.querySelector("[data-gallery-search]")?.addEventListener("input", (event) => {
    filterState = { ...filterState, query: event.target.value };
    syncFilterToggle();
    visibleLimit = pageSize;
    selectedIndex = 0;
    renderGallery();
  });
  filterBar.querySelector("[data-clear-gallery-filters]")?.addEventListener("click", () => {
    filterState = { ...defaultFilterState };
    writeFilterState();
    syncFilterControls();
    visibleLimit = pageSize;
    selectedIndex = 0;
    renderGallery();
  });
  reviewVisibleButton = filterBar.querySelector("[data-owner-review-visible]");
  reviewVisibleButton?.addEventListener("click", async () => {
    try {
      await queueVisiblePhotosForTitleKeywordReview();
    } catch (error) {
      setGalleryStatus(error?.message || "Could not send visible photos to title/keyword review.");
    }
  });
};

const ensureGalleryMoreButton = () => {
  if (moreButton || !galleryRoot) return;
  const controls = document.createElement("div");
  controls.className = "gallery-pagination-controls";
  moreButton = document.createElement("button");
  moreButton.className = "btn secondary gallery-more-button";
  moreButton.type = "button";
  moreButton.dataset.galleryMore = "";
  moreButton.textContent = seeMoreLabel(pageSize);
  moreButton.hidden = true;
  moreDoubleButton = document.createElement("button");
  moreDoubleButton.className = "btn secondary gallery-more-button";
  moreDoubleButton.type = "button";
  moreDoubleButton.dataset.galleryMoreDouble = "";
  moreDoubleButton.textContent = seeMoreLabel(pageSize * 2);
  moreDoubleButton.hidden = true;
  showAllButton = document.createElement("button");
  showAllButton.className = "btn secondary gallery-more-button";
  showAllButton.type = "button";
  showAllButton.dataset.galleryShowAll = "";
  showAllButton.textContent = seeAllLabel(pageSize);
  showAllButton.hidden = true;
  controls.append(moreButton, moreDoubleButton, showAllButton);
  galleryRoot.after(controls);
  const preserveScrollAfterRender = (token = showAllRenderToken) => {
    const left = window.scrollX || 0;
    const top = window.scrollY || 0;
    return () => {
      window.requestAnimationFrame(() => {
        if (token !== showAllRenderToken) return;
        window.scrollTo({ left, top, behavior: "auto" });
        window.requestAnimationFrame(() => {
          if (token === showAllRenderToken) window.scrollTo({ left, top, behavior: "auto" });
        });
      });
    };
  };
  moreButton.addEventListener("click", () => {
    showAllRenderToken += 1;
    if (showAllButton) showAllButton.disabled = false;
    const restoreScroll = preserveScrollAfterRender(showAllRenderToken);
    visibleLimit += pageSize;
    renderGallery({ scrollSelection: false });
    restoreScroll();
  });
  moreDoubleButton.addEventListener("click", () => {
    showAllRenderToken += 1;
    if (showAllButton) showAllButton.disabled = false;
    const restoreScroll = preserveScrollAfterRender(showAllRenderToken);
    visibleLimit += pageSize * 2;
    renderGallery({ scrollSelection: false });
    restoreScroll();
  });
  showAllButton.addEventListener("click", () => {
    const token = showAllRenderToken + 1;
    showAllRenderToken = token;
    showAllButton.blur();
    const addNextChunk = () => {
      if (token !== showAllRenderToken) return;
      const total = filteredVisiblePhotos().length;
      if (visibleLimit >= total) {
        if (showAllButton) showAllButton.disabled = false;
        return;
      }
      visibleLimit = Math.min(total, visibleLimit + showAllChunkSize);
      renderGallery({ scrollSelection: false });
      if (showAllButton) {
        showAllButton.disabled = visibleLimit < total;
      }
      if (visibleLimit < total) window.setTimeout(addNextChunk, showAllChunkDelayMs);
    };
    addNextChunk();
  });
};

const expandGalleryToIncludeIndex = (index) => {
  if (index < 0) return;
  visibleLimit = Math.max(visibleLimit, Math.ceil((index + 1) / pageSize) * pageSize);
};

const randomInteger = (max) => {
  if (!max) return 0;
  const cryptoObject = window.crypto || window.msCrypto;
  if (!cryptoObject?.getRandomValues) return Math.floor(Math.random() * max);
  const values = new Uint32Array(1);
  cryptoObject.getRandomValues(values);
  return values[0] % max;
};

const cryptoRandomItem = (items) => items[randomInteger(items.length)];

const diversityBucket = (photo) => {
  const captured = metadataValue(photo, "Captured");
  const text = [captured, photo?.caption, photo?.title, photo?.id].filter(Boolean).join(" ");
  const match = text.match(/\b(\d{4})[:/-]?(\d{2})[:/-]?(\d{2})(?:[ T:]+(\d{2}):?(\d{2}))?/);
  if (match?.[4] && match?.[5]) {
    const minutes = (Number(match[4]) * 60) + Number(match[5]);
    return `${match[1]}-${match[2]}-${match[3]}:${Math.floor(minutes / diversityBucketMinutes)}`;
  }
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return `id:${photo?.id || ""}`;
};

const promotedPhotos = () => {
  if (!reserveFillEnabled) return [];
  const reserveById = new Map(reserveStore.photosFor(galleryKey).map((photo) => [photo.id, photo]));
  return reserveStore.promotedIds(galleryKey)
    .map((photoId) => reserveById.get(photoId))
    .filter(Boolean);
};

const eligibleReservePhotos = (selectedIds) => {
  if (!reserveFillEnabled) return [];
  const blockedIds = new Set(hiddenActions.read());
  const regularIds = new Set((gallery?.photos || []).map((photo) => photo.id));
  const promotedIds = new Set(reserveStore.promotedIds(galleryKey));
  return reserveStore.photosFor(galleryKey).filter((photo) =>
    !blockedIds.has(photo.id)
    && !regularIds.has(photo.id)
    && !promotedIds.has(photo.id)
    && !selectedIds.has(photo.id)
  );
};

const reserveReplacementPhoto = (selected, selectedIds) => {
  const candidates = eligibleReservePhotos(selectedIds);
  if (!candidates.length) return null;
  const selectedBucketCounts = selected.reduce((counts, photo) => {
    const bucket = diversityBucket(photo);
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
    return counts;
  }, new Map());
  const candidatesByBucket = candidates.reduce((groups, photo) => {
    const bucket = diversityBucket(photo);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(photo);
    return groups;
  }, new Map());
  const lowestCount = Math.min(
    ...[...candidatesByBucket].map(([bucket]) => selectedBucketCounts.get(bucket) || 0)
  );
  const leastRepresentedBuckets = [...candidatesByBucket]
    .filter(([bucket]) => (selectedBucketCounts.get(bucket) || 0) === lowestCount)
    .map(([bucket, photos]) => ({ bucket, photos }));
  return cryptoRandomItem(cryptoRandomItem(leastRepresentedBuckets).photos);
};

const visiblePhotos = () => {
  const basePhotos = gallery?.photos || [];
  if (!ownerCullingEnabled) return window.photosByElieFilterPublicHidden?.(basePhotos) || basePhotos;

  const selected = hiddenActions
    .filterPhotos(basePhotos)
    .concat(hiddenActions.filterPhotos(promotedPhotos(), { includeReserveOnly: true }));
  const selectedIds = new Set(selected.map((photo) => photo.id));
  while (reserveFillEnabled && selected.length < basePhotos.length) {
    const nextPhoto = reserveReplacementPhoto(selected, selectedIds);
    if (!nextPhoto) break;
    reserveStore.addPromotion(galleryKey, nextPhoto.id);
    selected.push(nextPhoto);
    selectedIds.add(nextPhoto.id);
  }
  return selected;
};

const updateSelection = ({ scroll = true } = {}) => {
  const cards = [...galleryRoot.querySelectorAll("[data-photo-index]")];
  if (!cards.length) return;
  selectedIndex = Math.max(0, Math.min(selectedIndex, cards.length - 1));
  cards.forEach((card, index) => {
    card.classList.toggle("is-selected", index === selectedIndex);
    card.classList.toggle("is-batch-selected", selectedPhotoIds.has(renderedGalleryPhotos[index]?.id));
  });
  syncOwnerCullToolbar();
  if (scroll) cards[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
};

const visibleColumnCount = () => {
  const cards = [...galleryRoot.querySelectorAll("[data-photo-index]")];
  if (!cards.length) return 1;
  const firstTop = cards[0].offsetTop;
  const columns = cards.findIndex((card, index) => index > 0 && card.offsetTop !== firstTop);
  return columns > 0 ? columns : cards.length;
};

const setGalleryStatus = (message) => {
  if (galleryStatus) galleryStatus.textContent = message;
};

const galleryCardForPhotoId = (photoId) => {
  const id = String(photoId || "");
  if (!id || !galleryRoot) return null;
  return [...galleryRoot.querySelectorAll(".mock-photo[data-photo-id]")]
    .find((card) => card.dataset.photoId === id) || null;
};

const setGalleryBlockedVisual = (photoId, state = "") => {
  const card = galleryCardForPhotoId(photoId);
  if (!card) return;
  const blocking = state === "blocking";
  const blocked = state === "blocked";
  card.classList.toggle("is-review-blocking", blocking);
  card.classList.toggle("is-review-blocked", blocked);
};

const nearestVisiblePhotoIndex = () => {
  const cards = [...(galleryRoot?.querySelectorAll("[data-photo-index]") || [])];
  if (!cards.length) return selectedIndex;
  const viewportCenter = window.innerHeight / 2;
  const nearest = cards
    .map((card) => {
      const rect = card.getBoundingClientRect();
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
      return {
        index: Number(card.dataset.photoIndex || 0),
        visibleHeight,
        centerDistance
      };
    })
    .filter((item) => item.visibleHeight > 0)
    .sort((a, b) => a.centerDistance - b.centerDistance)[0];
  return Number.isInteger(nearest?.index) ? nearest.index : selectedIndex;
};

const selectedShortcutPhoto = () => {
  const photos = filteredVisiblePhotos();
  if (!photos.length) return null;
  if (!localModerationEnabled) selectedIndex = nearestVisiblePhotoIndex();
  selectedIndex = Math.max(0, Math.min(selectedIndex, photos.length - 1));
  updateSelection({ scroll: false });
  return photos[selectedIndex];
};

const galleryLayout = window.photosByElieGalleryLayout.createMasonryController({
  root: galleryRoot,
  getPhotos: () => renderedGalleryPhotos,
  densityKey,
  fitModeKey,
  defaultFitMode: isPanoramaGallery ? "fit" : "fill",
  ignoreSavedLayout: isPanoramaGallery,
  allowCull: localModerationEnabled,
});

const maxDensityColumns = () => galleryLayout.maxDensityColumns();
const preferredDensityColumns = () => galleryLayout.preferredDensityColumns();

const applyGalleryDensity = () => {
  galleryLayout.applyDensityControls({ input: densityInput, value: densityValue });
};

const setGalleryDensityColumns = (columns) => {
  const nextColumns = galleryLayout.setDensityColumns(columns);
  applyGalleryDensity();
  applyGalleryPreviewLayout();
  updateSelection({ scroll: false });
  return nextColumns;
};

const stepGalleryDensity = (direction) => {
  const currentColumns = preferredDensityColumns();
  return setGalleryDensityColumns(currentColumns + direction);
};

const stepGallerySelection = (delta, columnJump = false) => {
  const photos = filteredVisiblePhotos();
  if (!photos.length) return;
  const step = columnJump ? visibleColumnCount() * delta : delta;
  const nextIndex = Math.max(0, Math.min(selectedIndex + step, photos.length - 1));
  if (nextIndex >= visibleLimit && visibleLimit < photos.length) {
    selectedIndex = nextIndex;
    expandGalleryToIncludeIndex(nextIndex);
    renderGallery();
    return;
  }
  selectedIndex = nextIndex;
  updateSelection();
};

const preferredFitMode = () => galleryLayout.fitMode();

const applyGalleryPreviewLayout = (photos = renderedGalleryPhotos) => {
  galleryLayout.applyPreviewLayout(photos);
};

const applyGalleryFitMode = () => {
  galleryLayout.applyFitMode(fitModeButtons);
};

const setGalleryFitMode = (mode) => {
  const fitMode = galleryLayout.setFitMode(mode);
  applyGalleryFitMode();
  applyGalleryPreviewLayout();
  updateSelection({ scroll: false });
  return fitMode;
};

const galleryFitModeStatus = (mode) => {
  if (mode === "cull") return "Cull view.";
  return mode === "fill" ? "Fill view." : "Fit view.";
};

const toggleGalleryFitMode = () => {
  const currentMode = galleryLayout.fitMode();
  if (!localModerationEnabled) return setGalleryFitMode(currentMode === "fill" ? "fit" : "fill");
  const modes = ["fill", "fit", "cull"];
  const currentIndex = modes.indexOf(currentMode);
  return setGalleryFitMode(modes[(Math.max(0, currentIndex) + 1) % modes.length]);
};

const positionGalleryViewControls = () => {
  window.photosByEliePositionGalleryViewControls?.(viewControls);
};

const photoAspectRatioStyle = (photo) => {
  const dimensions = previewDimensions(photo);
  if (!dimensions?.width || !dimensions?.height) return "";
  return ` style="--photo-aspect-ratio:${dimensions.width} / ${dimensions.height}"`;
};

const syncGalleryImageDimensions = (photos = renderedGalleryPhotos) => {
  let pendingLayoutUpdate = false;
  const syncImage = (image, photo) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!photo || !width || !height) return;
    const current = previewDimensions(photo);
    if (current?.width === width && current?.height === height) return;
    photo.previewDimensions = { width, height };
    image.closest("[data-photo-link]")?.style.setProperty("--photo-aspect-ratio", `${width} / ${height}`);
    pendingLayoutUpdate = true;
  };

  galleryRoot?.querySelectorAll("[data-photo-index] img[data-photo-card-image]").forEach((image) => {
    const card = image.closest("[data-photo-index]");
    const photo = photos[Number(card?.dataset.photoIndex || 0)];
    if (image.complete) {
      syncImage(image, photo);
      return;
    }
    image.addEventListener("load", () => {
      syncImage(image, photo);
      applyGalleryPreviewLayout();
    }, { once: true });
  });

  if (pendingLayoutUpdate) applyGalleryPreviewLayout();
};

const updateGalleryLikeButtons = () => {
  const likedIds = likedPhotoIds();
  galleryRoot?.querySelectorAll("[data-gallery-like]").forEach((button) => {
    const isLiked = likedIds.has(button.dataset.photoId);
    button.classList.toggle("is-liked", isLiked);
    button.setAttribute("aria-pressed", String(isLiked));
    button.setAttribute("aria-label", t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo"));
    button.innerHTML = window.photosByElieMdIcon?.(isLiked ? "favorite" : "favoriteBorder") || "<span aria-hidden=\"true\"></span>";
  });
};

const toggleGalleryLike = (photo) => {
  if (!photo?.id || !likedStore) return null;
  if (likedStore.has?.(photo.id)) {
    likedStore.remove(photo.id);
    updateGalleryLikeButtons();
    return false;
  } else {
    likedStore.add(photo.id);
  }
  updateGalleryLikeButtons();
  return true;
};

const openOwnerMetadataModal = (photo, field) => {
  if (!localModerationEnabled || !photo) return;
  const dialog = document.createElement("dialog");
  dialog.className = "owner-metadata-modal";
  const title = "Edit title and keywords";
  const currentTitle = photo.title || "";
  const currentKeywords = metadataValue(photo, "Keywords");
  const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
  dialog.innerHTML = `
    <form class="owner-metadata-modal-form" method="dialog">
      <h2>${escapeHtml(title)}</h2>
      ${image ? `
        <figure class="owner-metadata-modal-preview">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(photo.title || title)}"/>
        </figure>
      ` : ""}
      <label>
        <span>Title</span>
        <input type="text" value="${escapeHtml(currentTitle)}" data-owner-modal-title-field/>
      </label>
      <label>
        <span>Keywords</span>
        <textarea rows="4" data-owner-modal-keywords-field>${escapeHtml(currentKeywords)}</textarea>
      </label>
      <div class="owner-metadata-modal-actions">
        <button class="btn secondary" type="button" data-owner-modal-cancel>Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector("form");
  const titleInput = dialog.querySelector("[data-owner-modal-title-field]");
  const keywordsInput = dialog.querySelector("[data-owner-modal-keywords-field]");
  const saveButton = dialog.querySelector("button[type='submit']");
  const closeWithoutSaving = () => {
    if (dialog.open) dialog.close("cancel");
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWithoutSaving();
  });
  dialog.querySelector("[data-owner-modal-cancel]")?.addEventListener("click", closeWithoutSaving);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWithoutSaving();
      return;
    }
    if (!["Enter", "Return"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (!saveButton.disabled) form.requestSubmit();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    const nextTitle = String(titleInput.value || "").trim();
    const nextKeywordList = uniqueKeywords(splitKeywordText(keywordsInput.value));
    const nextKeywords = nextKeywordList.join(", ");
    if (!nextTitle) {
      saveButton.disabled = false;
      setGalleryStatus("Title cannot be empty.");
      titleInput.focus();
      return;
    }
    const previousTitle = photo.title || "";
    const previousKeywords = currentKeywords;
    const previousKeywordList = Array.isArray(photo.keywords) ? [...photo.keywords] : splitKeywordText(previousKeywords);
    dialog.close("save");
    photo.title = nextTitle;
    photo.keywords = nextKeywordList;
    setMetadataValue(photo, "Metadata title", nextTitle);
    setMetadataValue(photo, "Keywords", nextKeywords);
    const currentId = photo.id;
    const nextIndex = filteredVisiblePhotos().findIndex((item) => item.id === currentId);
    if (nextIndex >= 0) selectedIndex = nextIndex;
    renderGallery();
    setGalleryStatus("Saving metadata...");
    try {
      await hiddenActions.updatePhotoMetadata?.(photo.id, { title: nextTitle, keywords: nextKeywords });
      setGalleryStatus(`${photo.title} metadata saved.`);
    } catch (error) {
      photo.title = previousTitle;
      photo.keywords = previousKeywordList;
      setMetadataValue(photo, "Metadata title", previousTitle);
      setMetadataValue(photo, "Keywords", previousKeywords);
      renderGallery();
      setGalleryStatus(error?.message || "Could not save metadata.");
    }
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  const initialField = field === "keywords" ? keywordsInput : titleInput;
  initialField?.focus();
  initialField?.select?.();
};

const renderGallery = ({ scrollSelection = true } = {}) => {
  const allPhotos = visiblePhotos();
  const photos = filteredVisiblePhotos(allPhotos);
  const likedIds = likedPhotoIds();
  if (isSelectionGallery && !activeFilterCount()) {
    writeDetailSequenceContext([]);
    renderedGalleryPhotos = [];
    galleryRoot.innerHTML = "";
    if (moreButton) moreButton.hidden = true;
    if (moreDoubleButton) moreDoubleButton.hidden = true;
    if (showAllButton) showAllButton.hidden = true;
    syncReviewVisibleButton([], 0);
    setGalleryStatus("");
    return;
  }
  if (pendingGalleryReturnState?.visibleLimit === "all") {
    visibleLimit = photos.length;
  } else if (pendingGalleryReturnState?.visibleLimit) {
    const savedLimit = Number(pendingGalleryReturnState.visibleLimit);
    if (Number.isFinite(savedLimit) && savedLimit > 0) visibleLimit = Math.max(pageSize, savedLimit);
  }
  writeDetailSequenceContext(photos);
  const returnPhotoId = pendingGalleryReturnState?.photoId || "";
  const returnIndex = returnPhotoId ? photos.findIndex((photo) => photo.id === returnPhotoId) : -1;
  if (returnIndex >= 0) expandGalleryToIncludeIndex(returnIndex);
  const visibleSubset = photos.slice(0, visibleLimit);
  renderedGalleryPhotos = visibleSubset;
  if (returnIndex >= 0) selectedIndex = returnIndex;
  if (returnPhotoId && returnIndex < 0) clearPendingGalleryReturn();
  if (!photos.length) {
    const filteredOut = allPhotos.length > 0 && activeFilterCount() > 0;
    galleryRoot.innerHTML = `
      <article class="mock-photo empty-gallery-card" aria-label="${gallery.title} gallery empty state">
        <span>${filteredOut ? t("gallery.no_filter_matches") : t("gallery.no_visible")}</span>
        ${filteredOut ? `<button class="btn secondary" type="button" data-clear-gallery-empty>${t("gallery.clear_filters")}</button>` : ""}
      </article>
    `;
    galleryRoot.querySelector("[data-clear-gallery-empty]")?.addEventListener("click", () => {
      filterState = { ...defaultFilterState };
      writeFilterState();
      syncFilterControls();
      visibleLimit = pageSize;
      selectedIndex = 0;
      renderGallery();
    });
    if (moreButton) moreButton.hidden = true;
    if (moreDoubleButton) moreDoubleButton.hidden = true;
    if (showAllButton) showAllButton.hidden = true;
    syncReviewVisibleButton([], photos.length);
    setGalleryStatus(filteredOut
      ? t("gallery.adjust_filters")
      : "");
    return;
  }
  selectedIndex = Math.max(0, Math.min(selectedIndex, visibleSubset.length - 1));
  galleryRoot.innerHTML = visibleSubset.map((photo, index) => {
    const href = versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`);
    const isLiked = likedIds.has(photo.id);
    const actionButtons = [];
    if (likedStore) actionButtons.push(`
          <button
            class="gallery-action-toggle gallery-like-toggle${isLiked ? " is-liked" : ""}"
            type="button"
            data-gallery-like
            data-photo-id="${escapeHtml(photo.id)}"
            aria-label="${escapeHtml(t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo"))}"
            aria-pressed="${isLiked ? "true" : "false"}"
          >
            ${window.photosByElieMdIcon?.(isLiked ? "favorite" : "favoriteBorder") || "<span aria-hidden=\"true\"></span>"}
          </button>
      `);
    if (ownerCullingEnabled) actionButtons.push(`
          <button
            class="gallery-action-toggle gallery-select-toggle${selectedPhotoIds.has(photo.id) ? " is-selected" : ""}"
            type="button"
            data-owner-select-photo
            data-photo-id="${escapeHtml(photo.id)}"
            aria-label="${selectedPhotoIds.has(photo.id) ? "Remove from selection" : "Add to selection"}"
            aria-pressed="${selectedPhotoIds.has(photo.id) ? "true" : "false"}"
          >${selectedPhotoIds.has(photo.id) ? "✓" : "+"}</button>
      `);
    const actionHtml = actionButtons.length ? `<div class="gallery-card-actions">${actionButtons.join("")}</div>` : "";
    return renderSharedPhotoCard({
      photo,
      index,
      href,
      collectionKey: galleryKey,
      actionHtml,
      ownerEditable: localModerationEnabled,
    });
  }).join("");
  galleryRoot.querySelectorAll("[data-gallery-like]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const photo = visibleSubset.find((candidate) => candidate.id === button.dataset.photoId);
      toggleGalleryLike(photo);
    });
  });
  galleryRoot.querySelectorAll("[data-owner-select-photo]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const photoId = button.dataset.photoId;
      if (selectedPhotoIds.has(photoId)) selectedPhotoIds.delete(photoId);
      else if (selectedPhotoIds.size < 500) selectedPhotoIds.add(photoId);
      renderGallery();
    });
  });
  galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
    card.addEventListener("contextmenu", (event) => {
      const index = Number(card.dataset.photoIndex || 0);
      const photo = visibleSubset[index];
      if (!photo) return;
      window.photosByElieShowMediaContextMenu?.(photo, event, {
        owner: localModerationEnabled,
        previewItems: visibleSubset,
        previewIndex: index,
        onOpenDetail: () => window.location.assign(versionedHref(card.dataset.photoHref || card.querySelector("[data-photo-link]")?.getAttribute("href"))),
      });
    });
  });
  if (localModerationEnabled) {
    galleryRoot.querySelectorAll("[data-owner-title-edit]").forEach((caption) => {
      caption.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = caption.closest("[data-photo-index]");
        selectedIndex = Number(card?.dataset.photoIndex || 0);
        updateSelection({ scroll: false });
        const selected = visibleSubset[selectedIndex];
        if (selected) openOwnerMetadataModal(selected, "title");
      });
    });
    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        event.preventDefault();
        selectedIndex = Number(card.dataset.photoIndex || 0);
        updateSelection();
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        window.location.assign(versionedHref(card.dataset.photoHref || card.querySelector("[data-photo-link]")?.getAttribute("href")));
      });
    });
  }
  if (ownerCullingEnabled && !localModerationEnabled) {
    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        event.preventDefault();
        selectedIndex = Number(card.dataset.photoIndex || 0);
        updateSelection({ scroll: false });
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        window.location.assign(versionedHref(card.dataset.photoHref || card.querySelector("[data-photo-link]")?.getAttribute("href")));
      });
    });
  }
  window.photosByElieVersionInternalLinks?.(galleryRoot);
  syncGalleryImageDimensions(visibleSubset);
  applyGalleryDensity();
  applyGalleryFitMode();
  applyGalleryPreviewLayout();
  updateSelection({ scroll: scrollSelection && returnIndex < 0 });
  if (returnIndex >= 0) restorePendingGalleryReturn();
  if (moreButton) {
    const remaining = Math.max(0, photos.length - visibleSubset.length);
    const hasMore = remaining > 0;
    moreButton.hidden = !hasMore;
    moreButton.textContent = seeMoreLabel(Math.min(pageSize, remaining));
  }
  if (moreDoubleButton) {
    const remaining = Math.max(0, photos.length - visibleSubset.length);
    moreDoubleButton.hidden = remaining <= pageSize;
    moreDoubleButton.textContent = seeMoreLabel(Math.min(pageSize * 2, remaining));
  }
  if (showAllButton) {
    const remaining = Math.max(0, photos.length - visibleSubset.length);
    showAllButton.hidden = remaining <= 0;
    showAllButton.textContent = seeAllLabel(remaining);
  }
  syncReviewVisibleButton(visibleSubset, photos.length);
  syncOwnerCullToolbar();
  const paginated = photos.length > visibleSubset.length;
  const mediaNoun = photoFilter.statusNoun(filterState, t);
  const filterStatus = activeFilterCount() || paginated
    ? t("gallery.showing_filtered_items", { count: visibleSubset.length, total: photos.length, items: mediaNoun })
    : t("gallery.showing_count_items", { count: visibleSubset.length, items: mediaNoun });
  if (ownerCullingEnabled) {
    const reserveCount = reserveFillEnabled ? reserveStore.photosFor(galleryKey).length : 0;
    setGalleryStatus(reserveCount
      ? t("gallery.reserve_available", { status: filterStatus })
      : filterStatus);
  } else {
    setGalleryStatus(filterStatus);
  }
};

if (galleryRoot && gallery) {
  document.title = `Photos By Elie | ${localizedCollectionTitle()} ${t("nav.gallery")}`;
  const seoPhotos = (gallery.photos || []).slice(0, 12).map((photo) => ({
    image: window.photosByElieMediaUrl?.(photo, "gallery") || window.photosByElieMediaUrl?.(photo, "detail") || "",
  }));
  const seoImage = seoPhotos.find((item) => item.image)?.image || window.photosByElieSeo?.defaultImage;
  const seoDescription = isSelectionGallery
    ? "Search the Photos By Elie public archive by title, place, subject, mood, size, orientation, and media type."
    : gallery.description || `Browse ${localizedCollectionTitle()} travel photography and digital wall-art downloads by Photos By Elie.`;
  window.photosByElieSeo?.applyPageMeta({
    title: `Photos By Elie | ${localizedCollectionTitle()} Gallery`,
    description: seoDescription,
    url: window.photosByElieSeo.pageUrl("/gallery.html", { gallery: galleryKey }),
    image: seoImage,
    imageAlt: `${localizedCollectionTitle()} photo gallery`,
    jsonLd: window.photosByElieSeo.collectionPageJsonLd({
      name: `${localizedCollectionTitle()} Gallery`,
      description: seoDescription,
      url: window.photosByElieSeo.pageUrl("/gallery.html", { gallery: galleryKey }),
      image: seoImage,
      photos: seoPhotos,
    }),
  });
  const currentNav = document.querySelector("[data-nav-current]");
  if (currentNav) {
    currentNav.dataset.i18n = isSelectionGallery ? "gallery.make_selection" : `collection.${galleryKey}`;
    currentNav.textContent = localizedCollectionTitle();
    currentNav.setAttribute("href", versionedHref(galleryHrefForKey(galleryKey)));
  }
  if (document.querySelector("[data-gallery-number]")) document.querySelector("[data-gallery-number]").textContent = `Collection ${gallery.number}`;
  const titleRoot = document.querySelector("[data-gallery-title]");
  if (titleRoot) {
    titleRoot.dataset.i18n = isSelectionGallery ? "gallery.make_selection" : `collection.${galleryKey}`;
    titleRoot.textContent = localizedCollectionTitle();
  }
  if (document.querySelector("[data-gallery-description]")) document.querySelector("[data-gallery-description]").textContent = gallery.description;
  galleryRoot.classList.add(gallery.accent);
  galleryRoot.setAttribute("aria-label", `${localizedCollectionTitle()} ${t("nav.photos").toLowerCase()}`);
  ensureGalleryFilterControls();
  ensureOwnerCullToolbar();
  ensureGalleryMoreButton();
  ensureGalleryKeyboardHint();
  renderGallery();
  startOwnerSuperSearch();

  if (!viewControls) {
    viewControls = document.createElement("div");
    viewControls.className = "gallery-view-controls";
    viewControls.setAttribute("aria-label", t("a11y.gallery_view_controls"));
    const densityControl = document.createElement("label");
    densityControl.className = "gallery-density-control";
    densityControl.innerHTML = `
      <span data-i18n="gallery.grid">Grid</span>
      <input type="range" min="1" max="${maxDensityColumns()}" step="1" value="${preferredDensityColumns()}" data-gallery-density/>
      <b data-gallery-density-value>${preferredDensityColumns()}</b>
    `;
    const fitControl = document.createElement("div");
    fitControl.className = "gallery-fit-control";
    fitControl.setAttribute("role", "group");
    fitControl.setAttribute("aria-label", t("a11y.gallery_image_fit"));
    fitControl.innerHTML = `
      <button type="button" data-gallery-fit-mode="fit" aria-pressed="true" data-i18n="gallery.fit">Fit</button>
      <button type="button" data-gallery-fit-mode="fill" aria-pressed="false" data-i18n="gallery.fill">Fill</button>
    `;
    const topButton = document.createElement("button");
    topButton.className = "gallery-top-button";
    topButton.type = "button";
    topButton.dataset.galleryBackToTop = "";
    topButton.setAttribute("aria-label", t("a11y.back_to_top"));
    topButton.innerHTML = `<span aria-hidden="true">↑</span>`;
    viewControls.append(densityControl, fitControl, topButton);
    const headerControls = document.querySelector(".header-controls");
    if (headerControls) {
      viewControls.classList.add("is-header-mounted");
      headerControls.insertBefore(viewControls, headerControls.querySelector(".site-version-badge"));
    } else {
      document.body.append(viewControls);
    }
    densityInput = densityControl.querySelector("[data-gallery-density]");
    densityValue = densityControl.querySelector("[data-gallery-density-value]");
    fitModeButtons = [...fitControl.querySelectorAll("[data-gallery-fit-mode]")];
    topButton.addEventListener("click", () => {
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
    densityInput.addEventListener("input", () => {
      setGalleryDensityColumns(densityInput.value);
    });
    fitControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-gallery-fit-mode]");
      if (!button) return;
      setGalleryFitMode(button.dataset.galleryFitMode);
    });
    window.addEventListener("resize", () => {
      applyGalleryDensity();
      applyGalleryPreviewLayout();
      if (!viewControls?.classList.contains("is-header-mounted")) positionGalleryViewControls();
      updateSelection({ scroll: false });
    });
    if (!viewControls.classList.contains("is-header-mounted")) {
      window.addEventListener("scroll", positionGalleryViewControls, { passive: true });
    }
    window.addEventListener("load", () => {
      applyGalleryPreviewLayout();
      updateSelection({ scroll: false });
    }, { once: true });
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        applyGalleryPreviewLayout();
        updateSelection({ scroll: false });
      }).catch(() => {});
    }
    applyGalleryDensity();
    applyGalleryFitMode();
    if (!viewControls.classList.contains("is-header-mounted")) positionGalleryViewControls();
    window.photosByElieI18n?.apply?.();
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
    }
    if (event.key === " ") {
      const selected = selectedShortcutPhoto();
      if (!selected) return;
      const photos = filteredVisiblePhotos();
      window.photosByElieOpenFinderPreview?.(selected, {
        owner: localModerationEnabled,
        items: photos,
        index: Math.max(0, photos.findIndex((item) => item.id === selected.id)),
      });
      event.preventDefault();
      return;
    }
    if (event.key === "g" || event.key === "G") {
      const nextColumns = stepGalleryDensity(event.key === "G" ? 1 : -1);
      setGalleryStatus(`Grid ${nextColumns}.`);
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "l") {
      const selected = selectedShortcutPhoto();
      const liked = toggleGalleryLike(selected);
      if (selected && liked !== null) {
        setGalleryStatus(t(liked ? "detail.added_liked" : "detail.removed_liked", { title: selected.title }));
        event.preventDefault();
      }
      return;
    }
    if (event.key.toLowerCase() === "z") {
      const nextMode = toggleGalleryFitMode();
      setGalleryStatus(galleryFitModeStatus(nextMode));
      event.preventDefault();
    }
  });
  window.addEventListener("photosbyelie:owneractionerror", (event) => {
    setGalleryStatus(event.detail?.message || "Owner action failed.");
  });

  if (ownerCullingEnabled) {
    window.addEventListener("keydown", async (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
      }
      const photos = filteredVisiblePhotos();
      if (!photos.length) return;
      if (event.key === "ArrowRight") {
        stepGallerySelection(1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowLeft") {
        stepGallerySelection(-1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowDown") {
        stepGallerySelection(1, true);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp") {
        stepGallerySelection(-1, true);
        event.preventDefault();
        return;
      }
      if (event.key === "Enter") {
        const selected = photos[selectedIndex];
        if (!selected) return;
        window.location.assign(versionedHref(`./photo.html?id=${selected.id}`));
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "t" || event.key.toLowerCase() === "k") {
        if (!localModerationEnabled) return;
        const selected = photos[selectedIndex];
        if (!selected) return;
        openOwnerMetadataModal(selected, event.key.toLowerCase() === "k" ? "keywords" : "title");
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "r") {
        if (!localModerationEnabled) return;
        const selected = photos[selectedIndex];
        if (!selected) return;
        try {
          const result = await queuePhotoForTitleKeywordReview(selected, "owner-gallery-r");
          setGalleryStatus(`${selected.title}: ${reviewQueueResultText(result, 1)}`);
        } catch (error) {
          setGalleryStatus(error?.message || "Could not send photo to title/keyword review.");
        }
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "x" || event.key.toLowerCase() === "b" || event.key.toLowerCase() === "h") {
        const selected = photos[selectedIndex];
        const ids = selectedPhotoIds.size ? [...selectedPhotoIds].slice(0, 500) : [selected?.id].filter(Boolean);
        if (!ids.length) return;
        try {
          ids.forEach((photoId) => setGalleryBlockedVisual(photoId, "blocking"));
          setGalleryStatus(`${ids.length} photo${ids.length === 1 ? "" : "s"} moving to Waste Basket...`);
          if (ids.length === 1) await hiddenActions.mark(ids[0]);
          else await hiddenActions.markMany(ids);
          lastCulledPhotoIds = ids;
          selectedPhotoIds.clear();
          selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
          renderGallery();
          setGalleryStatus(`${ids.length} photo${ids.length === 1 ? "" : "s"} moved to Waste Basket.`);
        } catch (error) {
          ids.forEach((photoId) => setGalleryBlockedVisual(photoId, ""));
          setGalleryStatus(error?.message || "Could not move photo to Waste Basket.");
        }
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "d") {
        if (!localModerationEnabled) return;
        const selected = photos[selectedIndex];
        if (!selected) return;
        const confirmed = window.confirm(`Discard "${selected.title}"?\n\nThis removes it from the catalog and keeps a tombstone so imports do not bring it back.`);
        if (!confirmed) {
          event.preventDefault();
          return;
        }
        try {
          await hiddenActions.discard?.(selected.id);
          selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
          renderGallery();
          setGalleryStatus(`${selected.title} discarded.`);
        } catch (error) {
          setGalleryStatus(error?.message || "Could not discard photo.");
        }
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() !== "u") return;
      let undoneId = null;
      try {
        if (lastCulledPhotoIds.length > 1) {
          const restored = await hiddenActions.undoMany(lastCulledPhotoIds);
          undoneId = restored[0] || null;
        } else {
          undoneId = await hiddenActions.undo(lastCulledPhotoIds[0] || null);
        }
        lastCulledPhotoIds = [];
      } catch (error) {
        setGalleryStatus(error?.message || "Could not undo the last basket move.");
        event.preventDefault();
        return;
      }
      renderGallery();
      if (!undoneId) {
        setGalleryStatus("No local basket move to undo.");
        return;
      }
      const nextPhotos = filteredVisiblePhotos();
      const restoredIndex = nextPhotos.findIndex((photo) => photo.id === undoneId);
      if (restoredIndex >= 0) {
        selectedIndex = restoredIndex;
        expandGalleryToIncludeIndex(restoredIndex);
      }
      updateSelection();
      setGalleryStatus("Last local basket move undone.");
      event.preventDefault();
    });

    window.addEventListener("photosbyelie:hiddenchange", () => {
      gallery = galleryForKey(galleryKey);
      renderGallery();
    });

    if (reserveFillEnabled) {
      reserveStore.load().then(() => {
        renderGallery();
      });
    }
  }
  window.photosByElieHiddenBlacklistReady?.then(() => {
    if (!localModerationEnabled) renderGallery();
  });
  window.addEventListener("photosbyelie:hiddenblacklistchange", () => {
    if (!localModerationEnabled) renderGallery();
  });
  window.addEventListener("photosbyelie:languagechange", () => {
    if (gallery) {
      document.title = `Photos By Elie | ${localizedCollectionTitle()} ${t("nav.gallery")}`;
      document.querySelector("[data-nav-current]").textContent = localizedCollectionTitle();
      document.querySelector("[data-gallery-title]").textContent = localizedCollectionTitle();
      syncFilterControls();
      renderGallery();
    }
  });
window.addEventListener("photosbyelie:likedchange", updateGalleryLikeButtons);
}
})().catch((error) => {
  const status = document.querySelector("[data-gallery-status]");
  if (status) status.textContent = error?.message || "Could not load gallery.";
}));
