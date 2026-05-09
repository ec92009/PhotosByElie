const galleryKey = document.body.dataset.gallery;
let gallery = window.photosByElieData?.[galleryKey];
const galleryRoot = document.querySelector("[data-gallery-root]");
const galleryStatus = document.querySelector("[data-gallery-status]");
const hiddenActions = window.photosByElieHiddenActions;
const reserveStore = window.photosByElieReserve;
const likedStore = window.photosByElieLiked;
const localModerationEnabled = Boolean(hiddenActions?.enabled);
const reserveFillEnabled = false;
const galleryActions = document.querySelector("[data-gallery-actions]");
const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
let selectedIndex = 0;
const densityKey = "photosbyelie-gallery-columns";
const fitModeKey = "photosbyelie-gallery-fit-mode";
let densityInput = null;
let densityValue = null;
let fitModeButtons = [];
let viewControls = null;
const filterStateKey = `photosbyelie-gallery-filters-${galleryKey}`;
const detailSequenceKey = "photosbyelie-detail-sequence";
const diversityBucketMinutes = 10;
const defaultFilterState = {
  orientation: "all",
  mood: "all",
  subject: "all",
  sort: "newest"
};
const persistedFilterKeys = ["orientation", "mood", "subject"];
let filterBar = null;

const shortcutKey = (label) => `<kbd>${label}</kbd>`;
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
const localizedCollectionTitle = () => t(`collection.${galleryKey}`) || gallery?.title || "";
const likedPhotoIds = () => new Set(likedStore?.read?.().map((item) => item.photoId) || []);
const shouldShowKeyboardHints = () => window.photosByElieInputMode?.shouldShowKeyboardHints?.() ?? true;
const ensureGalleryKeyboardHint = () => {
  if (!galleryRoot || !localModerationEnabled || document.querySelector("[data-gallery-shortcut-hint]")) return;
  const hint = document.createElement("p");
  hint.className = "keyboard-hint gallery-keyboard-hint";
  hint.dataset.galleryShortcutHint = "";
  hint.innerHTML = [
    "Owner shortcuts:",
    `${shortcutKey("H")} hide`,
    `${shortcutKey("U")} undo`,
    `${shortcutKey("Arrows")} select`,
    `${shortcutKey("Enter")} detail`,
    `${shortcutKey("Double-click")} detail`
  ].join(" <span aria-hidden=\"true\">|</span> ");
  hint.hidden = !shouldShowKeyboardHints();
  galleryRoot.before(hint);
};
window.addEventListener("photosbyelie:inputmodechange", () => {
  const hint = document.querySelector("[data-gallery-shortcut-hint]");
  if (hint) hint.hidden = !localModerationEnabled || !shouldShowKeyboardHints();
});

const readFilterState = () => {
  try {
    const savedState = JSON.parse(localStorage.getItem(filterStateKey) || "{}");
    const persistedState = Object.fromEntries(
      persistedFilterKeys.map((key) => [key, savedState[key] || defaultFilterState[key]])
    );
    return { ...defaultFilterState, ...persistedState };
  } catch {
    return { ...defaultFilterState };
  }
};

let filterState = readFilterState();

const writeFilterState = () => {
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
      createdAt: Date.now()
    }));
  } catch {
    // Detail navigation can fall back to the full catalog if sessionStorage is unavailable.
  }
};

const metadataValue = (photo, label) => (
  (photo?.metadata || []).find((item) => item.label === label)?.value || ""
);

const rawSourceLabel = (photo) => window.photosByElieRawSourceLabel?.(photo) || "";

const photoSearchText = (photo) => [
  photo?.title,
  photo?.caption,
  photo?.full,
  metadataValue(photo, "Keywords"),
  metadataValue(photo, "Description"),
  metadataValue(photo, "Original file"),
  metadataValue(photo, "Original size"),
  metadataValue(photo, "Preview file")
].filter(Boolean).join(" ").toLowerCase();

const previewDimensions = (photo) => {
  const value = metadataValue(photo, "Preview file") || metadataValue(photo, "Original size");
  const match = value.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
};

const photoOrientation = (photo) => {
  const dimensions = previewDimensions(photo);
  if (!dimensions?.width || !dimensions?.height) return "unknown";
  const ratio = dimensions.width / dimensions.height;
  if (ratio > 1.12) return "landscape";
  if (ratio < .9) return "portrait";
  return "square";
};

const photoMoodTags = (photo) => {
  const text = photoSearchText(photo);
  const tags = new Set();
  if (/(sunset|sunrise|gold|yellow|orange|red|beach|desert|summer|warm)/.test(text)) tags.add("warm");
  if (/(ocean|sea|river|water|blue|snow|winter|harbor|harbour|atlantic|seine|cool)/.test(text)) tags.add("cool");
  if (/(gray|grey|unsaturated|black|white|interior|church|museum|palace|castle|architecture)/.test(text)) tags.add("neutral");
  if (/(art|garden|flower|green|color|colour|vivid|market|festival)/.test(text)) tags.add("vivid");
  return tags.size ? tags : new Set(["neutral"]);
};

const photoSubjectTags = (photo) => {
  const text = photoSearchText(photo);
  const tags = new Set();
  if (/(architecture|church|castle|chateau|fortress|palace|monastery|building|interior|invalides|versailles)/.test(text)) tags.add("architecture");
  if (/(ocean|sea|river|water|beach|harbor|harbour|coast|atlantic|seine|boat|bateau)/.test(text)) tags.add("water");
  if (/(art|museum|statue|monet|painting|gallery|sculpture)/.test(text)) tags.add("art");
  if (/(family|person|people|child|mom|bar mitzvah|portrait)/.test(text)) tags.add("people");
  if (/(garden|park|flower|tree|mountain|animal|nature|landscape)/.test(text)) tags.add("nature");
  if (/(city|street|travel|paris|lisbon|lisboa|mexico|slovakia|france|usa|portugal|spain)/.test(text)) tags.add("city");
  return tags.size ? tags : new Set(["other"]);
};

const captureTime = (photo) => {
  const raw = metadataValue(photo, "Captured");
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(.+)$/);
  if (!match) return 0;
  return Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}`) || 0;
};

const verifiedMegapixels = (photo) => (
  window.photosByElieVerifiedMegapixels ? window.photosByElieVerifiedMegapixels(photo) : Number(photo?.megapixels) || 0
);

const maxAvailablePrice = (photo) => {
  const available = window.photosByElieAvailableResolutions
    ? window.photosByElieAvailableResolutions(photo, window.photosByElieResolutions || [])
    : [];
  return Math.max(0, ...available.map((option) => option.price || 0));
};

const activeFilterCount = () => ["orientation", "mood", "subject"]
  .filter((key) => filterState[key] && filterState[key] !== "all").length;

const matchesFilterState = (photo) => {
  if (filterState.orientation !== "all" && photoOrientation(photo) !== filterState.orientation) return false;
  if (filterState.mood !== "all" && !photoMoodTags(photo).has(filterState.mood)) return false;
  if (filterState.subject !== "all" && !photoSubjectTags(photo).has(filterState.subject)) return false;
  return true;
};

const sortPhotos = (photos) => {
  const sorted = [...photos];
  if (filterState.sort === "newest") sorted.sort((a, b) => captureTime(b) - captureTime(a));
  if (filterState.sort === "oldest") sorted.sort((a, b) => captureTime(a) - captureTime(b));
  if (filterState.sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
  if (filterState.sort === "megapixels-desc") sorted.sort((a, b) => verifiedMegapixels(b) - verifiedMegapixels(a));
  if (filterState.sort === "megapixels-asc") sorted.sort((a, b) => verifiedMegapixels(a) - verifiedMegapixels(b));
  if (filterState.sort === "price-desc") sorted.sort((a, b) => maxAvailablePrice(b) - maxAvailablePrice(a));
  if (filterState.sort === "price-asc") sorted.sort((a, b) => maxAvailablePrice(a) - maxAvailablePrice(b));
  return sorted;
};

const filteredVisiblePhotos = (photos = visiblePhotos()) => sortPhotos(photos.filter(matchesFilterState));

const syncFilterControls = () => {
  if (!filterBar) return;
  filterBar.querySelectorAll("[data-gallery-filter]").forEach((control) => {
    control.value = filterState[control.dataset.galleryFilter] || "all";
  });
};

const ensureGalleryFilterControls = () => {
  if (filterBar || !gallery) return;
  const filterTarget = galleryActions || document.querySelector(".gallery-hero");
  if (!filterTarget) return;
  filterBar = document.createElement("form");
  filterBar.className = "gallery-filter-bar";
  filterBar.setAttribute("aria-label", t("a11y.gallery_filters"));
  filterBar.innerHTML = `
    <label><span data-i18n="gallery.orientation">Orientation</span><select data-gallery-filter="orientation">
      <option value="all" data-i18n="gallery.all">All</option>
      <option value="landscape" data-i18n="gallery.landscape">Landscape</option>
      <option value="portrait" data-i18n="gallery.portrait">Portrait</option>
      <option value="square" data-i18n="gallery.square">Square</option>
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
    <label><span data-i18n="gallery.sort">Sort</span><select data-gallery-filter="sort">
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
  `;
  filterTarget.after(filterBar);
  window.photosByElieI18n?.apply?.();
  syncFilterControls();
  filterBar.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  filterBar.addEventListener("change", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLSelectElement) || !control.dataset.galleryFilter) return;
    filterState = { ...filterState, [control.dataset.galleryFilter]: control.value };
    writeFilterState();
    selectedIndex = 0;
    renderGallery();
  });
  filterBar.querySelector("[data-clear-gallery-filters]")?.addEventListener("click", () => {
    filterState = { ...defaultFilterState };
    writeFilterState();
    syncFilterControls();
    selectedIndex = 0;
    renderGallery();
  });
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
  if (!localModerationEnabled) return window.photosByElieFilterPublicHidden?.(basePhotos) || basePhotos;

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
  });
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

const maxDensityColumns = () => {
  if (window.matchMedia("(max-width:760px)").matches) return 3;
  return 10;
};

const defaultDensityColumns = () => {
  if (window.matchMedia("(min-width:1520px)").matches) return 8;
  if (window.matchMedia("(min-width:1120px)").matches) return 6;
  if (window.matchMedia("(min-width:860px)").matches) return 4;
  if (window.matchMedia("(min-width:640px)").matches) return 3;
  return 2;
};

const clampDensityColumns = (columns) => {
  const numericColumns = Number(columns);
  return Math.min(
    Math.max(Number.isFinite(numericColumns) ? numericColumns : defaultDensityColumns(), 1),
    maxDensityColumns()
  );
};

const preferredDensityColumns = () => {
  const savedValue = Number(localStorage.getItem(densityKey));
  return clampDensityColumns(Number.isInteger(savedValue) ? savedValue : defaultDensityColumns());
};

const applyGalleryDensity = () => {
  if (!galleryRoot) return;
  const columns = preferredDensityColumns();
  galleryRoot.style.setProperty("--gallery-zoom-columns", String(columns));
  if (densityInput) {
    densityInput.max = String(maxDensityColumns());
    densityInput.value = String(columns);
  }
  if (densityValue) densityValue.textContent = `${columns}`;
};

const preferredFitMode = () => (
  localStorage.getItem(fitModeKey) === "fill" ? "fill" : "fit"
);

let fitMode = preferredFitMode();

const applyGalleryFitMode = () => {
  if (!galleryRoot) return;
  galleryRoot.dataset.imageFit = fitMode;
  fitModeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.galleryFitMode === fitMode ? "true" : "false");
  });
};

const positionGalleryViewControls = () => {
  if (!viewControls) return;
  const topbar = document.querySelector(".topbar");
  const topOffset = topbar ? Math.max(12, Math.ceil(topbar.getBoundingClientRect().bottom + 8)) : 72;
  viewControls.style.setProperty("--gallery-view-controls-top", `${topOffset}px`);
};

const photoAspectRatioStyle = (photo) => {
  const dimensions = previewDimensions(photo);
  if (!dimensions?.width || !dimensions?.height) return "";
  return ` style="--photo-aspect-ratio:${dimensions.width} / ${dimensions.height}"`;
};

const updateGalleryLikeButtons = () => {
  const likedIds = likedPhotoIds();
  galleryRoot?.querySelectorAll("[data-gallery-like]").forEach((button) => {
    const isLiked = likedIds.has(button.dataset.photoId);
    button.classList.toggle("is-liked", isLiked);
    button.setAttribute("aria-pressed", String(isLiked));
    button.setAttribute("aria-label", t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo"));
  });
};

const toggleGalleryLike = (photo) => {
  if (!photo?.id || !likedStore) return;
  if (likedStore.has?.(photo.id)) {
    likedStore.remove(photo.id);
  } else {
    likedStore.add(photo.id);
  }
  updateGalleryLikeButtons();
};

const renderGallery = () => {
  const allPhotos = visiblePhotos();
  const photos = filteredVisiblePhotos(allPhotos);
  const likedIds = likedPhotoIds();
  writeDetailSequenceContext(photos);
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
      selectedIndex = 0;
      renderGallery();
    });
    setGalleryStatus(filteredOut
      ? t("gallery.adjust_filters")
      : "");
    return;
  }
  galleryRoot.innerHTML = photos.map((photo, index) => {
    const rawLabel = rawSourceLabel(photo);
    const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    const href = versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`);
    const hrefAttr = escapeHtml(href);
    const title = escapeHtml(photo.title);
    const isLiked = likedIds.has(photo.id);
    return `
    <article
      class="mock-photo-card"
      aria-label="Open ${title}${rawLabel ? `, RAW source ${escapeHtml(rawLabel)}` : ""}"
      data-photo-index="${index}"
      data-photo-id="${escapeHtml(photo.id)}"
      data-photo-href="${hrefAttr}"
    >
      <a
        class="mock-photo ${photo.className} ${image ? "has-image" : ""} ${rawLabel ? "has-raw-source" : ""}"
        href="${hrefAttr}"
        data-photo-link
        aria-label="Open ${title}"
        ${photoAspectRatioStyle(photo)}
      >
        ${image ? `<img src="${escapeHtml(image)}" alt="${title}"/>` : ""}
        ${rawLabel ? `<span class="raw-source-badge" title="${escapeHtml(rawLabel)} source">RAW</span>` : ""}
      </a>
      ${likedStore ? `
        <button
          class="gallery-like-toggle${isLiked ? " is-liked" : ""}"
          type="button"
          data-gallery-like
          data-photo-id="${escapeHtml(photo.id)}"
          aria-label="${escapeHtml(t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo"))}"
          aria-pressed="${isLiked ? "true" : "false"}"
        >
          <span aria-hidden="true"></span>
        </button>
      ` : ""}
      <a class="mock-photo-caption" href="${hrefAttr}" data-photo-caption>${title}</a>
    </article>
  `;
  }).join("");
  galleryRoot.querySelectorAll("[data-gallery-like]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const photo = photos.find((candidate) => candidate.id === button.dataset.photoId);
      toggleGalleryLike(photo);
    });
  });
  if (localModerationEnabled) {
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
  window.photosByElieVersionInternalLinks?.(galleryRoot);
  applyGalleryDensity();
  applyGalleryFitMode();
  updateSelection();
  const filterStatus = activeFilterCount()
    ? t("gallery.showing_filtered", { count: photos.length, total: allPhotos.length })
    : t("gallery.showing_count", { count: photos.length });
  if (localModerationEnabled) {
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
  document.querySelector("[data-nav-current]").textContent = localizedCollectionTitle();
  document.querySelector("[data-nav-current]").setAttribute("href", versionedHref(`./${galleryKey}.html`));
  if (document.querySelector("[data-gallery-number]")) document.querySelector("[data-gallery-number]").textContent = `Collection ${gallery.number}`;
  document.querySelector("[data-gallery-title]").textContent = localizedCollectionTitle();
  if (document.querySelector("[data-gallery-description]")) document.querySelector("[data-gallery-description]").textContent = gallery.description;
  galleryRoot.classList.add(gallery.accent);
  galleryRoot.setAttribute("aria-label", `${localizedCollectionTitle()} ${t("nav.photos").toLowerCase()}`);
  ensureGalleryFilterControls();
  ensureGalleryKeyboardHint();
  renderGallery();

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
    viewControls.append(densityControl, topButton, fitControl);
    document.body.append(viewControls);
    densityInput = densityControl.querySelector("[data-gallery-density]");
    densityValue = densityControl.querySelector("[data-gallery-density-value]");
    fitModeButtons = [...fitControl.querySelectorAll("[data-gallery-fit-mode]")];
    topButton.addEventListener("click", () => {
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
    densityInput.addEventListener("input", () => {
      localStorage.setItem(densityKey, String(clampDensityColumns(densityInput.value)));
      applyGalleryDensity();
      updateSelection({ scroll: false });
    });
    fitControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-gallery-fit-mode]");
      if (!button) return;
      fitMode = button.dataset.galleryFitMode === "fill" ? "fill" : "fit";
      localStorage.setItem(fitModeKey, fitMode);
      applyGalleryFitMode();
      updateSelection({ scroll: false });
    });
    window.addEventListener("resize", () => {
      applyGalleryDensity();
      positionGalleryViewControls();
      updateSelection({ scroll: false });
    });
    window.addEventListener("scroll", positionGalleryViewControls, { passive: true });
    applyGalleryDensity();
    applyGalleryFitMode();
    positionGalleryViewControls();
    window.photosByElieI18n?.apply?.();
  }

  if (localModerationEnabled) {
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
        selectedIndex = Math.min(selectedIndex + 1, photos.length - 1);
        updateSelection();
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowLeft") {
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowDown") {
        selectedIndex = Math.min(selectedIndex + visibleColumnCount(), photos.length - 1);
        updateSelection();
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp") {
        selectedIndex = Math.max(selectedIndex - visibleColumnCount(), 0);
        updateSelection();
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
      if (event.key.toLowerCase() === "h") {
        const selected = photos[selectedIndex];
        if (!selected) return;
        try {
          await hiddenActions.mark(selected.id);
          selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
          renderGallery();
          setGalleryStatus(`${selected.title} moved to Hidden.`);
        } catch (error) {
          setGalleryStatus(error?.message || "Could not move photo to Hidden.");
        }
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() !== "u") return;
      let undoneId = null;
      try {
        undoneId = await hiddenActions.undo();
      } catch (error) {
        setGalleryStatus(error?.message || "Could not undo the last hide.");
        event.preventDefault();
        return;
      }
      renderGallery();
      if (!undoneId) {
        setGalleryStatus("No local hidden mark to undo.");
        return;
      }
      const nextPhotos = filteredVisiblePhotos();
      const restoredIndex = nextPhotos.findIndex((photo) => photo.id === undoneId);
      if (restoredIndex >= 0) selectedIndex = restoredIndex;
      updateSelection();
      setGalleryStatus("Last local hidden mark undone.");
      event.preventDefault();
    });

    window.addEventListener("photosbyelie:hiddenchange", () => {
      gallery = window.photosByElieData?.[galleryKey];
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
      renderGallery();
    }
  });
  window.addEventListener("photosbyelie:likedchange", updateGalleryLikeButtons);
}
