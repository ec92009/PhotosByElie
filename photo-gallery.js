((async () => {
const pbeOwnerGalleryKey = "pbe-owner";
const requestedGalleryKey = String(new URLSearchParams(window.location.search).get("gallery") || "").trim().toLowerCase();
if (requestedGalleryKey === pbeOwnerGalleryKey) {
  const customerGalleryURL = new URL("./gallery.html", window.location.href);
  customerGalleryURL.searchParams.set("gallery", "selection");
  window.location.replace(customerGalleryURL.href);
  return;
}
const markNoIndex = () => {
  if (document.head.querySelector('meta[name="robots"]')) return;
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex,nofollow";
  document.head.append(robots);
};
if (requestedGalleryKey === pbeOwnerGalleryKey) {
  document.body.dataset.gallery = pbeOwnerGalleryKey;
  markNoIndex();
}
if (typeof window.photosByEliePageReady !== "function") throw new Error("Gallery readiness is unavailable.");
await window.photosByEliePageReady();
const galleryWindowModel = await import("./gallery-window.mjs");
const galleryHrefForKey = (key) => `./gallery.html?gallery=${encodeURIComponent(key)}`;
const selectionGalleryKey = "selection";
const selectionGalleryAliases = new Set([selectionGalleryKey, "make-selection", "make-your-selection"]);
const panoramaGalleryKey = "panoramas";
const sharedGalleryKey = "shared";
const panoramaGalleryAliases = new Set([panoramaGalleryKey, "pano", "panos", "panorama"]);
const baseGalleryCollections = ["france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"];
const selectionGalleryCollections = baseGalleryCollections;
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
  if (normalized === pbeOwnerGalleryKey) return pbeOwnerGalleryKey;
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
const isSharedGallery = galleryKey === sharedGalleryKey;
const isPBEOwnerGallery = galleryKey === pbeOwnerGalleryKey;
document.body.dataset.gallery = galleryKey;
if (isSharedGallery || isPBEOwnerGallery) {
  markNoIndex();
}
let gallery = galleryForKey(galleryKey);
const galleryRoot = document.querySelector("[data-gallery-root]");
const galleryStatus = document.querySelector("[data-gallery-status]");
const hiddenActions = window.photosByElieHiddenActions;
const reserveStore = window.photosByElieReserve;
const likedStore = window.photosByElieLiked;
const galleryCommandModel = window.photosByElieGalleryCommands;
if (!galleryCommandModel?.createRegistry) throw new Error("Gallery command registry is unavailable.");
const tapFirstInput = Boolean(window.photosByElieInputMode?.isTapFirst?.());
const ownerCullingEnabled = isPBEOwnerGallery && Boolean(hiddenActions?.cullingEnabled) && !tapFirstInput;
const localModerationEnabled = Boolean(hiddenActions?.enabled) && ownerCullingEnabled;
const fullOwnerToolsEnabled = localModerationEnabled && !isPBEOwnerGallery;
const galleryRole = ownerCullingEnabled ? "owner" : "visitor";
const ownerCommandAdapter = window.photosByElieOwnerGalleryCommands || {};
const reserveFillEnabled = false;
const galleryActions = document.querySelector("[data-gallery-actions]");
const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
const detailHrefForPhotoId = (photoId) => {
  const detailParams = new URLSearchParams({ id: String(photoId || "") });
  if (isSharedGallery) detailParams.set("gallery", sharedGalleryKey);
  if (isPBEOwnerGallery) detailParams.set("gallery", pbeOwnerGalleryKey);
  return versionedHref(`./photo.html?${detailParams.toString()}`);
};
let selectedIndex = 0;
const selectedPhotoIds = new Set();
let selectionAnchorPhotoId = "";
let primaryPhotoId = "";
let selectionRecency = [];
let selectionDirection = "forward";
let lastUndoableOwnerAction = null;
const selectionErrors = new Map();
let gallerySelectionCount = null;
let galleryCommandBar = null;
let galleryCommandRegistry = null;
let syncGalleryCommandBar = () => {};
const galleryActionLabelsKey = "photosbyelie-gallery-action-labels";
const selectionLimit = galleryCommandModel.MAX_SELECTION;
const pageSize = galleryWindowModel.GALLERY_PAGE_SIZE;
const maxRenderedPhotos = galleryWindowModel.MAX_RENDERED_GALLERY_PHOTOS;
const densityKey = "photosbyelie-gallery-columns";
const fitModeKey = "photosbyelie-gallery-fit-mode";
let renderedGalleryPhotos = [];
let visibleStart = 0;
let visibleLimit = pageSize;
let lessButton = null;
let lessDoubleButton = null;
let lessQuadButton = null;
let moreButton = null;
let moreDoubleButton = null;
let moreQuadButton = null;
let showAllRenderToken = 0;
let paginationAnchorState = null;
let paginationAnchorObserver = null;
let paginationAnchorRaf = 0;
let paginationAnchorCleanupTimer = 0;
const filterStateKey = `photosbyelie-gallery-filters-${galleryKey}`;
const detailSequenceKey = "photosbyelie-detail-sequence";
const galleryReturnStateKey = "photosbyelie-gallery-return-state";
let galleryCheckpointWriteTimer = 0;
let pendingDurableGalleryCheckpoint = null;
let appliedGalleryCheckpointAt = 0;
let galleryCheckpointRestoreTimer = 0;
let galleryCheckpointRestoreActive = false;
let detailRoundTripNonce = globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const diversityBucketMinutes = 10;
const photoFilter = window.photosByEliePhotoFilter;
const galleryDatePicker = window.photosByElieGalleryDatePicker || {};
const galleryDateRange = galleryDatePicker.dateRangeFromPhotos?.(gallery?.photos || []) || { dateFrom: "", dateTo: "" };
const defaultFilterState = {
  query: "",
  orientation: "all",
  sort: "newest",
  dateFrom: galleryDateRange.dateFrom,
  dateTo: galleryDateRange.dateTo,
  ownerMinRating: 0,
  ownerColors: "none,red,yellow,green,blue",
  ownerPlacements: "picked",
};
const persistedFilterKeys = ["query", "orientation", "dateFrom", "dateTo"];
const storedFilterKeys = [...persistedFilterKeys, ...(isPBEOwnerGallery ? ["ownerMinRating", "ownerColors", "ownerPlacements"] : [])];
const publicFilterState = (state = {}) => Object.fromEntries(
  Object.keys(defaultFilterState).map((key) => [key, state[key] ?? defaultFilterState[key]])
);
const galleryFilterCollapseBreakpoint = 760;
let filterBar = null;
let filterToggle = null;
let lastGalleryFilterFocus = null;
let ownerSuperSearchIndex = new Map();
let ownerSuperSearchPromise = null;

const syncGallerySelectionToolbar = () => {
  if (!gallerySelectionCount) return;
  const count = selectedPhotoIds.size;
  gallerySelectionCount.textContent = `${count} selected`;
  syncGalleryCommandBar();
};

const ensureGallerySelectionToolbar = () => {
  if (gallerySelectionCount) return;
  gallerySelectionCount = document.querySelector("[data-owner-cull-count]");
  if (!gallerySelectionCount) return;
  gallerySelectionCount.hidden = false;
  gallerySelectionCount.setAttribute("aria-label", `${galleryRole === "owner" ? "Owner" : "Visitor"} gallery selection count`);
  syncGallerySelectionToolbar();
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

const datePickerYears = () => galleryDatePicker.yearsFromPhotos?.(gallery?.photos || []) || [];
const validDateFilterValue = (value) => {
  const normalized = String(value || "").trim();
  const parts = galleryDatePicker.partsFromDateValue?.(normalized);
  if (parts?.year) return `${parts.year}-${parts.month}-${parts.day}`;
  return photoFilter.dateFilterValue(normalized);
};
const normalizeDateFilterState = (state = {}) => {
  const normalized = galleryDatePicker.normalizeRange?.({
    dateFrom: validDateFilterValue(state.dateFrom),
    dateTo: validDateFilterValue(state.dateTo),
  });
  if (!normalized) {
    return {
      ...state,
      dateFrom: validDateFilterValue(state.dateFrom),
      dateTo: validDateFilterValue(state.dateTo),
    };
  }
  return { ...state, dateFrom: normalized.dateFrom, dateTo: normalized.dateTo };
};
const syncDatePickerControls = () => {
  if (!filterBar) return;
  for (const key of ["dateFrom", "dateTo"]) {
    const parts = inlineDatePickerPartsFor(key);
    const titleKey = key === "dateTo" ? "gallery.date_to_title" : "gallery.date_from_title";
    for (const part of ["day", "month", "year"]) {
      const control = filterBar.querySelector(`[data-gallery-date-part="${part}"][data-gallery-date-endpoint="${key}"]`);
      setInlineDatePickerOptions(control, inlineDatePickerOptions(part, parts), parts[part]);
      control?.setAttribute("aria-label", `${t(titleKey)} ${t(`gallery.date_${part}`)}`);
      if (part === "day" && control) control.disabled = !parts.year || !parts.month;
    }
    const hidden = filterBar.querySelector(`[data-gallery-filter="${key}"]`);
    if (hidden) hidden.value = filterState[key] || "";
  }
};
const syncDateFilterUrl = (state) => {
  if (!window.history?.replaceState || !window.location?.href) return;
  const url = new URL(window.location.href);
  ["q", "search", "mediaType", "media_type", "dateFrom", "date_from", "from", "dateTo", "date_to", "to"]
    .forEach((key) => url.searchParams.delete(key));
  const query = String(state.query || "");
  if (query.trim()) url.searchParams.set("q", query);
  if (state.dateFrom) url.searchParams.set("dateFrom", state.dateFrom);
  if (state.dateTo) url.searchParams.set("dateTo", state.dateTo);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};
const syncSearchFilterUrl = (state) => {
  if (!window.history?.replaceState || !window.location?.href) return;
  const url = new URL(window.location.href);
  ["q", "search", "mediaType", "media_type"].forEach((key) => url.searchParams.delete(key));
  const query = String(state.query || "");
  if (query.trim()) url.searchParams.set("q", query);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

const inlineEmptyDatePickerParts = () => ({ year: "", month: "", day: "" });
const inlineDatePickerSelections = {
  dateFrom: inlineEmptyDatePickerParts(),
  dateTo: inlineEmptyDatePickerParts(),
};
const inlineCleanDatePickerParts = (parts = {}) => {
  const year = /^\d{4}$/.test(String(parts.year || "")) ? String(parts.year) : "";
  const month = /^(0[1-9]|1[0-2])$/.test(String(parts.month || "")) ? String(parts.month) : "";
  const maximumDay = year && month
    ? galleryDatePicker.daysInMonth?.(year, Number(month)) || 0
    : 31;
  const day = /^\d{2}$/.test(String(parts.day || ""))
    && Number(parts.day) >= 1
    && Number(parts.day) <= maximumDay
    ? String(parts.day)
    : "";
  return { year, month, day };
};
const seedInlineDatePickerSelections = () => {
  for (const endpoint of ["dateFrom", "dateTo"]) {
    inlineDatePickerSelections[endpoint] = inlineCleanDatePickerParts(
      galleryDatePicker.partsFromDateValue?.(filterState[endpoint]),
    );
  }
};
const inlineDatePickerPartsFor = (endpoint) => inlineDatePickerSelections[endpoint] || inlineEmptyDatePickerParts();
const inlineDatePickerYears = () => {
  const selectedYears = Object.values(inlineDatePickerSelections)
    .map((parts) => parts.year)
    .filter(Boolean);
  return [...new Set([...datePickerYears(), ...selectedYears])]
    .sort((left, right) => Number(right) - Number(left));
};
const inlineDatePickerPartOrder = () => dateLocale().startsWith("en")
  ? ["year", "month", "day"]
  : ["day", "month", "year"];
const inlineDatePickerMonthLabel = (month) => new Intl.DateTimeFormat("en-US", { month: "short" })
  .format(new Date(Date.UTC(2020, month - 1, 1)))
  .toUpperCase();
const inlineDatePickerOptions = (part, parts = {}) => {
  if (part === "day") {
    const count = parts.year && parts.month
      ? galleryDatePicker.daysInMonth?.(parts.year, Number(parts.month)) || 0
      : 31;
    return [
      { value: "", label: "DD" },
      ...Array.from({ length: count }, (_, index) => {
        const day = String(index + 1).padStart(2, "0");
        return { value: day, label: day };
      }),
    ];
  }
  if (part === "month") {
    return [
      { value: "", label: "MMM" },
      ...Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, "0");
        return { value: month, label: inlineDatePickerMonthLabel(index + 1) };
      }),
    ];
  }
  return [
    { value: "", label: t("gallery.any_year") },
    ...inlineDatePickerYears().map((year) => ({ value: year, label: year })),
  ];
};
const setInlineDatePickerOptions = (select, options, value) => {
  if (!select) return;
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
  )).join("");
  select.value = options.some((option) => option.value === value) ? value : "";
};
const inlineDatePickerValue = (endpoint, edge) => (
  galleryDatePicker.dateValueFromParts?.(inlineDatePickerPartsFor(endpoint), edge) || ""
);
const commitInlineDatePickerControl = (control) => {
  const endpoint = control.dataset.galleryDateEndpoint;
  const part = control.dataset.galleryDatePart;
  if (!endpoint || !part || !["dateFrom", "dateTo"].includes(endpoint)) return;
  inlineDatePickerSelections[endpoint] = inlineCleanDatePickerParts({
    ...inlineDatePickerPartsFor(endpoint),
    [part]: control.value,
  });
  const values = {
    dateFrom: inlineDatePickerValue("dateFrom", "start"),
    dateTo: inlineDatePickerValue("dateTo", "end"),
  };
  const normalized = galleryDatePicker.normalizeRange?.(values)
    || { ...values, swapped: false };
  if (normalized.swapped) {
    [inlineDatePickerSelections.dateFrom, inlineDatePickerSelections.dateTo] = [
      inlineDatePickerSelections.dateTo,
      inlineDatePickerSelections.dateFrom,
    ];
  }
  filterState = {
    ...filterState,
    dateFrom: normalized.dateFrom,
    dateTo: normalized.dateTo,
  };
  writeFilterState();
  syncDateFilterUrl(filterState);
  syncFilterControls();
  cancelPaginationSequence();
  resetGalleryWindow();
  selectedIndex = 0;
  renderGallery({ scrollSelection: false });
  if (normalized.swapped) setGalleryStatus(t("gallery.date_range_swapped"));
};
const renderSharedPhotoCard = (options) => window.photosByElieGalleryCard?.renderPhotoCard?.(options) || "";
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
const localizedCollectionTitle = () => {
  if (isSelectionGallery) return t("gallery.make_selection");
  if (isPanoramaGallery) return t("collection.panoramas");
  if (isSharedGallery) return t("collection.shared");
  if (isPBEOwnerGallery) {
    const ownerGallery = window.photosByElieData?.[pbeOwnerGalleryKey];
    return String(ownerGallery?.title || "PBE Owner").trim() || "PBE Owner";
  }
  const key = `collection.${galleryKey}`;
  const translated = t(key);
  return translated && translated !== key ? translated : gallery?.title || "";
};
const setCollectionLabel = (element) => {
  if (!element) return;
  if (isPBEOwnerGallery) delete element.dataset.i18n;
  else element.dataset.i18n = isSelectionGallery ? "gallery.make_selection" : `collection.${galleryKey}`;
  element.textContent = localizedCollectionTitle();
};
const likedPhotoIds = () => new Set(likedStore?.read?.().map((item) => item.photoId) || []);
const primaryShortcutLabel = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "")
  ? "⌘"
  : "Ctrl+";

const resetGalleryWindow = () => {
  visibleStart = 0;
  visibleLimit = pageSize;
};

const readFilterState = () => {
  const params = new URLSearchParams(window.location.search);
  const urlQueryKey = ["q", "search"].find((key) => params.has(key));
  const urlQueryPresent = Boolean(urlQueryKey);
  const urlQuery = urlQueryPresent ? params.get(urlQueryKey) || "" : "";
  const queryDate = (keys) => {
    const key = keys.find((candidate) => params.has(candidate));
    return key ? { present: true, value: validDateFilterValue(params.get(key)) } : { present: false, value: "" };
  };
  const urlDateFrom = queryDate(["dateFrom", "date_from", "from"]);
  const urlDateTo = queryDate(["dateTo", "date_to", "to"]);
  const urlState = {
    ...defaultFilterState,
    query: urlQuery,
    dateFrom: urlDateFrom.value,
    dateTo: urlDateTo.value,
  };
  if (isSelectionGallery) return normalizeDateFilterState(urlState);
  try {
    const savedState = JSON.parse(localStorage.getItem(filterStateKey) || "{}");
    const persistedState = Object.fromEntries(
      storedFilterKeys.map((key) => [key, savedState[key] ?? defaultFilterState[key]])
    );
    return normalizeDateFilterState({
      ...defaultFilterState,
      ...persistedState,
      query: urlQueryPresent ? urlQuery : persistedState.query,
      dateFrom: urlDateFrom.present ? urlDateFrom.value : persistedState.dateFrom,
      dateTo: urlDateTo.present ? urlDateTo.value : persistedState.dateTo,
    });
  } catch {
    return normalizeDateFilterState(urlState);
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
    && payload.navigationNonce
    && Date.now() - Number(payload.createdAt || 0) < maxReturnAgeMs
  ) {
    pendingGalleryReturnState = payload;
    detailRoundTripNonce = String(payload.navigationNonce);
    (Array.isArray(payload.selectionIds) ? payload.selectionIds : [])
      .slice(0, selectionLimit)
      .forEach((photoId) => selectedPhotoIds.add(String(photoId)));
    primaryPhotoId = String(payload.primaryPhotoId || payload.photoId || "");
    selectionRecency = (Array.isArray(payload.selectionRecency) ? payload.selectionRecency : [...selectedPhotoIds])
      .map(String)
      .filter((photoId, index, items) => photoId && items.indexOf(photoId) === index)
      .slice(-selectionLimit);
    if (payload.filterState && typeof payload.filterState === "object") {
      filterState = normalizeDateFilterState(publicFilterState(payload.filterState));
    }
  }
} catch {
  pendingGalleryReturnState = null;
}

const explicitGalleryLocation = (() => {
  const params = new URLSearchParams(window.location.search);
  const filterState = {};
  const keys = [];
  const queryKey = ["q", "search"].find((key) => params.has(key));
  if (queryKey) {
    keys.push("query");
    filterState.query = params.get(queryKey) || "";
  }
  const addDate = (stateKey, aliases) => {
    const queryKey = aliases.find((key) => params.has(key));
    if (!queryKey) return;
    keys.push(stateKey);
    filterState[stateKey] = validDateFilterValue(params.get(queryKey));
  };
  addDate("dateFrom", ["dateFrom", "date_from", "from"]);
  addDate("dateTo", ["dateTo", "date_to", "to"]);
  return { filterState, keys };
})();

const durableGalleryCheckpoint = () => (
  window.photosByElieGalleryCheckpoints?.read?.()
    ?.find((checkpoint) => checkpoint.collectionKey === galleryKey)
  || null
);

const stageDurableGalleryCheckpoint = (checkpoint, { rerender = false } = {}) => {
  const updatedAt = Date.parse(checkpoint?.updatedAt || 0);
  if (
    pendingGalleryReturnState
    || !galleryWindowModel.checkpointMatchesExplicitFilter({
      checkpointFilter: checkpoint?.filterState,
      explicitFilter: explicitGalleryLocation.filterState,
      explicitKeys: explicitGalleryLocation.keys,
    })
    || checkpoint?.collectionKey !== galleryKey
    || !checkpoint?.photoId
    || !Number.isFinite(updatedAt)
    || updatedAt <= appliedGalleryCheckpointAt
  ) return false;
  filterState = normalizeDateFilterState(publicFilterState(checkpoint.filterState || {}));
  visibleStart = Math.max(0, Math.floor(Number(checkpoint.windowStart) || 0));
  visibleLimit = Math.max(visibleStart + 1, Math.floor(Number(checkpoint.windowEnd) || visibleStart + pageSize));
  if (visibleLimit - visibleStart > maxRenderedPhotos) visibleStart = visibleLimit - maxRenderedPhotos;
  pendingDurableGalleryCheckpoint = checkpoint;
  appliedGalleryCheckpointAt = updatedAt;
  if (rerender) {
    seedInlineDatePickerSelections();
    writeFilterState();
    syncFilterControls();
    selectedIndex = 0;
    renderGallery({ scrollSelection: false });
  }
  return true;
};

stageDurableGalleryCheckpoint(durableGalleryCheckpoint());

seedInlineDatePickerSelections();

const writeFilterState = () => {
  if (isSelectionGallery) return;
  const persistedState = Object.fromEntries(
    storedFilterKeys.map((key) => [key, filterState[key] ?? defaultFilterState[key]])
  );
  localStorage.setItem(filterStateKey, JSON.stringify(persistedState));
};

const writeDetailSequenceContext = (photos) => {
  try {
    const anchorCard = checkpointAnchorCard();
    sessionStorage.setItem(detailSequenceKey, JSON.stringify({
      source: "gallery",
      collectionKey: galleryKey,
      collectionTitle: gallery?.title || "",
      photoIds: photos.map((photo) => photo.id),
      selectionIds: [...selectedPhotoIds],
      primaryPhotoId,
      selectionRecency,
      navigationNonce: detailRoundTripNonce,
      filterState: publicFilterState(filterState),
      visibleStart,
      visibleLimit,
      anchorPhotoId: anchorCard?.dataset.photoId || "",
      anchorOffset: anchorCard?.getBoundingClientRect().top || 0,
      createdAt: Date.now()
    }));
  } catch {
    // Detail navigation can fall back to the full catalog if sessionStorage is unavailable.
  }
};

const checkpointAnchorCard = () => {
  const cards = [...(galleryRoot?.querySelectorAll("[data-photo-index][data-photo-id]") || [])];
  if (!cards.length) return null;
  return cards.reduce((closest, card) => (
    Math.abs(card.getBoundingClientRect().top) < Math.abs(closest.getBoundingClientRect().top) ? card : closest
  ));
};

const persistGalleryCheckpoint = () => {
  window.clearTimeout(galleryCheckpointWriteTimer);
  galleryCheckpointWriteTimer = 0;
  if (galleryCheckpointRestoreActive) return;
  if (isSelectionGallery || !renderedGalleryPhotos.length) return;
  const card = checkpointAnchorCard();
  const photoId = card?.dataset.photoId || renderedGalleryPhotos[0]?.id || "";
  if (!photoId) return;
  const checkpoint = {
    collectionKey: galleryKey,
    photoId,
    filterState: publicFilterState(filterState),
    windowStart: visibleStart,
    windowEnd: visibleLimit,
    anchorOffset: card?.getBoundingClientRect().top || 0,
    updatedAt: new Date().toISOString(),
  };
  appliedGalleryCheckpointAt = Date.parse(checkpoint.updatedAt);
  window.photosByElieGalleryCheckpoints?.write?.(checkpoint);
};

const queueGalleryCheckpointWrite = () => {
  window.clearTimeout(galleryCheckpointWriteTimer);
  if (galleryCheckpointRestoreActive) return;
  galleryCheckpointWriteTimer = window.setTimeout(persistGalleryCheckpoint, 180);
};

const restoreDurableGalleryCheckpoint = () => {
  const checkpoint = pendingDurableGalleryCheckpoint;
  if (!checkpoint || !galleryRoot) return;
  pendingDurableGalleryCheckpoint = null;
  window.clearTimeout(galleryCheckpointWriteTimer);
  galleryCheckpointWriteTimer = 0;
  window.clearTimeout(galleryCheckpointRestoreTimer);
  galleryCheckpointRestoreActive = true;
  const targetOffset = Number(checkpoint.anchorOffset || 0);
  const earliestCompletion = Date.now() + 2000;
  const deadline = Date.now() + 10000;
  let stablePasses = 0;
  const settle = () => {
    const card = [...galleryRoot.querySelectorAll("[data-photo-index][data-photo-id]")]
      .find((item) => item.dataset.photoId === checkpoint.photoId);
    if (!card) {
      galleryCheckpointRestoreActive = false;
      queueGalleryCheckpointWrite();
      return;
    }
    const delta = card.getBoundingClientRect().top - targetOffset;
    if (Math.abs(delta) > 0.5) {
      stablePasses = 0;
      window.scrollTo({
        left: window.scrollX || 0,
        top: Math.max(0, (window.scrollY || 0) + delta),
        behavior: "auto",
      });
    } else {
      stablePasses += 1;
    }
    const imagesSettled = [...galleryRoot.querySelectorAll("img[data-photo-card-image]")]
      .every((image) => image.complete);
    if ((imagesSettled && stablePasses >= 3 && Date.now() >= earliestCompletion) || Date.now() >= deadline) {
      galleryCheckpointRestoreActive = false;
      queueGalleryCheckpointWrite();
      return;
    }
    galleryCheckpointRestoreTimer = window.setTimeout(() => {
      window.requestAnimationFrame(settle);
    }, 100);
  };
  window.requestAnimationFrame(settle);
};

const restorePendingGalleryReturn = () => {
  const returnState = pendingGalleryReturnState;
  const photoId = returnState?.photoId;
  if (!photoId || !galleryRoot) return;
  pendingGalleryReturnState = null;
  try {
    sessionStorage.removeItem(galleryReturnStateKey);
  } catch {}
  const card = [...galleryRoot.querySelectorAll("[data-photo-index][data-photo-id]")]
    .find((item) => item.dataset.photoId === photoId);
  if (!card) return;
  window.requestAnimationFrame(() => {
    const anchorCard = returnState?.anchorPhotoId
      ? [...galleryRoot.querySelectorAll("[data-photo-index][data-photo-id]")]
        .find((item) => item.dataset.photoId === returnState.anchorPhotoId)
      : null;
    if (anchorCard) {
      const delta = anchorCard.getBoundingClientRect().top - Number(returnState.anchorOffset || 0);
      if (Math.abs(delta) > 0.5) {
        window.scrollTo({
          left: window.scrollX || 0,
          top: Math.max(0, (window.scrollY || 0) + delta),
          behavior: "auto",
        });
      }
    } else {
      card.scrollIntoView({ block: "center", inline: "nearest" });
    }
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

const previewDimensions = (photo) => window.photosByEliePreviewDimensions?.(photo) || null;
const galleryFilterKeys = ["query", "orientation", "dateFrom", "dateTo"];
const ownerColorFilterValues = ["none", "red", "yellow", "green", "blue"];
const ownerPlacementFilterValues = ["picked", "hidden", "undecided"];
const ownerMinRatingFilter = () => Math.max(0, Math.min(5, Number(filterState.ownerMinRating) || 0));
const selectedOwnerColorFilters = () => new Set(
  String(filterState.ownerColors ?? defaultFilterState.ownerColors)
    .split(",")
    .filter((color) => ownerColorFilterValues.includes(color))
);
const selectedOwnerPlacementFilters = () => new Set(
  String(filterState.ownerPlacements ?? defaultFilterState.ownerPlacements)
    .split(",")
    .filter((placement) => ownerPlacementFilterValues.includes(placement))
);
const ownerFilterCount = () => {
  if (!isPBEOwnerGallery) return 0;
  const minRating = ownerMinRatingFilter();
  const colors = selectedOwnerColorFilters();
  const placements = selectedOwnerPlacementFilters();
  return Number(minRating > 0)
    + Number(colors.size !== ownerColorFilterValues.length)
    + Number(placements.size !== 1 || !placements.has("picked"));
};
const ownerSuperSearchText = (photo) => {
  if (!localModerationEnabled) return "";
  return ownerSuperSearchIndex.get(photo?.id)?.text || "";
};
const filterContext = () => ({
  collectionKey: galleryKey,
  collectionTitle: localizedCollectionTitle(),
  extraSearchText: ownerSuperSearchText,
});
const activeFilterCount = () => photoFilter.activeFilterCount(filterState, galleryFilterKeys) + ownerFilterCount();
const matchesOwnerFilterState = (photo) => {
  if (!isPBEOwnerGallery) return true;
  const rating = Math.max(0, Math.min(5, Number(photo?.ownerState?.rating) || 0));
  const color = String(photo?.ownerState?.color || "none").trim().toLowerCase() || "none";
  const placement = String(photo?.ownerState?.placement || "undecided").trim().toLowerCase() || "undecided";
  return rating >= ownerMinRatingFilter()
    && selectedOwnerColorFilters().has(color)
    && selectedOwnerPlacementFilters().has(placement);
};
const matchesFilterState = (photo) => photoFilter.matchesPhoto(photo, { ...filterState, mediaType: "all" }, filterContext())
  && matchesOwnerFilterState(photo);
const sortPhotos = (photos) => photoFilter.sortItems(photos, filterState, filterContext());
const filteredVisiblePhotos = (photos = visiblePhotos()) => sortPhotos(photos.filter(matchesFilterState));

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
  const label = t("gallery.filters");
  const text = count > 0 ? `${label} (${count})` : label;
  filterToggle.textContent = text;
  filterToggle.setAttribute("aria-label", text);
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
  syncDatePickerControls();
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
const syncFilterResponsiveFocus = () => {
  if (!filterBar) return;
  const searchInput = filterBar.querySelector("[data-gallery-search]");
  if (!searchInput) return;
  const activeElement = document.activeElement;
  const previousFilterFocus = lastGalleryFilterFocus;
  const isNarrow = window.matchMedia?.(`(max-width:${galleryFilterCollapseBreakpoint}px)`).matches ?? false;
  const secondaryControlHidden = isNarrow
    && !filterBar.classList.contains("is-open")
    && (
      (activeElement && activeElement !== searchInput && filterBar.contains(activeElement))
      || (activeElement === document.body && previousFilterFocus && previousFilterFocus !== searchInput && filterBar.contains(previousFilterFocus))
    );
  const toggleHidden = !isNarrow && (
    activeElement === filterToggle
    || (activeElement === document.body && previousFilterFocus === filterToggle)
  );
  if (!secondaryControlHidden && !toggleHidden) return;
  try {
    searchInput.focus({ preventScroll: true });
  } catch {
    searchInput.focus();
  }
};

const datePickerControlMarkup = (key, labelKey) => `
  <label class="gallery-date-label">
    <span data-i18n="${labelKey}">${escapeHtml(t(labelKey))}</span>
    <span class="gallery-date-control" data-gallery-date-control="${key}">
      ${inlineDatePickerPartOrder().map((part, index) => {
        const parts = inlineDatePickerPartsFor(key);
        const titleKey = key === "dateTo" ? "gallery.date_to_title" : "gallery.date_from_title";
        const options = inlineDatePickerOptions(part, parts);
        const separator = index ? `<span class="gallery-date-separator" aria-hidden="true">/</span>` : "";
        return `${separator}<select class="gallery-date-select gallery-date-${part}" data-gallery-date-part="${part}" data-gallery-date-endpoint="${key}" aria-label="${escapeHtml(`${t(titleKey)} ${t(`gallery.date_${part}`)}`)}">${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select>`;
      }).join("")}
      <input type="hidden" data-gallery-filter="${key}" value="" />
    </span>
  </label>`;

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
    ${datePickerControlMarkup("dateFrom", "gallery.date_from")}
    ${datePickerControlMarkup("dateTo", "gallery.date_to")}
    <label><span data-i18n="gallery.orientation">Orientation</span><select data-gallery-filter="orientation">
      <option value="all" data-i18n="gallery.all">All</option>
      <option value="pano" data-i18n="gallery.pano">Pano</option>
      <option value="landscape" data-i18n="gallery.landscape">Landscape</option>
      <option value="portrait" data-i18n="gallery.portrait">Portrait</option>
      <option value="square" data-i18n="gallery.square">Square</option>
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
    ${isPBEOwnerGallery ? '<div class="gallery-owner-filter-row" data-gallery-owner-filter-row aria-label="Owner filters"></div>' : ""}
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
  writeFilterState();
  syncFilterControls();
  syncSearchFilterUrl(filterState);
  if (!isSelectionGallery) {
    filterToggle.addEventListener("click", () => {
      filterBar.classList.toggle("is-open");
      syncFilterToggle();
    });
  }
  filterBar.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) lastGalleryFilterFocus = event.target;
  });
  filterToggle.addEventListener("focusin", () => {
    lastGalleryFilterFocus = filterToggle;
  });
  window.addEventListener("resize", syncFilterResponsiveFocus);
  filterBar.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  filterBar.addEventListener("change", (event) => {
    const control = event.target;
    if (control instanceof HTMLSelectElement && control.dataset.galleryDatePart && control.dataset.galleryDateEndpoint) {
      commitInlineDatePickerControl(control);
      return;
    }
    if (!(control instanceof HTMLSelectElement || control instanceof HTMLInputElement) || !control.dataset.galleryFilter) return;
    const value = control instanceof HTMLInputElement && control.type === "checkbox"
      ? control.checked
      : control instanceof HTMLInputElement && control.type === "date"
        ? photoFilter.dateFilterValue(control.value)
        : control.value;
    filterState = { ...filterState, [control.dataset.galleryFilter]: value };
    syncFilterControls();
    writeFilterState();
    cancelPaginationSequence();
    resetGalleryWindow();
    selectedIndex = 0;
    renderGallery({ scrollSelection: false });
  });
  filterBar.querySelector("[data-gallery-search]")?.addEventListener("input", (event) => {
    filterState = { ...filterState, query: event.target.value };
    writeFilterState();
    syncSearchFilterUrl(filterState);
    syncFilterToggle();
    cancelPaginationSequence();
    resetGalleryWindow();
    selectedIndex = 0;
    renderGallery({ scrollSelection: false });
  });
  filterBar.querySelector("[data-clear-gallery-filters]")?.addEventListener("click", () => {
    filterState = { ...defaultFilterState };
    seedInlineDatePickerSelections();
    writeFilterState();
    syncDateFilterUrl(filterState);
    syncFilterControls();
    cancelPaginationSequence();
    resetGalleryWindow();
    selectedIndex = 0;
    renderGallery({ scrollSelection: false });
  });
};

const ensureGalleryMoreButton = () => {
  if (moreButton || !galleryRoot) return;
  const backwardControls = document.createElement("div");
  backwardControls.className = "gallery-pagination-controls gallery-pagination-backward";
  backwardControls.setAttribute("role", "group");
  backwardControls.setAttribute("aria-label", "Earlier photos");
  backwardControls.hidden = true;
  const forwardControls = document.createElement("div");
  forwardControls.className = "gallery-pagination-controls gallery-pagination-forward";
  forwardControls.setAttribute("role", "group");
  forwardControls.setAttribute("aria-label", "Later photos");
  forwardControls.hidden = true;
  const makeWindowButton = ({ count, direction, datasetKey, label }) => {
    const button = document.createElement("button");
    button.className = "btn secondary gallery-more-button";
    button.type = "button";
    button.dataset[datasetKey] = "";
    button.textContent = label;
    button.setAttribute("aria-label", `${direction === "backward" ? "Show previous" : "Show next"} ${count} photos`);
    button.hidden = true;
    return button;
  };
  lessButton = makeWindowButton({ count: pageSize, direction: "backward", datasetKey: "galleryLess", label: `−${pageSize}` });
  lessDoubleButton = makeWindowButton({ count: pageSize * 2, direction: "backward", datasetKey: "galleryLessDouble", label: `−${pageSize * 2}` });
  lessQuadButton = makeWindowButton({ count: pageSize * 4, direction: "backward", datasetKey: "galleryLessQuad", label: `−${pageSize * 4}` });
  moreButton = document.createElement("button");
  moreButton.className = "btn secondary gallery-more-button";
  moreButton.type = "button";
  moreButton.dataset.galleryMore = "";
  moreButton.textContent = `+${pageSize}`;
  moreButton.setAttribute("aria-label", `Show next ${pageSize} photos`);
  moreButton.hidden = true;
  moreDoubleButton = document.createElement("button");
  moreDoubleButton.className = "btn secondary gallery-more-button";
  moreDoubleButton.type = "button";
  moreDoubleButton.dataset.galleryMoreDouble = "";
  moreDoubleButton.textContent = `+${pageSize * 2}`;
  moreDoubleButton.setAttribute("aria-label", `Show next ${pageSize * 2} photos`);
  moreDoubleButton.hidden = true;
  moreQuadButton = document.createElement("button");
  moreQuadButton.className = "btn secondary gallery-more-button";
  moreQuadButton.type = "button";
  moreQuadButton.dataset.galleryMoreQuad = "";
  moreQuadButton.textContent = `+${pageSize * 4}`;
  moreQuadButton.setAttribute("aria-label", `Show next ${pageSize * 4} photos`);
  moreQuadButton.hidden = true;
  backwardControls.append(lessQuadButton, lessDoubleButton, lessButton);
  forwardControls.append(moreButton, moreDoubleButton, moreQuadButton);
  galleryRoot.before(backwardControls);
  galleryRoot.after(forwardControls);
  const moveWindow = (direction, count) => {
    const photos = filteredVisiblePhotos();
    const movingBackward = direction === "backward";
    const nextWindow = galleryWindowModel.moveGalleryWindow({
      start: visibleStart,
      end: visibleLimit,
      total: photos.length,
      direction,
      count,
    });
    const anchorPhotoId = movingBackward
      ? photos[nextWindow.start]?.id || ""
      : photos[visibleLimit]?.id || "";
    showAllRenderToken += 1;
    beginPaginationAnchor(anchorPhotoId, {
      targetTop: movingBackward
        ? backwardControls.getBoundingClientRect().bottom
        : forwardControls.getBoundingClientRect().top,
    });
    visibleStart = nextWindow.start;
    visibleLimit = nextWindow.end;
    renderGallery({ scrollSelection: false });
    schedulePaginationAnchorRestore();
    releasePaginationAnchor();
  };
  lessButton.addEventListener("click", () => moveWindow("backward", pageSize));
  lessDoubleButton.addEventListener("click", () => moveWindow("backward", pageSize * 2));
  lessQuadButton.addEventListener("click", () => moveWindow("backward", pageSize * 4));
  moreButton.addEventListener("click", () => moveWindow("forward", pageSize));
  moreDoubleButton.addEventListener("click", () => moveWindow("forward", pageSize * 2));
  moreQuadButton.addEventListener("click", () => moveWindow("forward", pageSize * 4));
};

const expandGalleryToIncludeIndex = (index) => {
  if (index < 0) return;
  const total = filteredVisiblePhotos().length;
  if (index < visibleStart) {
    visibleStart = Math.max(0, Math.floor(index / pageSize) * pageSize);
    visibleLimit = Math.min(total, visibleStart + maxRenderedPhotos);
  } else if (index >= visibleLimit) {
    visibleLimit = Math.min(total, Math.ceil((index + 1) / pageSize) * pageSize);
    visibleStart = Math.max(0, visibleLimit - maxRenderedPhotos);
  }
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
  if (!cards.length) {
    syncGallerySelectionToolbar();
    return;
  }
  if (ownerCullingEnabled) {
    const selectedPrimaryIndex = renderedGalleryPhotos.findIndex((photo) => photo.id === primaryPhotoId);
    if (selectedPrimaryIndex >= 0) selectedIndex = selectedPrimaryIndex;
    selectedIndex = Math.max(0, Math.min(selectedIndex, cards.length - 1));
  }
  cards.forEach((card, index) => {
    const photoId = renderedGalleryPhotos[index]?.id || "";
    card.classList.toggle("is-selected", ownerCullingEnabled && photoId === primaryPhotoId);
    card.classList.toggle("is-batch-selected", selectedPhotoIds.has(photoId));
    card.classList.toggle("has-selection-error", selectionErrors.has(photoId));
    if (selectionErrors.has(photoId)) card.dataset.selectionError = selectionErrors.get(photoId);
    else delete card.dataset.selectionError;
  });
  syncGallerySelectionButtons();
  syncGallerySelectionToolbar();
  if (scroll && ownerCullingEnabled) cards[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
};

const syncGallerySelectionButtons = () => {
  galleryRoot.querySelectorAll("[data-gallery-select-photo]").forEach((button) => {
    const selected = selectedPhotoIds.has(button.dataset.photoId);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-label", selected ? "Remove from selection" : "Add to selection");
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.textContent = selected ? "✓" : "+";
  });
};

const rememberSelectedPhoto = (photoId) => {
  selectionRecency = selectionRecency.filter((candidate) => candidate !== photoId);
  selectionRecency.push(photoId);
  primaryPhotoId = photoId;
};

const forgetSelectedPhoto = (photoId) => {
  selectionRecency = selectionRecency.filter((candidate) => candidate !== photoId);
  if (primaryPhotoId !== photoId) return;
  primaryPhotoId = [...selectionRecency].reverse().find((candidate) => selectedPhotoIds.has(candidate)) || "";
};

const syncSelectionDetailContext = () => {
  writeDetailSequenceContext(filteredVisiblePhotos());
};

const toggleGalleryPhotoSelection = (photoId, photos = renderedGalleryPhotos) => {
  const index = photos.findIndex((photo) => photo.id === photoId);
  if (index < 0) return false;
  selectionErrors.delete(photoId);
  if (selectedPhotoIds.has(photoId)) {
    if (ownerCullingEnabled && selectedPhotoIds.size === 1) {
      setGalleryStatus("Owner selection keeps one primary photo.");
      return false;
    }
    selectedPhotoIds.delete(photoId);
    forgetSelectedPhoto(photoId);
  } else {
    if (selectedPhotoIds.size >= selectionLimit) {
      setGalleryStatus(`Selection is limited to ${selectionLimit} photos.`);
      return false;
    }
    selectedPhotoIds.add(photoId);
    rememberSelectedPhoto(photoId);
  }
  if (ownerCullingEnabled && primaryPhotoId) {
    const primaryIndex = photos.findIndex((photo) => photo.id === primaryPhotoId);
    if (primaryIndex >= 0) selectedIndex = primaryIndex;
  }
  updateSelection({ scroll: false });
  syncSelectionDetailContext();
  return true;
};

const selectOwnerPhotoFromPointer = (photoId, photos, event = {}) => {
  const index = photos.findIndex((photo) => photo.id === photoId);
  if (index < 0) return;
  const toggle = Boolean(event.metaKey || event.ctrlKey);
  const anchorIndex = photos.findIndex((photo) => photo.id === selectionAnchorPhotoId);
  if (event.shiftKey && anchorIndex >= 0) {
    if (!toggle) {
      selectedPhotoIds.clear();
      selectionRecency = [];
    }
    const start = Math.min(anchorIndex, index);
    const end = Math.max(anchorIndex, index);
    photos.slice(start, end + 1).forEach((photo) => {
      if (selectedPhotoIds.size < selectionLimit) {
        selectedPhotoIds.add(photo.id);
        selectionRecency = selectionRecency.filter((candidate) => candidate !== photo.id).concat(photo.id);
      }
    });
    if (end - start + 1 > selectionLimit) setGalleryStatus(`Selection is limited to ${selectionLimit} photos.`);
    rememberSelectedPhoto(photoId);
  } else if (toggle) {
    toggleGalleryPhotoSelection(photoId, photos);
    selectionAnchorPhotoId = photoId;
    return;
  } else {
    selectedPhotoIds.clear();
    selectionRecency = [];
    selectedPhotoIds.add(photoId);
    rememberSelectedPhoto(photoId);
    selectionAnchorPhotoId = photoId;
  }
  selectedIndex = index;
  updateSelection({ scroll: false });
  syncSelectionDetailContext();
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

const setPaginationBusy = (busy) => {
  document.querySelectorAll(".gallery-pagination-controls").forEach((controls) => {
    controls.toggleAttribute("aria-busy", busy);
    controls.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
  });
};

const clearPaginationAnchor = () => {
  if (paginationAnchorRaf) window.cancelAnimationFrame(paginationAnchorRaf);
  paginationAnchorRaf = 0;
  if (paginationAnchorObserver) paginationAnchorObserver.disconnect();
  paginationAnchorObserver = null;
  if (paginationAnchorCleanupTimer) window.clearTimeout(paginationAnchorCleanupTimer);
  paginationAnchorCleanupTimer = 0;
  paginationAnchorState = null;
};

const paginationAnchorCard = (photoId) => {
  if (!photoId || !galleryRoot) return null;
  return [...galleryRoot.querySelectorAll("[data-photo-index]")]
    .find((card) => card.dataset.photoId === photoId) || null;
};

const restorePaginationAnchor = () => {
  const anchor = paginationAnchorState;
  if (!anchor) return;
  if (anchor.token !== showAllRenderToken) {
    clearPaginationAnchor();
    return;
  }
  const card = paginationAnchorCard(anchor.photoId);
  if (!card) return;
  const cardTop = card.getBoundingClientRect().top;
  const delta = cardTop - anchor.targetTop;
  if (Math.abs(delta) > 0.5) {
    window.scrollTo({
      left: anchor.left,
      top: Math.max(0, (window.scrollY || 0) + delta),
      behavior: "auto",
    });
  }
  const link = card.querySelector("[data-photo-link]");
  if (link && (anchor.focusEachRender || !anchor.focused)) {
    link.focus({ preventScroll: true });
    if (!anchor.focusEachRender) anchor.focused = true;
  }
};

const schedulePaginationAnchorRestore = () => {
  if (!paginationAnchorState || paginationAnchorRaf) return;
  const anchor = paginationAnchorState;
  anchor.framePass = 0;
  const restoreFrame = () => {
    paginationAnchorRaf = 0;
    if (paginationAnchorState !== anchor) return;
    restorePaginationAnchor();
    if (paginationAnchorState === anchor && anchor.framePass < 2) {
      anchor.framePass += 1;
      paginationAnchorRaf = window.requestAnimationFrame(restoreFrame);
    }
  };
  paginationAnchorRaf = window.requestAnimationFrame(restoreFrame);
};

const releasePaginationAnchor = () => {
  if (!paginationAnchorState) return;
  schedulePaginationAnchorRestore();
  if (paginationAnchorCleanupTimer) window.clearTimeout(paginationAnchorCleanupTimer);
  paginationAnchorCleanupTimer = window.setTimeout(clearPaginationAnchor, 750);
};

const cancelPaginationSequence = () => {
  showAllRenderToken += 1;
  setPaginationBusy(false);
  clearPaginationAnchor();
};

const beginPaginationAnchor = (photoId, { focusEachRender = false, targetTop = null } = {}) => {
  clearPaginationAnchor();
  if (!photoId || !galleryRoot) return null;
  const fallbackControls = moreButton?.closest(".gallery-pagination-controls");
  const resolvedTargetTop = Number.isFinite(Number(targetTop))
    ? Number(targetTop)
    : fallbackControls?.getBoundingClientRect().top;
  if (!Number.isFinite(resolvedTargetTop)) return null;
  paginationAnchorState = {
    photoId,
    targetTop: resolvedTargetTop,
    left: window.scrollX || 0,
    token: showAllRenderToken,
    focusEachRender,
    focused: false,
    framePass: 0,
  };
  if (typeof window.ResizeObserver === "function") {
    paginationAnchorObserver = new window.ResizeObserver(schedulePaginationAnchorRestore);
    paginationAnchorObserver.observe(galleryRoot);
  }
  if (!focusEachRender) paginationAnchorCleanupTimer = window.setTimeout(clearPaginationAnchor, 1500);
  return paginationAnchorState;
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

const captureSelectionSnapshot = (photos = filteredVisiblePhotos()) => ({
  selectedIds: [...selectedPhotoIds],
  primaryPhotoId,
  anchorPhotoId: selectionAnchorPhotoId,
  selectionRecency: [...selectionRecency],
  direction: selectionDirection,
  orderedIds: photos.map((photo) => photo.id),
  filterState: { ...filterState },
  visibleStart,
  visibleLimit,
  scrollY: window.scrollY,
});

const replacementAfterRemoval = (snapshot, survivingIds) => {
  const orderedIds = snapshot?.orderedIds || [];
  const primaryIndex = Math.max(0, orderedIds.indexOf(snapshot?.primaryPhotoId));
  const primaryStep = snapshot?.direction === "backward" ? -1 : 1;
  for (const step of [primaryStep, -primaryStep]) {
    for (let index = primaryIndex + step; index >= 0 && index < orderedIds.length; index += step) {
      if (survivingIds.has(orderedIds[index])) return orderedIds[index];
    }
  }
  return "";
};

const moveOwnerSelectionToWasteBasket = async (requestedPhotoIds = null) => {
  const photos = filteredVisiblePhotos();
  const ids = (Array.isArray(requestedPhotoIds) ? requestedPhotoIds : [...selectedPhotoIds])
    .map(String)
    .filter(Boolean)
    .slice(0, selectionLimit);
  if (!ids.length) return { succeeded: [], failed: [] };
  const snapshot = captureSelectionSnapshot(photos);
  try {
    ids.forEach((photoId) => setGalleryBlockedVisual(photoId, "blocking"));
    setGalleryStatus(`${ids.length} photo${ids.length === 1 ? "" : "s"} moving to Waste Basket...`);
    if (ids.length === 1) await hiddenActions.mark(ids[0]);
    else await hiddenActions.markMany(ids);
    lastUndoableOwnerAction = { kind: "waste-basket", ids, snapshot };
    ids.forEach((photoId) => {
      selectedPhotoIds.delete(photoId);
      forgetSelectedPhoto(photoId);
    });
    const survivingPhotos = filteredVisiblePhotos();
    if (!selectedPhotoIds.size) {
      selectionRecency = [];
      selectionAnchorPhotoId = "";
      const replacementId = replacementAfterRemoval(snapshot, new Set(survivingPhotos.map((photo) => photo.id)));
      if (replacementId) {
        selectedPhotoIds.add(replacementId);
        rememberSelectedPhoto(replacementId);
        selectionAnchorPhotoId = replacementId;
        const replacementIndex = survivingPhotos.findIndex((photo) => photo.id === replacementId);
        expandGalleryToIncludeIndex(replacementIndex);
        selectedIndex = Math.max(0, replacementIndex - visibleStart);
      } else {
        primaryPhotoId = "";
        selectedIndex = 0;
      }
    }
    renderGallery();
    setGalleryStatus(`${ids.length} photo${ids.length === 1 ? "" : "s"} moved to Waste Basket.`);
    return { succeeded: ids, failed: [] };
  } catch (error) {
    ids.forEach((photoId) => setGalleryBlockedVisual(photoId, ""));
    setGalleryStatus(error?.message || "Could not move photo to Waste Basket.");
    syncGallerySelectionToolbar();
    return { succeeded: [], failed: ids.map((photoId) => ({ photoId, reason: error?.message || "Could not move photo to Waste Basket." })) };
  }
};

const undoLastOwnerCommand = async () => {
  const undoable = lastUndoableOwnerAction;
  if (!undoable?.ids?.length) return false;
  let undoneId = null;
  try {
    if (undoable.ids.length > 1) {
      const restored = await hiddenActions.undoMany(undoable.ids);
      undoneId = restored[0] || null;
    } else {
      undoneId = await hiddenActions.undo(undoable.ids[0] || null);
    }
  } catch (error) {
    setGalleryStatus(error?.message || "Could not undo the last Waste Basket move.");
    syncGallerySelectionToolbar();
    return false;
  }
  lastUndoableOwnerAction = null;
  selectedPhotoIds.clear();
  selectionRecency = [];
  const restoredPhotos = filteredVisiblePhotos();
  const restoredPhotoIds = new Set(restoredPhotos.map((photo) => photo.id));
  undoable.snapshot.selectedIds.forEach((photoId) => {
    if (restoredPhotoIds.has(photoId) && selectedPhotoIds.size < selectionLimit) selectedPhotoIds.add(photoId);
  });
  selectionRecency = undoable.snapshot.selectionRecency.filter((photoId) => selectedPhotoIds.has(photoId));
  primaryPhotoId = selectedPhotoIds.has(undoable.snapshot.primaryPhotoId)
    ? undoable.snapshot.primaryPhotoId
    : selectionRecency.at(-1) || undoneId || "";
  selectionAnchorPhotoId = selectedPhotoIds.has(undoable.snapshot.anchorPhotoId)
    ? undoable.snapshot.anchorPhotoId
    : primaryPhotoId;
  selectionDirection = undoable.snapshot.direction;
  visibleStart = undoable.snapshot.visibleStart || 0;
  visibleLimit = undoable.snapshot.visibleLimit;
  renderGallery();
  if (!undoneId) {
    setGalleryStatus("The Waste Basket receipt is no longer undoable.");
    return false;
  }
  const nextPhotos = filteredVisiblePhotos();
  const restoredIndex = nextPhotos.findIndex((photo) => photo.id === primaryPhotoId || photo.id === undoneId);
  if (restoredIndex >= 0) {
    expandGalleryToIncludeIndex(restoredIndex);
    selectedIndex = Math.max(0, restoredIndex - visibleStart);
  }
  updateSelection();
  window.scrollTo({ top: undoable.snapshot.scrollY, behavior: "auto" });
  setGalleryStatus("Last Waste Basket move undone.");
  return true;
};

const selectedShortcutPhoto = () => {
  const photos = filteredVisiblePhotos();
  if (!photos.length) return null;
  const explicitPrimary = primaryPhotoId && selectedPhotoIds.has(primaryPhotoId)
    ? primaryPhotoId
    : [...selectionRecency].reverse().find((photoId) => selectedPhotoIds.has(photoId));
  if (!explicitPrimary) return null;
  const index = photos.findIndex((photo) => photo.id === explicitPrimary);
  if (index < 0) return null;
  if (ownerCullingEnabled && index >= visibleStart && index < visibleLimit) selectedIndex = index - visibleStart;
  return photos[index];
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
  galleryLayout.applyDensityControls();
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

const extendOwnerKeyboardSelection = (photos, destinationIndex) => {
  if (!ownerCullingEnabled || !photos.length) return;
  let anchorIndex = photos.findIndex((photo) => photo.id === selectionAnchorPhotoId);
  if (anchorIndex < 0 && selectedPhotoIds.size === 1) {
    const [onlySelectedId] = selectedPhotoIds;
    anchorIndex = photos.findIndex((photo) => photo.id === onlySelectedId);
  }
  if (anchorIndex < 0) anchorIndex = Math.max(0, Math.min(visibleStart + selectedIndex, photos.length - 1));
  selectionAnchorPhotoId = photos[anchorIndex]?.id || "";
  selectedPhotoIds.clear();
  selectionRecency = [];
  const start = Math.min(anchorIndex, destinationIndex);
  const end = Math.max(anchorIndex, destinationIndex);
  photos.slice(start, end + 1).forEach((photo) => {
    if (selectedPhotoIds.size < selectionLimit) {
      selectedPhotoIds.add(photo.id);
      selectionRecency = selectionRecency.filter((candidate) => candidate !== photo.id).concat(photo.id);
    }
  });
  const destinationId = photos[destinationIndex]?.id || "";
  if (destinationId) rememberSelectedPhoto(destinationId);
};

const stepGallerySelection = (delta, columnJump = false, { extend = false } = {}) => {
  const photos = filteredVisiblePhotos();
  if (!photos.length) return;
  const step = columnJump ? visibleColumnCount() * delta : delta;
  const currentIndex = Math.max(0, Math.min(visibleStart + selectedIndex, photos.length - 1));
  const nextIndex = Math.max(0, Math.min(currentIndex + step, photos.length - 1));
  selectionDirection = delta < 0 ? "backward" : "forward";
  if (extend) {
    extendOwnerKeyboardSelection(photos, nextIndex);
  } else if (ownerCullingEnabled) {
    const nextId = photos[nextIndex]?.id || "";
    selectedPhotoIds.clear();
    selectionRecency = [];
    if (nextId) {
      selectedPhotoIds.add(nextId);
      rememberSelectedPhoto(nextId);
      selectionAnchorPhotoId = nextId;
    }
  }
  if (nextIndex < visibleStart || nextIndex >= visibleLimit) {
    expandGalleryToIncludeIndex(nextIndex);
    selectedIndex = Math.max(0, nextIndex - visibleStart);
    renderGallery();
    return;
  }
  selectedIndex = nextIndex - visibleStart;
  updateSelection();
  syncSelectionDetailContext();
};

const preferredFitMode = () => galleryLayout.fitMode();

const applyGalleryPreviewLayout = (photos = renderedGalleryPhotos) => {
  galleryLayout.applyPreviewLayout(photos);
};

const applyGalleryFitMode = () => {
  galleryLayout.applyFitMode();
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

const selectedPhotosInOrder = (photos = renderedGalleryPhotos) => photos
  .filter((photo) => selectedPhotoIds.has(photo.id));

const ensureOwnerSelection = (photos) => {
  const availableIds = new Set(photos.map((photo) => photo.id));
  [...selectedPhotoIds].forEach((photoId) => {
    if (!availableIds.has(photoId)) selectedPhotoIds.delete(photoId);
  });
  selectionRecency = selectionRecency.filter((photoId) => selectedPhotoIds.has(photoId));
  if (!ownerCullingEnabled || !photos.length) return;
  if (!selectedPhotoIds.size) {
    const preferredIndex = Math.max(0, Math.min(visibleStart + selectedIndex, photos.length - 1));
    const preferredId = photos[preferredIndex]?.id || photos[0].id;
    selectedPhotoIds.add(preferredId);
    rememberSelectedPhoto(preferredId);
    selectionAnchorPhotoId = preferredId;
  } else if (!selectedPhotoIds.has(primaryPhotoId)) {
    primaryPhotoId = [...selectionRecency].reverse().find((photoId) => selectedPhotoIds.has(photoId))
      || selectedPhotosInOrder(photos).at(-1)?.id
      || "";
  }
  const primaryIndex = photos.findIndex((photo) => photo.id === primaryPhotoId);
  if (primaryIndex >= visibleStart && primaryIndex < visibleLimit) selectedIndex = primaryIndex - visibleStart;
};

const selectAllLoadedPhotos = () => {
  const before = selectedPhotoIds.size;
  for (const photo of renderedGalleryPhotos) {
    if (selectedPhotoIds.size >= selectionLimit) break;
    if (selectedPhotoIds.has(photo.id)) continue;
    selectedPhotoIds.add(photo.id);
    selectionRecency.push(photo.id);
  }
  if (ownerCullingEnabled && !primaryPhotoId && selectionRecency.length) primaryPhotoId = selectionRecency.at(-1);
  if (selectedPhotoIds.size >= selectionLimit && renderedGalleryPhotos.length > selectedPhotoIds.size) {
    setGalleryStatus(`Selection is limited to ${selectionLimit} photos.`);
  } else {
    setGalleryStatus(`${selectedPhotoIds.size - before} loaded photo${selectedPhotoIds.size - before === 1 ? "" : "s"} added to the selection.`);
  }
  updateSelection({ scroll: false });
  syncSelectionDetailContext();
};

const clearVisitorSelection = () => {
  selectedPhotoIds.clear();
  selectionRecency = [];
  primaryPhotoId = "";
  selectionAnchorPhotoId = "";
  selectionErrors.clear();
  updateSelection({ scroll: false });
  syncSelectionDetailContext();
  setGalleryStatus("Selection cleared.");
};

const keepOwnerPrimary = () => {
  const selected = selectedShortcutPhoto();
  if (!selected) return;
  selectedPhotoIds.clear();
  selectedPhotoIds.add(selected.id);
  selectionRecency = [selected.id];
  primaryPhotoId = selected.id;
  selectionAnchorPhotoId = selected.id;
  updateSelection({ scroll: false });
  syncSelectionDetailContext();
  setGalleryStatus(`${selected.title} kept as primary.`);
};

const pulseLikedCards = (photoIds) => {
  const wanted = new Set(photoIds);
  galleryRoot.querySelectorAll("[data-photo-id]").forEach((card) => {
    if (!wanted.has(card.dataset.photoId)) return;
    card.classList.add("is-like-command-success");
    window.setTimeout(() => card.classList.remove("is-like-command-success"), 700);
  });
};

const likeSelectedPhotos = () => {
  const selected = selectedPhotosInOrder();
  const succeeded = [];
  const failed = [];
  selected.forEach((photo) => {
    try {
      if (!likedStore?.has?.(photo.id)) likedStore?.add?.(photo.id);
      succeeded.push(photo.id);
      selectionErrors.delete(photo.id);
    } catch (error) {
      failed.push(photo.id);
      selectionErrors.set(photo.id, error?.message || "Could not like this photo.");
    }
  });
  updateGalleryLikeButtons();
  pulseLikedCards(succeeded);
  if (!ownerCullingEnabled) {
    succeeded.forEach((photoId) => {
      selectedPhotoIds.delete(photoId);
      forgetSelectedPhoto(photoId);
    });
  }
  updateSelection({ scroll: false });
  syncSelectionDetailContext();
  if (failed.length) setGalleryStatus(`${succeeded.length} liked; ${failed.length} failed and remain selected.`);
  else setGalleryStatus(`${succeeded.length} photo${succeeded.length === 1 ? "" : "s"} liked.`);
  return { succeeded, failed };
};

const ownerWorkflowContext = () => {
  const value = typeof ownerCommandAdapter.context === "function"
    ? ownerCommandAdapter.context()
    : ownerCommandAdapter.context;
  return value === "review" ? "review" : "gallery";
};

const ownerAdapterMethod = (name) => typeof ownerCommandAdapter?.[name] === "function"
  ? ownerCommandAdapter[name].bind(ownerCommandAdapter)
  : null;

const normalizeOwnerCommandResult = (result, requestedIds) => {
  const itemResults = Array.isArray(result?.results) ? result.results : [];
  if (!itemResults.length) {
    return {
      succeeded: [...requestedIds],
      succeededItems: requestedIds.map((photoId) => ({ photoId })),
      failed: [],
    };
  }
  const succeededItems = itemResults
    .filter((item) => item?.ok !== false)
    .map((item) => ({
      ...item,
      photoId: String(item.photoId || item.photo_id || item.id || ""),
    }))
    .filter((item) => item.photoId);
  const succeeded = succeededItems.map((item) => item.photoId);
  const succeededIds = new Set(succeeded);
  const failed = itemResults
    .filter((item) => item?.ok === false)
    .map((item) => ({
      photoId: String(item.photoId || item.photo_id || item.id || ""),
      reason: String(item.reason || item.error || "Owner command failed."),
    }))
    .filter((item) => item.photoId);
  requestedIds.forEach((photoId) => {
    if (!succeededIds.has(photoId) && !failed.some((item) => item.photoId === photoId)) {
      failed.push({ photoId, reason: "No result was returned for this photo." });
    }
  });
  return { succeeded, succeededItems, failed };
};

const ownerPhotoForId = (photoId) => (gallery?.photos || []).find((photo) => photo.id === photoId) || null;

const applyOwnerCommandState = (methodName, value, succeededItems) => {
  succeededItems.forEach((item) => {
    const photoId = item.photoId;
    const photo = ownerPhotoForId(photoId);
    if (!photo) return;
    photo.ownerState = { ...(photo.ownerState || {}) };
    if (methodName === "setRating") {
      const rating = item.rating ?? item.state?.rating ?? value;
      photo.ownerState.rating = Math.max(0, Math.min(5, Number(rating) || 0));
    }
    if (methodName === "setColor") {
      const color = item.color ?? item.state?.color ?? value;
      photo.ownerState.color = String(color || "").trim().toLowerCase();
    }
    if (methodName === "hide") photo.ownerState.placement = String(item.placement || "hidden").trim().toLowerCase();
    if (methodName === "review") photo.ownerState.placement = String(item.placement || "picked").trim().toLowerCase();
    if (methodName === "unpick") photo.ownerState.placement = "undecided";
  });
};

const ownerCommandSuccessStatus = (methodName, value, count) => {
  const subject = `${count} photo${count === 1 ? "" : "s"}`;
  if (methodName === "setRating") return `${subject} rated ${Number(value) || 0}.`;
  if (methodName === "setColor") return `${subject} labeled ${String(value || "").toLowerCase()}.`;
  if (methodName === "review") return `${subject} returned to Review.`;
  if (methodName === "unpick") return `${subject} returned to Undecided.`;
  if (methodName === "hide") return `${subject} hidden from this fixture.`;
  return `${subject} updated.`;
};

const ownerCardPresentation = (photo) => {
  if (!isPBEOwnerGallery) return { className: "", html: "" };
  const rating = Math.max(0, Math.min(5, Number(photo?.ownerState?.rating) || 0));
  const color = String(photo?.ownerState?.color || "").trim().toLowerCase();
  const supportedColor = ["red", "yellow", "green", "blue"].includes(color) ? color : "";
  const stars = Array.from({ length: 5 }, (_, index) => `
    <span class="gallery-owner-card-star${index < rating ? " is-filled" : ""}" aria-hidden="true">★</span>
  `).join("");
  const colorFrame = supportedColor
    ? '<span class="gallery-owner-card-color" aria-hidden="true"></span>'
    : "";
  const stateLabel = `Rating ${rating} of 5${supportedColor ? `, ${supportedColor} color` : ", no color"}`;
  return {
    className: supportedColor ? `has-owner-color owner-color-${supportedColor}` : "",
    html: `${colorFrame}<span class="gallery-owner-card-rating" aria-label="${escapeHtml(stateLabel)}" title="${escapeHtml(stateLabel)}">${stars}</span>`,
  };
};

const runOwnerAdapterCommand = async (methodName, { value = null, removes = false, currentPhoto = null } = {}) => {
  const method = ownerAdapterMethod(methodName);
  if (!method) return null;
  const requestedIds = currentPhoto?.id ? [currentPhoto.id] : [...selectedPhotoIds].slice(0, selectionLimit);
  if (!requestedIds.length) return null;
  const snapshot = captureSelectionSnapshot();
  try {
    const result = await method({
      photoIds: requestedIds,
      primaryPhotoId: currentPhoto?.id || primaryPhotoId,
      fixtureId: ownerCommandAdapter.fixtureId || null,
      idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${methodName}`,
      value,
    });
    const normalized = normalizeOwnerCommandResult(result, requestedIds);
    normalized.failed.forEach((item) => selectionErrors.set(item.photoId, item.reason));
    normalized.succeeded.forEach((photoId) => selectionErrors.delete(photoId));
    applyOwnerCommandState(methodName, value, normalized.succeededItems);
    if (removes) {
      normalized.succeeded.forEach((photoId) => {
        selectedPhotoIds.delete(photoId);
        forgetSelectedPhoto(photoId);
      });
      if (!selectedPhotoIds.size) {
        const survivors = filteredVisiblePhotos();
        const replacementId = replacementAfterRemoval(snapshot, new Set(survivors.map((photo) => photo.id)));
        if (replacementId) {
          selectedPhotoIds.add(replacementId);
          rememberSelectedPhoto(replacementId);
          selectionAnchorPhotoId = replacementId;
        }
      }
      renderGallery();
    } else if (["setRating", "setColor", "review", "unpick"].includes(methodName)) {
      renderGallery({ scrollSelection: false });
    } else {
      updateSelection({ scroll: false });
    }
    setGalleryStatus(normalized.failed.length
      ? `${normalized.succeeded.length} succeeded; ${normalized.failed.length} failed and remain selected.`
      : ownerCommandSuccessStatus(methodName, value, normalized.succeeded.length));
    return normalized;
  } catch (error) {
    requestedIds.forEach((photoId) => selectionErrors.set(photoId, error?.message || "Owner command failed."));
    updateSelection({ scroll: false });
    setGalleryStatus(error?.message || "Owner command failed.");
    return { succeeded: [], failed: requestedIds.map((photoId) => ({ photoId, reason: error?.message || "Owner command failed." })) };
  }
};

const burstCandidateIds = () => {
  const resolver = ownerAdapterMethod("burstCandidates");
  if (!resolver || !primaryPhotoId) return null;
  try {
    const result = resolver({ primaryPhotoId, loadedPhotoIds: renderedGalleryPhotos.map((photo) => photo.id) });
    if (!Array.isArray(result)) return null;
    const loadedIds = new Set(renderedGalleryPhotos.map((photo) => photo.id));
    return [...new Set(result.map(String).filter((photoId) => loadedIds.has(photoId)))].slice(0, selectionLimit);
  } catch {
    return null;
  }
};

const selectBurstCandidates = () => {
  const previous = captureSelectionSnapshot();
  const candidateIds = burstCandidateIds();
  if (!candidateIds?.length) return false;
  try {
    selectedPhotoIds.clear();
    selectionRecency = [];
    candidateIds.forEach((photoId) => {
      selectedPhotoIds.add(photoId);
      selectionRecency.push(photoId);
    });
    primaryPhotoId = candidateIds.includes(previous.primaryPhotoId) ? previous.primaryPhotoId : candidateIds[0];
    selectionAnchorPhotoId = primaryPhotoId;
    updateSelection({ scroll: false });
    syncSelectionDetailContext();
    setGalleryStatus(`${candidateIds.length} burst candidate${candidateIds.length === 1 ? "" : "s"} selected.`);
    return true;
  } catch (error) {
    selectedPhotoIds.clear();
    previous.selectedIds.forEach((photoId) => selectedPhotoIds.add(photoId));
    primaryPhotoId = previous.primaryPhotoId;
    selectionAnchorPhotoId = previous.anchorPhotoId;
    selectionRecency = previous.selectionRecency;
    updateSelection({ scroll: false });
    setGalleryStatus(error?.message || "Could not resolve burst candidates.");
    return false;
  }
};

const openSelectedDetail = (photo = selectedShortcutPhoto()) => {
  if (!photo?.id) return false;
  syncSelectionDetailContext();
  window.location.assign(detailHrefForPhotoId(photo.id));
  return true;
};

const quickLookContext = (photo) => ({ surface: "quick-look", currentPhoto: photo });

const openGalleryPreview = () => {
  const selected = selectedShortcutPhoto();
  if (!selected) return false;
  const returnCommandId = document.activeElement?.dataset?.galleryCommand || "";
  const selectedItems = selectedPhotosInOrder();
  const selectedNavigation = selectedItems.length > 1;
  const items = selectedNavigation ? selectedItems : [...renderedGalleryPhotos];
  const index = Math.max(0, items.findIndex((photo) => photo.id === selected.id));
  window.photosByElieOpenFinderPreview?.(selected, {
    owner: ownerCullingEnabled,
    items,
    index,
    wrapNavigation: selectedNavigation,
    navigationKind: selectedNavigation ? "selected" : "loaded",
    quickLookCommands: (photo) => galleryCommandRegistry?.list({ context: quickLookContext(photo) })
      .filter((command) => command.quickLookLegend && command.enabled)
      .map((command) => ({
        id: command.id,
        label: command.label,
        shortcutLabel: command.shortcutLabel,
        selectionEffect: command.selectionEffect,
      })),
    dispatchQuickLookCommand: (commandId, photo, event) => galleryCommandRegistry?.dispatch(commandId, {
      source: "quick-look",
      event,
      context: quickLookContext(photo),
    }),
    restoreFocus: () => {
      const commandButton = returnCommandId
        ? galleryCommandBar?.querySelector(`[data-gallery-command="${CSS.escape(returnCommandId)}"]`)
        : null;
      const cardButton = galleryRoot?.querySelector(
        `[data-gallery-select-photo][data-photo-id="${CSS.escape(selected.id)}"]`
      );
      (commandButton || cardButton)?.focus({ preventScroll: true });
    },
  });
  return true;
};

const commandShortcut = (key, options = {}) => ({ key, ...options });
const focusedControlOwnsGalleryKey = (target, key) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  // Clicking a card's selection button must not consume the next mutation
  // shortcut. Preserve only the keys that activate the focused button itself.
  return target.tagName === "BUTTON" && [" ", "Spacebar", "Enter"].includes(key);
};
const ownerCapabilityState = (methodName, activeReason = "Requires the active Backstage fixture session.") => ({
  enabled: Boolean(ownerAdapterMethod(methodName)) && selectedPhotoIds.size > 0,
  disabledReason: selectedPhotoIds.size ? activeReason : "Select at least one photo.",
});

const ownerCommandPhotos = (context = {}) => context.currentPhoto?.id
  ? [context.currentPhoto]
  : selectedOwnerPhotos();

const clearFixtureDecisionState = (context = {}) => {
  const photos = ownerCommandPhotos(context);
  const placements = new Set(photos.map((photo) => (
    String(photo?.ownerState?.placement || "undecided").trim().toLowerCase() || "undecided"
  )));
  const hiddenOnly = placements.size === 1 && placements.has("hidden");
  const pickedOnly = placements.size === 1 && placements.has("picked");
  const actionable = [...placements].some((placement) => placement !== "undecided");
  return {
    label: hiddenOnly ? "Unhide" : pickedOnly ? "Unpick" : "Clear decisions",
    tooltip: hiddenOnly
      ? "Return the hidden selection to Undecided."
      : pickedOnly
        ? "Return the picked selection to Undecided."
        : "Return the selected fixture decisions to Undecided.",
    enabled: Boolean(ownerAdapterMethod("unpick")) && photos.length > 0 && actionable,
    disabledReason: !photos.length
      ? "Select at least one photo."
      : !ownerAdapterMethod("unpick")
        ? "Requires the active Backstage fixture session."
        : "The selection is already Undecided.",
  };
};

const galleryCommands = [
  {
    id: "select-all", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "selection", order: 10,
    label: "Select All", icon: "☑", shortcut: commandShortcut("a", { primary: true }),
    shortcutLabel: () => `${primaryShortcutLabel()}A`, selectionEffect: "add-loaded", executionScope: "loaded",
    state: () => ({
      enabled: renderedGalleryPhotos.some((photo) => !selectedPhotoIds.has(photo.id)) && selectedPhotoIds.size < selectionLimit,
      disabledReason: selectedPhotoIds.size >= selectionLimit ? `Selection is limited to ${selectionLimit} photos.` : "All loaded photos are selected.",
    }),
    execute: selectAllLoadedPhotos,
  },
  {
    id: "clear-selection", roles: ["visitor"], surfaces: ["gallery"], group: "selection", order: 20,
    label: "Clear Selection", icon: "×", shortcut: "Escape", shortcutLabel: "Esc", selectionEffect: "clear",
    state: () => ({ enabled: selectedPhotoIds.size > 0, disabledReason: "No photos are selected." }),
    execute: clearVisitorSelection,
  },
  {
    id: "keep-primary", roles: ["owner"], surfaces: ["gallery"], group: "selection", order: 20,
    label: "Keep Primary", icon: "◎", shortcut: "Escape", shortcutLabel: "Esc", selectionEffect: "keep-primary",
    state: () => ({ enabled: selectedPhotoIds.size > 1, disabledReason: "Only the primary photo is selected." }),
    execute: keepOwnerPrimary,
  },
  {
    id: "toggle-selection", roles: ["visitor", "owner"], surfaces: ["quick-look"], group: "selection", order: 30,
    label: (context) => selectedPhotoIds.has(context.currentPhoto?.id) ? "Deselect" : "Select",
    icon: "✓", shortcut: "s", shortcutLabel: "S", quickLookLegend: true, selectionEffect: "toggle-current",
    state: (context) => ({ enabled: Boolean(context.currentPhoto?.id), disabledReason: "No current photo." }),
    execute: (context) => toggleGalleryPhotoSelection(context.currentPhoto?.id),
  },
  {
    id: "undo", roles: ["owner"], surfaces: ["gallery"], group: "selection", order: 40,
    label: "Undo", icon: "↶", shortcut: commandShortcut("z", { primary: true }),
    shortcutLabel: () => `${primaryShortcutLabel()}Z`, selectionEffect: "restore-snapshot",
    state: () => ({ hidden: !lastUndoableOwnerAction, enabled: Boolean(lastUndoableOwnerAction), disabledReason: "No undoable command." }),
    execute: undoLastOwnerCommand,
  },
  {
    id: "preview", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "view", order: 10,
    label: "Preview", icon: "◉", shortcut: " ", shortcutLabel: "Space", executionScope: "explicit-primary",
    state: () => ({ enabled: Boolean(selectedShortcutPhoto()), disabledReason: "Select a photo to preview." }),
    execute: openGalleryPreview,
  },
  {
    id: "detail", roles: ["owner"], surfaces: ["gallery"], group: "view", order: 20,
    label: "Detail", icon: "↗", shortcut: "Enter", shortcutLabel: "Enter", executionScope: "primary",
    state: () => ({ enabled: Boolean(selectedShortcutPhoto()), disabledReason: "No primary photo." }),
    execute: () => openSelectedDetail(),
  },
  {
    id: "density-more", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "view", order: 30,
    label: "More Photos", icon: "−", shortcut: commandShortcut("G", { caseSensitive: true }), shortcutLabel: "G",
    state: () => ({ enabled: preferredDensityColumns() < maxDensityColumns(), disabledReason: "Already showing the most columns." }),
    execute: () => stepGalleryDensity(1),
  },
  {
    id: "density-less", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "view", order: 40,
    label: "Fewer Photos", icon: "+", shortcut: commandShortcut("g", { caseSensitive: true }), shortcutLabel: "g",
    state: () => ({ enabled: preferredDensityColumns() > 1, disabledReason: "Already showing the fewest columns." }),
    execute: () => stepGalleryDensity(-1),
  },
  {
    id: "fit-fill", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "view", order: 50,
    label: () => preferredFitMode() === "fill" ? "Fit" : "Fill", icon: "↔", shortcut: "z", shortcutLabel: "Z",
    execute: () => {
      const mode = toggleGalleryFitMode();
      setGalleryStatus(galleryFitModeStatus(mode));
    },
  },
  ...[0, 1, 2, 3, 4, 5].map((rating) => ({
    id: `rating-${rating}`, roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "actions-rating-color", order: rating,
    label: rating ? `Rating ${rating}` : "Clear Rating", icon: rating ? "★" : "☆", shortcut: String(rating), shortcutLabel: String(rating),
    quickLookLegend: true, selectionEffect: "preserve", executionScope: "selection-or-current",
    ratingValue: rating,
    state: () => ownerCapabilityState("setRating"),
    execute: (context) => runOwnerAdapterCommand("setRating", { value: rating, currentPhoto: context.currentPhoto }),
  })),
  ...[[6, "red"], [7, "yellow"], [8, "green"], [9, "blue"]].map(([key, color], index) => ({
    id: `color-${color}`, roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "actions-rating-color", order: 10 + index,
    label: `${color[0].toUpperCase()}${color.slice(1)}`, icon: "●", shortcut: String(key), shortcutLabel: String(key),
    quickLookLegend: true, selectionEffect: "preserve", executionScope: "selection-or-current",
    colorValue: color,
    state: () => ownerCapabilityState("setColor"),
    execute: (context) => runOwnerAdapterCommand("setColor", { value: color, currentPhoto: context.currentPhoto }),
  })),
  {
    id: "like", roles: ["visitor", "owner"], surfaces: ["gallery", "quick-look"], group: "workflow", order: 10,
    label: "Like", icon: "♥", shortcut: "l", shortcutLabel: "L", quickLookLegend: true,
    selectionEffect: (context) => context.role === "visitor" ? "clear-successes" : "preserve",
    state: (context) => ({
      enabled: context.surface === "quick-look" ? Boolean(context.currentPhoto?.id) : selectedPhotoIds.size > 0,
      disabledReason: "Select at least one photo.",
    }),
    execute: (context) => context.surface === "quick-look" ? toggleGalleryLike(context.currentPhoto) : likeSelectedPhotos(),
  },
  {
    id: "pick", roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "workflow", order: 20,
    label: "Pick", icon: "P", shortcut: "p", shortcutLabel: "P", quickLookLegend: true, selectionEffect: "preserve",
    state: () => isPBEOwnerGallery
      ? { hidden: true, enabled: false, disabledReason: "Already in the picked Owner fixture." }
      : ownerWorkflowContext() === "review"
      ? { enabled: false, disabledReason: "Already picked." }
      : ownerCapabilityState("pick"),
    execute: (context) => runOwnerAdapterCommand("pick", { currentPhoto: context.currentPhoto }),
  },
  {
    id: "hide", roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "workflow", order: 30,
    label: "Hide", icon: "H", shortcut: "h", shortcutLabel: "H", quickLookLegend: true,
    tooltip: "Fixture-local Hide; never a global tombstone.", selectionEffect: "remove-successes",
    state: () => ownerCapabilityState("hide"),
    execute: (context) => runOwnerAdapterCommand("hide", {
      removes: !selectedOwnerPlacementFilters().has("hidden"),
      currentPhoto: context.currentPhoto,
    }),
  },
  {
    id: "review", roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "workflow", order: 40,
    label: "Review", icon: "R", shortcut: "r", shortcutLabel: "R", quickLookLegend: true, selectionEffect: "remove-successes",
    state: () => ownerWorkflowContext() === "review"
      ? { enabled: false, disabledReason: "Already in Review." }
      : ownerCapabilityState("review"),
    execute: (context) => runOwnerAdapterCommand("review", { removes: !isPBEOwnerGallery, currentPhoto: context.currentPhoto }),
  },
  {
    id: "waste-basket", roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "workflow", order: 50,
    label: "Waste Basket", icon: "X", shortcut: "x", shortcutLabel: "X",
    tooltip: "Recoverable Waste Basket through the PBB-79 lifecycle gateway.", selectionEffect: "remove-successes", quickLookLegend: true,
    state: (context) => ({
      enabled: context.surface === "quick-look" ? Boolean(context.currentPhoto?.id) : selectedPhotoIds.size > 0,
      disabledReason: "Select at least one photo.",
    }),
    execute: (context) => moveOwnerSelectionToWasteBasket(context.currentPhoto?.id ? [context.currentPhoto.id] : null),
  },
  {
    id: "unpick", roles: ["owner"], surfaces: ["gallery", "quick-look"], group: "workflow", order: 60,
    label: "Clear decisions", icon: "U", shortcut: "u", shortcutLabel: "U", quickLookLegend: true,
    selectionEffect: "remove-successes",
    state: clearFixtureDecisionState,
    execute: (context) => runOwnerAdapterCommand("unpick", {
      removes: !selectedOwnerPlacementFilters().has("undecided"),
      currentPhoto: context.currentPhoto,
    }),
  },
  {
    id: "burst", roles: ["owner"], surfaces: ["gallery"], group: "filters", order: 10,
    label: () => `Burst ${burstCandidateIds()?.length || 0}`, icon: "B", selectionEffect: "replace",
    state: () => {
      const candidates = burstCandidateIds();
      const current = new Set(selectedPhotoIds);
      const same = candidates?.length === current.size && candidates.every((photoId) => current.has(photoId));
      const count = candidates?.length || 0;
      return {
        enabled: Boolean(count) && !same,
        disabledReason: !candidates ? "Canonical Backstage burst detection is unavailable." : same
          ? `These ${count} burst candidates are already selected.`
          : "No loaded burst candidates.",
        tooltip: `Selects ${count} burst candidate${count === 1 ? "" : "s"}, losing the current ${selectedPhotoIds.size}-item selection.`,
      };
    },
    execute: selectBurstCandidates,
  },
  {
    id: "approve", roles: ["owner"], surfaces: ["gallery", "quick-look"], workflows: ["review"], group: "workflow", order: 80,
    label: "Approve", icon: "A", shortcut: "a", shortcutLabel: "A", quickLookLegend: true, selectionEffect: "remove-successes",
    state: () => ownerCapabilityState("approve"),
    execute: (context) => runOwnerAdapterCommand("approve", { removes: true, currentPhoto: context.currentPhoto }),
  },
  {
    id: "needs-ai", roles: ["owner"], surfaces: ["gallery", "quick-look"], workflows: ["review"], group: "workflow", order: 90,
    label: "Needs AI", icon: "N", shortcut: "n", shortcutLabel: "N", quickLookLegend: true, selectionEffect: "remove-successes",
    state: () => ownerCapabilityState("needsAi"),
    execute: (context) => runOwnerAdapterCommand("needsAi", { removes: true, currentPhoto: context.currentPhoto }),
  },
];

const galleryCommandContext = () => ({
  role: galleryRole,
  surface: "gallery",
  workflow: ownerWorkflowContext(),
  selectedIds: [...selectedPhotoIds],
  selectionCount: selectedPhotoIds.size,
  primaryPhotoId,
  loadedIds: renderedGalleryPhotos.map((photo) => photo.id),
  selectionLimit,
});

const readActionLabelSetting = () => {
  try {
    return localStorage.getItem(galleryActionLabelsKey) === "true";
  } catch {
    return false;
  }
};

const applyActionLabelSetting = (enabled = readActionLabelSetting()) => {
  document.documentElement.dataset.galleryActionLabels = String(Boolean(enabled));
};

const ensureActionLabelSetting = () => {
  applyActionLabelSetting();
  const settingsDialog = document.querySelector("[data-settings-modal] .site-settings-dialog");
  if (!settingsDialog || settingsDialog.querySelector("[data-gallery-action-label-setting]")) return;
  const label = document.createElement("label");
  label.className = "site-settings-check gallery-action-label-setting";
  label.innerHTML = `
    <input type="checkbox" data-gallery-action-label-setting${readActionLabelSetting() ? " checked" : ""}>
    <span>Show action labels</span>
  `;
  label.querySelector("input")?.addEventListener("change", (event) => {
    const enabled = Boolean(event.target.checked);
    try {
      localStorage.setItem(galleryActionLabelsKey, String(enabled));
    } catch {}
    applyActionLabelSetting(enabled);
  });
  settingsDialog.append(label);
};

const commandButtonHtml = (command) => {
  const title = command.enabled ? command.tooltip : command.disabledReason;
  return `
    <button class="gallery-command-button" type="button" data-gallery-command="${escapeHtml(command.id)}"
      ${command.enabled ? "" : "disabled"} title="${escapeHtml(title)}" aria-label="${escapeHtml(`${command.label}${command.shortcutLabel ? ` (${command.shortcutLabel})` : ""}${command.enabled ? "" : `. ${command.disabledReason}`}`)}">
      <span class="gallery-command-icon" aria-hidden="true">${escapeHtml(command.icon)}</span>
      <span class="gallery-command-label">${escapeHtml(command.label)}</span>
      ${command.shortcutLabel ? `<span class="gallery-command-shortcut" aria-hidden="true">(${escapeHtml(command.shortcutLabel)})</span>` : ""}
    </button>
  `;
};

const selectedOwnerPhotos = () => {
  const selected = new Set(selectedPhotoIds);
  return renderedGalleryPhotos.filter((photo) => selected.has(photo.id));
};

const commonOwnerValue = (key, fallback) => {
  const values = selectedOwnerPhotos().map((photo) => photo?.ownerState?.[key] ?? fallback);
  if (!values.length) return { value: fallback, mixed: false };
  const value = values[0];
  return { value, mixed: values.some((candidate) => candidate !== value) };
};

const ratingSliderHtml = (commands) => {
  const command = commands.find((candidate) => candidate.ratingValue === 0) || commands[0];
  const { value, mixed } = commonOwnerValue("rating", 0);
  const rating = Math.max(0, Math.min(5, Number(value) || 0));
  const title = command.enabled
    ? mixed ? "Set one rating for the mixed selection." : `Rating ${rating}. Drag, click, or use 0–5.`
    : command.disabledReason;
  const stars = Array.from({ length: 5 }, (_, index) => `
    <span class="gallery-rating-star${!mixed && index < rating ? " is-filled" : ""}" aria-hidden="true">★</span>
  `).join("");
  return `
    <span class="gallery-rating-slider${mixed ? " is-mixed" : ""}"
      data-gallery-rating-slider data-rating="${rating}" role="slider"
      aria-label="Rating"
      aria-valuemin="0" aria-valuemax="5" aria-valuenow="${rating}"
      aria-valuetext="${mixed ? "Mixed ratings" : rating ? `${rating} stars` : "Unrated"}"
      aria-disabled="${!command.enabled}" tabindex="${command.enabled ? "0" : "-1"}" title="${escapeHtml(title)}">
      <span class="gallery-rating-zero" aria-hidden="true">○</span>${stars}
      <span class="gallery-command-shortcut" aria-hidden="true">(0–5)</span>
    </span>
  `;
};

const colorSwatchHtml = (command) => {
  const current = commonOwnerValue("color", "");
  const applied = !current.mixed && current.value === command.colorValue;
  const title = command.enabled ? `${command.label} (${command.shortcutLabel})` : command.disabledReason;
  return `
    <button class="gallery-color-swatch is-${escapeHtml(command.colorValue)}${applied ? " is-applied" : ""}"
      type="button" data-gallery-command="${escapeHtml(command.id)}"
      ${command.enabled ? "" : "disabled"} title="${escapeHtml(title)}"
      aria-label="${escapeHtml(`${command.label} (${command.shortcutLabel})${applied ? ", applied" : ""}${command.enabled ? "" : `. ${command.disabledReason}`}`)}"
      aria-pressed="${applied}"><span aria-hidden="true"></span></button>
  `;
};

const commandGroupHtml = (entry) => {
  if (entry.group !== "actions-rating-color") return entry.commands.map(commandButtonHtml).join("");
  const ratings = entry.commands.filter((command) => Number.isInteger(command.ratingValue));
  const colors = entry.commands.filter((command) => command.colorValue);
  return `${ratingSliderHtml(ratings)}${colors.map(colorSwatchHtml).join("")}`;
};

const ownerRatingFilterHtml = () => {
  const rating = ownerMinRatingFilter();
  const stars = Array.from({ length: 5 }, (_, index) => `
    <span class="gallery-rating-star${index < rating ? " is-filled" : ""}" aria-hidden="true">★</span>
  `).join("");
  return `
    <span class="gallery-rating-slider gallery-rating-filter" data-gallery-rating-filter data-rating="${rating}"
      role="slider" aria-label="Minimum rating filter" aria-valuemin="0" aria-valuemax="5"
      aria-valuenow="${rating}" aria-valuetext="${rating ? `${rating} stars or more` : "All ratings"}"
      tabindex="0" title="Show photos rated ${rating ? `${rating} stars or more` : "0–5"}">
      <span class="gallery-rating-zero" aria-hidden="true">○</span>${stars}
    </span>
  `;
};

const ownerColorFilterHtml = () => {
  const selected = selectedOwnerColorFilters();
  return ownerColorFilterValues.map((color) => {
    const active = selected.has(color);
    const label = color === "none" ? "No color" : `${color[0].toUpperCase()}${color.slice(1)}`;
    return `
      <button class="gallery-color-swatch gallery-color-filter is-${escapeHtml(color)}${active ? " is-applied" : ""}"
        type="button" data-gallery-owner-color-filter="${escapeHtml(color)}" title="Filter: ${escapeHtml(label)}"
        aria-label="Filter by ${escapeHtml(label)}" aria-pressed="${active}">
        <span aria-hidden="true">${color === "none" ? "∕" : ""}</span>
      </button>
    `;
  }).join("");
};

const ownerPlacementFilterHtml = () => {
  const selected = selectedOwnerPlacementFilters();
  return ownerPlacementFilterValues.map((placement) => {
    const active = selected.has(placement);
    const label = `${placement[0].toUpperCase()}${placement.slice(1)}`;
    return `
      <button class="gallery-command-button gallery-placement-filter${active ? " is-applied" : ""}"
        type="button" data-gallery-owner-placement-filter="${escapeHtml(placement)}"
        title="Filter: ${escapeHtml(label)}" aria-label="Filter by ${escapeHtml(label)}"
        aria-pressed="${active}">
        <span class="gallery-command-label">${escapeHtml(label)}</span>
      </button>
    `;
  }).join("");
};

const galleryCommandGroupsHtml = (groups) => groups.map((entry) => `
  <span class="gallery-command-group" role="group" aria-label="${escapeHtml(entry.group.replaceAll("-", " "))}">
    ${commandGroupHtml(entry)}
  </span>
`).join("");

const bindOwnerRatingFilter = (root) => {
  const ratingFilter = root?.querySelector("[data-gallery-rating-filter]");
  let ratingFilterPointerActive = false;
  ratingFilter?.addEventListener("pointerdown", (event) => {
    ratingFilterPointerActive = true;
    ratingFilter.setPointerCapture?.(event.pointerId);
    previewRatingSlider(ratingFilter, ratingFromPointer(event, ratingFilter));
  });
  ratingFilter?.addEventListener("pointermove", (event) => {
    if (ratingFilterPointerActive) previewRatingSlider(ratingFilter, ratingFromPointer(event, ratingFilter));
  });
  ratingFilter?.addEventListener("pointerup", () => {
    if (!ratingFilterPointerActive) return;
    ratingFilterPointerActive = false;
    commitOwnerFilterState({ ownerMinRating: Number(ratingFilter.dataset.rating) || 0 });
  });
  ratingFilter?.addEventListener("pointercancel", () => { ratingFilterPointerActive = false; });
  ratingFilter?.addEventListener("keydown", (event) => {
    const current = Number(ratingFilter.dataset.rating) || 0;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? 5
        : ["ArrowRight", "ArrowUp"].includes(event.key) ? Math.min(5, current + 1)
          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? Math.max(0, current - 1)
            : null;
    if (next === null) return;
    event.preventDefault();
    commitOwnerFilterState({ ownerMinRating: next });
  });
};

const renderOwnerFilterRow = () => {
  const row = filterBar?.querySelector("[data-gallery-owner-filter-row]");
  if (!row || !galleryCommandRegistry) return;
  const focusedRatingFilter = Boolean(document.activeElement?.matches?.("[data-gallery-rating-filter]"));
  const focusedColorFilter = document.activeElement?.dataset?.galleryOwnerColorFilter || "";
  const focusedPlacementFilter = document.activeElement?.dataset?.galleryOwnerPlacementFilter || "";
  const burst = galleryCommandRegistry.list().find((command) => command.id === "burst");
  row.innerHTML = `
    <span class="gallery-owner-filter-label">Filters</span>
    ${ownerPlacementFilterHtml()}
    ${burst ? commandButtonHtml(burst) : ""}
    ${ownerRatingFilterHtml()}${ownerColorFilterHtml()}
  `;
  row.querySelector("[data-gallery-command=\"burst\"]")?.addEventListener("click", async () => {
    await galleryCommandRegistry.dispatch("burst", { source: "filter" });
    renderGalleryCommandBar();
  });
  bindOwnerRatingFilter(row);
  row.querySelectorAll("[data-gallery-owner-color-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = selectedOwnerColorFilters();
      const color = button.dataset.galleryOwnerColorFilter;
      if (selected.has(color)) selected.delete(color);
      else selected.add(color);
      commitOwnerFilterState({ ownerColors: ownerColorFilterValues.filter((candidate) => selected.has(candidate)).join(",") });
    });
  });
  row.querySelectorAll("[data-gallery-owner-placement-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = selectedOwnerPlacementFilters();
      const placement = button.dataset.galleryOwnerPlacementFilter;
      if (selected.has(placement)) selected.delete(placement);
      else selected.add(placement);
      if (!selected.size) selected.add("picked");
      commitOwnerFilterState({
        ownerPlacements: ownerPlacementFilterValues.filter((candidate) => selected.has(candidate)).join(","),
      });
    });
  });
  if (focusedRatingFilter) row.querySelector("[data-gallery-rating-filter]")?.focus({ preventScroll: true });
  else if (focusedColorFilter) row.querySelector(`[data-gallery-owner-color-filter="${CSS.escape(focusedColorFilter)}"]`)?.focus({ preventScroll: true });
  else if (focusedPlacementFilter) row.querySelector(`[data-gallery-owner-placement-filter="${CSS.escape(focusedPlacementFilter)}"]`)?.focus({ preventScroll: true });
};

const ownerCommandSectionsHtml = (groups) => {
  const viewGroups = groups.filter((entry) => ["selection", "view"].includes(entry.group));
  const actionGroups = groups.filter((entry) => !["filters", "selection", "view"].includes(entry.group));
  return `
    <span class="gallery-command-section is-view" role="group" aria-label="Selection and view">
      ${galleryCommandGroupsHtml(viewGroups)}
    </span>
    <span class="gallery-command-section is-actions" role="group" aria-label="Actions">
      <span class="gallery-command-section-label">Actions</span>${galleryCommandGroupsHtml(actionGroups)}
    </span>
  `;
};

const ratingFromPointer = (event, element) => {
  const bounds = element.getBoundingClientRect();
  if (!bounds.width) return 0;
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  return Math.max(0, Math.min(5, Math.round(ratio * 5)));
};

const dispatchRating = async (rating) => {
  await galleryCommandRegistry.dispatch(`rating-${Math.max(0, Math.min(5, rating))}`, { source: "rating-slider" });
  renderGalleryCommandBar();
};

const previewRatingSlider = (element, rating) => {
  const value = Math.max(0, Math.min(5, rating));
  element.dataset.rating = String(value);
  element.setAttribute("aria-valuenow", String(value));
  element.setAttribute("aria-valuetext", value ? `${value} stars` : "Unrated");
  element.classList.remove("is-mixed");
  element.querySelectorAll(".gallery-rating-star").forEach((star, index) => {
    star.classList.toggle("is-filled", index < value);
  });
};

const commitOwnerFilterState = (updates) => {
  filterState = { ...filterState, ...updates };
  writeFilterState();
  cancelPaginationSequence();
  resetGalleryWindow();
  selectedIndex = 0;
  renderGallery({ scrollSelection: false });
};

const mountPBEOwnerSessionInCommandBar = (sessionRoot = document.querySelector("[data-pbe-owner-session]")) => {
  if (!isPBEOwnerGallery || !sessionRoot || !galleryCommandBar) return;
  const commandScroll = galleryCommandBar.querySelector("[data-gallery-command-scroll]");
  if (!commandScroll) return;
  commandScroll.append(sessionRoot);
  sessionRoot.classList.add("is-command-mounted");
  document.body.classList.add("pbe-owner-session-command-mounted");
};

const renderGalleryCommandBar = () => {
  if (!galleryCommandBar || !galleryCommandRegistry) return;
  const ownerSessionRoot = isPBEOwnerGallery
    ? document.querySelector("[data-pbe-owner-session]")
    : null;
  const focusedCommand = document.activeElement?.dataset?.galleryCommand || "";
  const focusedRating = Boolean(document.activeElement?.matches?.("[data-gallery-rating-slider]"));
  const commands = galleryCommandRegistry.list();
  const groups = galleryCommandModel.GROUP_ORDER
    .map((group) => ({ group, commands: commands.filter((command) => command.group === group) }))
    .filter((entry) => entry.commands.length);
  galleryCommandBar.innerHTML = `
    <div class="gallery-command-scroll" data-gallery-command-scroll>
      <span class="gallery-command-count-slot" data-gallery-command-count-slot></span>
      ${isPBEOwnerGallery ? ownerCommandSectionsHtml(groups) : galleryCommandGroupsHtml(groups)}
    </div>
  `;
  const countSlot = galleryCommandBar.querySelector("[data-gallery-command-count-slot]");
  if (countSlot && gallerySelectionCount) countSlot.append(gallerySelectionCount);
  galleryCommandBar.querySelectorAll("[data-gallery-command]").forEach((button) => {
    button.addEventListener("click", async () => {
      await galleryCommandRegistry.dispatch(button.dataset.galleryCommand, { source: "button" });
      renderGalleryCommandBar();
    });
  });
  const ratingSlider = galleryCommandBar.querySelector("[data-gallery-rating-slider]");
  let ratingPointerActive = false;
  if (ratingSlider?.getAttribute("aria-disabled") !== "true") {
    ratingSlider?.addEventListener("pointerdown", (event) => {
      ratingPointerActive = true;
      ratingSlider.setPointerCapture?.(event.pointerId);
      previewRatingSlider(ratingSlider, ratingFromPointer(event, ratingSlider));
    });
    ratingSlider?.addEventListener("pointermove", (event) => {
      if (ratingPointerActive) previewRatingSlider(ratingSlider, ratingFromPointer(event, ratingSlider));
    });
    ratingSlider?.addEventListener("pointerup", () => {
      if (!ratingPointerActive) return;
      ratingPointerActive = false;
      dispatchRating(Number(ratingSlider.dataset.rating) || 0);
    });
    ratingSlider?.addEventListener("pointercancel", () => { ratingPointerActive = false; });
  }
  ratingSlider?.addEventListener("keydown", (event) => {
    const current = Number(ratingSlider.dataset.rating) || 0;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? 5
        : ["ArrowRight", "ArrowUp"].includes(event.key) ? Math.min(5, current + 1)
          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? Math.max(0, current - 1)
            : null;
    if (next === null) return;
    event.preventDefault();
    dispatchRating(next);
  });
  renderOwnerFilterRow();
  mountPBEOwnerSessionInCommandBar(ownerSessionRoot);
  if (focusedCommand) galleryCommandBar.querySelector(`[data-gallery-command="${CSS.escape(focusedCommand)}"]`)?.focus({ preventScroll: true });
  else if (focusedRating) galleryCommandBar.querySelector("[data-gallery-rating-slider]")?.focus({ preventScroll: true });
  const height = Math.ceil(galleryCommandBar.getBoundingClientRect().height);
  if (height) document.documentElement.style.setProperty("--gallery-command-bar-height", `${height}px`);
};

const ensureGalleryCommandBar = () => {
  if (galleryCommandBar) return;
  galleryCommandRegistry = galleryCommandModel.createRegistry({
    commands: galleryCommands,
    getContext: galleryCommandContext,
    onDisabled: (command) => setGalleryStatus(command.disabledReason),
  });
  galleryCommandBar = document.createElement("nav");
  galleryCommandBar.className = "gallery-command-bar";
  galleryCommandBar.dataset.galleryCommandBar = "";
  galleryCommandBar.setAttribute("aria-label", `${galleryRole === "owner" ? "Owner" : "Visitor"} gallery actions`);
  document.querySelector(".topbar")?.after(galleryCommandBar);
  syncGalleryCommandBar = renderGalleryCommandBar;
  renderGalleryCommandBar();
  ensureActionLabelSetting();
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      const height = Math.ceil(galleryCommandBar.getBoundingClientRect().height);
      if (height) document.documentElement.style.setProperty("--gallery-command-bar-height", `${height}px`);
    }).observe(galleryCommandBar);
  }
};

const renderGallery = ({ scrollSelection = true } = {}) => {
  const allPhotos = visiblePhotos();
  const photos = filteredVisiblePhotos(allPhotos);
  ensureOwnerSelection(photos);
  const likedIds = likedPhotoIds();
  if (isSelectionGallery && !activeFilterCount()) {
    writeDetailSequenceContext([]);
    renderedGalleryPhotos = [];
    galleryRoot.innerHTML = "";
    applyGalleryPreviewLayout([]);
    if (lessButton) lessButton.hidden = true;
    if (lessDoubleButton) lessDoubleButton.hidden = true;
    if (lessQuadButton) lessQuadButton.hidden = true;
    if (moreButton) moreButton.hidden = true;
    if (moreDoubleButton) moreDoubleButton.hidden = true;
    if (moreQuadButton) moreQuadButton.hidden = true;
    if (lessButton?.closest(".gallery-pagination-controls")) lessButton.closest(".gallery-pagination-controls").hidden = true;
    if (moreButton?.closest(".gallery-pagination-controls")) moreButton.closest(".gallery-pagination-controls").hidden = true;
    setGalleryStatus("");
    return;
  }
  if (pendingGalleryReturnState?.visibleLimit === "all") {
    visibleStart = 0;
    visibleLimit = Math.min(photos.length, maxRenderedPhotos);
  } else if (pendingGalleryReturnState?.visibleLimit) {
    const savedLimit = Number(pendingGalleryReturnState.visibleLimit);
    const savedStart = Number(pendingGalleryReturnState.visibleStart || 0);
    if (Number.isFinite(savedLimit) && savedLimit > 0) {
      visibleStart = Number.isFinite(savedStart) ? Math.max(0, Math.floor(savedStart)) : 0;
      visibleLimit = Math.max(visibleStart + 1, Math.floor(savedLimit));
    }
  }
  const returnPhotoId = pendingGalleryReturnState?.photoId || "";
  const returnIndex = returnPhotoId ? photos.findIndex((photo) => photo.id === returnPhotoId) : -1;
  if (returnIndex >= 0) expandGalleryToIncludeIndex(returnIndex);
  const durableIndex = pendingDurableGalleryCheckpoint?.photoId
    ? photos.findIndex((photo) => photo.id === pendingDurableGalleryCheckpoint.photoId)
    : -1;
  if (pendingDurableGalleryCheckpoint && durableIndex < 0) {
    pendingDurableGalleryCheckpoint = null;
    resetGalleryWindow();
  }
  const normalizedWindow = galleryWindowModel.normalizeGalleryWindow({
    start: visibleStart,
    end: visibleLimit,
    total: photos.length,
  });
  visibleStart = normalizedWindow.start;
  visibleLimit = normalizedWindow.end;
  const visibleSubset = photos.slice(visibleStart, visibleLimit);
  renderedGalleryPhotos = visibleSubset;
  writeDetailSequenceContext(photos);
  if (returnIndex >= 0) selectedIndex = returnIndex - visibleStart;
  if (returnPhotoId && returnIndex < 0) clearPendingGalleryReturn();
  if (!photos.length) {
    const filteredOut = allPhotos.length > 0 && activeFilterCount() > 0;
    const sharedState = window.photosByElieSharedGalleryState;
    const sharedSignedOut = isSharedGallery && sharedState?.status === "signed-out";
    const emptyMessage = sharedSignedOut
      ? sharedState.message
      : isSharedGallery && sharedState?.message
        ? sharedState.message
        : filteredOut
          ? t("gallery.no_filter_matches")
          : t("gallery.no_visible");
    galleryRoot.innerHTML = `
      <article class="mock-photo empty-gallery-card" aria-label="${gallery.title} gallery empty state">
        <span>${escapeHtml(emptyMessage)}</span>
        ${sharedSignedOut && sharedState.loginUrl ? `<a class="btn primary" href="${escapeHtml(sharedState.loginUrl)}">${t("account.sign_in_google")}</a>` : ""}
        ${filteredOut ? `<button class="btn secondary" type="button" data-clear-gallery-empty>${t("gallery.clear_filters")}</button>` : ""}
      </article>
    `;
    galleryRoot.querySelector("[data-clear-gallery-empty]")?.addEventListener("click", () => {
      filterState = { ...defaultFilterState };
      seedInlineDatePickerSelections();
      writeFilterState();
      syncDateFilterUrl(filterState);
      syncFilterControls();
      cancelPaginationSequence();
      resetGalleryWindow();
      selectedIndex = 0;
      renderGallery({ scrollSelection: false });
    });
    if (lessButton) lessButton.hidden = true;
    if (lessDoubleButton) lessDoubleButton.hidden = true;
    if (lessQuadButton) lessQuadButton.hidden = true;
    if (moreButton) moreButton.hidden = true;
    if (moreDoubleButton) moreDoubleButton.hidden = true;
    if (moreQuadButton) moreQuadButton.hidden = true;
    if (lessButton?.closest(".gallery-pagination-controls")) lessButton.closest(".gallery-pagination-controls").hidden = true;
    if (moreButton?.closest(".gallery-pagination-controls")) moreButton.closest(".gallery-pagination-controls").hidden = true;
    setGalleryStatus(filteredOut
      ? t("gallery.adjust_filters")
      : "");
    applyGalleryPreviewLayout([]);
    return;
  }
  selectedIndex = Math.max(0, Math.min(selectedIndex, visibleSubset.length - 1));
  galleryRoot.innerHTML = visibleSubset.map((photo, index) => {
    const href = detailHrefForPhotoId(photo.id);
    const isLiked = likedIds.has(photo.id);
    const selectButton = `
          <button
            class="gallery-action-toggle gallery-select-toggle${selectedPhotoIds.has(photo.id) ? " is-selected" : ""}"
            type="button"
            data-gallery-select-photo
            data-photo-id="${escapeHtml(photo.id)}"
            aria-label="${selectedPhotoIds.has(photo.id) ? "Remove from selection" : "Add to selection"}"
            aria-pressed="${selectedPhotoIds.has(photo.id) ? "true" : "false"}"
          >${selectedPhotoIds.has(photo.id) ? "✓" : "+"}</button>
    `;
    const likeButton = likedStore ? `
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
      ` : "";
    const ownerPresentation = ownerCardPresentation(photo);
    const actionHtml = `
      <div class="gallery-card-selection">${selectButton}</div>
      ${likeButton ? `<div class="gallery-card-actions">${likeButton}</div>` : ""}
    `;
    return renderSharedPhotoCard({
      photo,
      index,
      href,
      collectionKey: galleryKey,
      actionHtml,
      mediaOverlayHtml: ownerPresentation.html,
      cardClass: ownerPresentation.className,
      ownerEditable: false,
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
  galleryRoot.querySelectorAll("[data-gallery-select-photo]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleGalleryPhotoSelection(button.dataset.photoId, visibleSubset);
    });
  });
  galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
    card.addEventListener("contextmenu", (event) => {
      const index = Number(card.dataset.photoIndex || 0);
      const photo = visibleSubset[index];
      if (!photo) return;
      window.photosByElieShowMediaContextMenu?.(photo, event, {
        owner: fullOwnerToolsEnabled,
        previewItems: visibleSubset,
        previewIndex: index,
        onOpenDetail: () => window.location.assign(versionedHref(card.dataset.photoHref || card.querySelector("[data-photo-link]")?.getAttribute("href"))),
      });
    });
  });
  galleryRoot.querySelectorAll("[data-photo-link]").forEach((link) => {
    link.addEventListener("click", syncSelectionDetailContext);
  });
  if (ownerCullingEnabled) {
    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        event.preventDefault();
        event.stopPropagation();
        const index = Number(card.dataset.photoIndex || 0);
        const photo = visibleSubset[index];
        if (photo) selectOwnerPhotoFromPointer(photo.id, visibleSubset, event);
      }, { capture: true });
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
  restoreDurableGalleryCheckpoint();
  const hasPrevious = visibleStart > 0;
  const hasNext = visibleLimit < photos.length;
  [lessButton, lessDoubleButton, lessQuadButton].forEach((button) => {
    if (button) button.hidden = !hasPrevious;
  });
  [moreButton, moreDoubleButton, moreQuadButton].forEach((button) => {
    if (button) button.hidden = !hasNext;
  });
  const backwardControls = lessButton?.closest(".gallery-pagination-controls");
  const forwardControls = moreButton?.closest(".gallery-pagination-controls");
  if (backwardControls) backwardControls.hidden = !hasPrevious;
  if (forwardControls) forwardControls.hidden = !hasNext;
  syncGallerySelectionToolbar();
  const paginated = hasPrevious || hasNext;
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
  queueGalleryCheckpointWrite();
};

if (galleryRoot && gallery) {
  document.title = `Photos By Elie | ${localizedCollectionTitle()} ${t("nav.gallery")}`;
  const seoPhotos = (gallery.photos || []).slice(0, 12).map((photo) => ({
    image: window.photosByElieMediaUrl?.(photo, "gallery") || window.photosByElieMediaUrl?.(photo, "detail") || "",
  }));
  const seoImage = seoPhotos.find((item) => item.image)?.image || window.photosByElieSeo?.defaultImage;
  const seoDescription = isSelectionGallery
    ? "Search the Photos By Elie public archive by title, place, date, and orientation."
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
    setCollectionLabel(currentNav);
    currentNav.setAttribute("href", versionedHref(galleryHrefForKey(galleryKey)));
  }
  if (document.querySelector("[data-gallery-number]")) document.querySelector("[data-gallery-number]").textContent = `Collection ${gallery.number}`;
  const titleRoot = document.querySelector("[data-gallery-title]");
  if (titleRoot) {
    setCollectionLabel(titleRoot);
  }
  if (document.querySelector("[data-gallery-description]")) document.querySelector("[data-gallery-description]").textContent = gallery.description;
  galleryRoot.classList.add(gallery.accent);
  galleryRoot.setAttribute("aria-label", `${localizedCollectionTitle()} ${t("nav.photos").toLowerCase()}`);
  ensureGalleryFilterControls();
  ensureGallerySelectionToolbar();
  ensureGalleryMoreButton();
  ensureGalleryCommandBar();
  renderGallery({ scrollSelection: false });
  startOwnerSuperSearch();

  const topButton = document.createElement("button");
  topButton.className = "gallery-top-button floating-back-to-top";
  topButton.type = "button";
  topButton.dataset.galleryBackToTop = "";
  topButton.setAttribute("aria-label", t("a11y.back_to_top"));
  topButton.innerHTML = `<span aria-hidden="true">↑</span>`;
  document.body.append(topButton);
  topButton.addEventListener("click", () => {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  });
  window.addEventListener("resize", () => {
    applyGalleryDensity();
    applyGalleryPreviewLayout();
    updateSelection({ scroll: false });
    renderGalleryCommandBar();
  });
  window.addEventListener("load", () => {
    applyGalleryPreviewLayout();
    updateSelection({ scroll: false });
  }, { once: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      applyGalleryPreviewLayout();
      updateSelection({ scroll: false });
      renderGalleryCommandBar();
    }).catch(() => {});
  }
  applyGalleryDensity();
  applyGalleryFitMode();

  window.addEventListener("keydown", async (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (focusedControlOwnsGalleryKey(target, event.key)) return;
    if (ownerCullingEnabled && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const photos = filteredVisiblePhotos();
      if (photos.length && ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
        const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft";
        const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        stepGallerySelection(delta, !horizontal, { extend: event.shiftKey });
        event.preventDefault();
        return;
      }
    }
    const command = galleryCommandRegistry.commandForKeyboard(event);
    if (!command) return;
    event.preventDefault();
    await galleryCommandRegistry.dispatch(command.id, { source: "keyboard", event });
    renderGalleryCommandBar();
  });
  window.addEventListener("photosbyelie:owneractionerror", (event) => {
    setGalleryStatus(event.detail?.message || "Owner action failed.");
  });
  window.addEventListener("scroll", queueGalleryCheckpointWrite, { passive: true });
  window.addEventListener("pagehide", persistGalleryCheckpoint);
  window.addEventListener("photosbyelie:gallerycheckpointschange", () => {
    const checkpoint = durableGalleryCheckpoint();
    if (checkpoint) stageDurableGalleryCheckpoint(checkpoint, { rerender: true });
  });

  if (ownerCullingEnabled) {
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
      setCollectionLabel(document.querySelector("[data-nav-current]"));
      setCollectionLabel(document.querySelector("[data-gallery-title]"));
      syncFilterControls();
      renderGallery({ scrollSelection: false });
      applyGalleryDensity();
    }
  });
window.addEventListener("photosbyelie:likedchange", updateGalleryLikeButtons);
}
})().catch((error) => {
  const failedGalleryKey = String(new URLSearchParams(window.location.search).get("gallery") || "").trim().toLowerCase();
  if (failedGalleryKey === "pbe-owner") {
    document.body.dataset.gallery = "pbe-owner";
    document.querySelector("[data-gallery-root]")?.setAttribute("hidden", "");
  }
  const status = document.querySelector("[data-gallery-status]");
  if (status) status.textContent = error?.message || "Could not load gallery.";
}));
