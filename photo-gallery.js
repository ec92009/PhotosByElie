const galleryKey = document.body.dataset.gallery;
const gallery = window.photosByElieData?.[galleryKey];
const galleryRoot = document.querySelector("[data-gallery-root]");
const galleryStatus = document.querySelector("[data-gallery-status]");
const unworthyStore = window.photosByElieUnworthy;
const reserveStore = window.photosByElieReserve;
const localModerationEnabled = Boolean(unworthyStore?.enabled);
const reserveFillEnabled = Boolean(localModerationEnabled && reserveStore?.enabled);
const galleryActions = document.querySelector("[data-gallery-actions]");
const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
let selectedIndex = 0;
let restoreButton = null;
const densityKey = "photosbyelie-gallery-columns";
let densityInput = null;
let densityValue = null;
const filterStateKey = `photosbyelie-gallery-filters-${galleryKey}`;
const defaultFilterState = {
  orientation: "all",
  mood: "all",
  subject: "all",
  source: "all",
  availability: "all",
  sort: "collection"
};
let filterBar = null;

const readFilterState = () => {
  try {
    return { ...defaultFilterState, ...JSON.parse(localStorage.getItem(filterStateKey) || "{}") };
  } catch {
    return { ...defaultFilterState };
  }
};

let filterState = readFilterState();

const writeFilterState = () => {
  localStorage.setItem(filterStateKey, JSON.stringify(filterState));
};

const metadataValue = (photo, label) => (
  (photo?.metadata || []).find((item) => item.label === label)?.value || ""
);

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

const photoSourceTags = (photo) => {
  const text = `${photoSearchText(photo)} ${window.photosByElieSourceFormats ? window.photosByElieSourceFormats(photo) : ""}`.toLowerCase();
  const tags = new Set();
  if (galleryKey === "ai" || /ai|leonardo/.test(text)) tags.add("ai");
  if (/\b(dng|nef|raw|cr2|cr3|arw|raf|orf|rw2)\b/.test(text)) tags.add("raw");
  if (/\b(jpg|jpeg)\b/.test(text)) tags.add("jpg");
  if (/\b(tif|tiff|psd)\b/.test(text)) tags.add("tiff-psd");
  return tags.size ? tags : new Set(["unknown"]);
};

const availableResolutionsFor = (photo) => (
  window.photosByElieAvailableResolutions
    ? window.photosByElieAvailableResolutions(photo, window.photosByElieResolutions || [])
    : []
);

const photoAvailabilityTags = (photo) => {
  const ids = new Set(availableResolutionsFor(photo).map((option) => option.id));
  const tags = new Set();
  if (ids.has("full")) tags.add("full");
  if (ids.has("jpg-6mp")) tags.add("print");
  if (ids.has("jpg-1mp") || ids.has("jpg-3mp")) tags.add("web");
  return tags.size ? tags : new Set(["unverified"]);
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

const maxAvailablePrice = (photo) => Math.max(0, ...availableResolutionsFor(photo).map((option) => option.price || 0));

const activeFilterCount = () => ["orientation", "mood", "subject", "source", "availability"]
  .filter((key) => filterState[key] && filterState[key] !== "all").length;

const matchesFilterState = (photo) => {
  if (filterState.orientation !== "all" && photoOrientation(photo) !== filterState.orientation) return false;
  if (filterState.mood !== "all" && !photoMoodTags(photo).has(filterState.mood)) return false;
  if (filterState.subject !== "all" && !photoSubjectTags(photo).has(filterState.subject)) return false;
  if (filterState.source !== "all" && !photoSourceTags(photo).has(filterState.source)) return false;
  if (filterState.availability !== "all" && !photoAvailabilityTags(photo).has(filterState.availability)) return false;
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
  filterBar.setAttribute("aria-label", "Gallery filters and sorting");
  filterBar.innerHTML = `
    <label><span>Orientation</span><select data-gallery-filter="orientation">
      <option value="all">All</option>
      <option value="landscape">Landscape</option>
      <option value="portrait">Portrait</option>
      <option value="square">Square</option>
    </select></label>
    <label><span>Color mood</span><select data-gallery-filter="mood">
      <option value="all">All</option>
      <option value="warm">Warm</option>
      <option value="cool">Cool</option>
      <option value="neutral">Neutral</option>
      <option value="vivid">Vivid</option>
    </select></label>
    <label><span>Subject</span><select data-gallery-filter="subject">
      <option value="all">All</option>
      <option value="architecture">Architecture</option>
      <option value="water">Water/coast</option>
      <option value="art">Art/museum</option>
      <option value="people">People</option>
      <option value="nature">Nature</option>
      <option value="city">City/travel</option>
    </select></label>
    <label><span>Source</span><select data-gallery-filter="source">
      <option value="all">All</option>
      <option value="raw">RAW</option>
      <option value="jpg">JPG</option>
      <option value="ai">AI</option>
      <option value="tiff-psd">TIFF/PSD</option>
    </select></label>
    <label><span>Availability</span><select data-gallery-filter="availability">
      <option value="all">All</option>
      <option value="full">Full source</option>
      <option value="print">Print-ready</option>
      <option value="web">Web-ready</option>
    </select></label>
    <label><span>Sort</span><select data-gallery-filter="sort">
      <option value="collection">Collection order</option>
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="title">Title</option>
      <option value="megapixels-desc">Largest MP</option>
      <option value="megapixels-asc">Smallest MP</option>
      <option value="price-desc">Highest price</option>
      <option value="price-asc">Lowest price</option>
    </select></label>
    <button class="btn secondary gallery-filter-clear" type="button" data-clear-gallery-filters>Clear</button>
  `;
  filterTarget.after(filterBar);
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

const regularCap = () => unworthyStore?.readRegularCap?.() || gallery?.photos?.length || 0;

const randomItem = (items) => items[Math.floor(Math.random() * items.length)];

const promotedPhotos = () => {
  if (!reserveFillEnabled) return [];
  const reserveById = new Map(reserveStore.photosFor(galleryKey).map((photo) => [photo.id, photo]));
  return reserveStore.promotedIds(galleryKey)
    .map((photoId) => reserveById.get(photoId))
    .filter(Boolean);
};

const eligibleReservePhotos = (selectedIds) => {
  if (!reserveFillEnabled) return [];
  const blockedIds = new Set(unworthyStore.read());
  const regularIds = new Set((gallery?.photos || []).map((photo) => photo.id));
  const promotedIds = new Set(reserveStore.promotedIds(galleryKey));
  return reserveStore.photosFor(galleryKey).filter((photo) =>
    !blockedIds.has(photo.id)
    && !regularIds.has(photo.id)
    && !promotedIds.has(photo.id)
    && !selectedIds.has(photo.id)
  );
};

const visiblePhotos = () => {
  const basePhotos = gallery?.photos || [];
  if (!localModerationEnabled) return basePhotos;

  const selected = unworthyStore
    .filterPhotos(basePhotos)
    .concat(unworthyStore.filterPhotos(promotedPhotos(), { includeReserveOnly: true }));
  const selectedIds = new Set(selected.map((photo) => photo.id));
  while (reserveFillEnabled && selected.length < regularCap()) {
    const nextPhoto = randomItem(eligibleReservePhotos(selectedIds));
    if (!nextPhoto) break;
    reserveStore.addPromotion(galleryKey, nextPhoto.id);
    selected.push(nextPhoto);
    selectedIds.add(nextPhoto.id);
  }
  return selected.slice(0, regularCap());
};

const restoreCollectionHides = () => {
  if (!localModerationEnabled || !gallery?.photos?.length) return 0;
  const hiddenIds = gallery.photos
    .concat(promotedPhotos())
    .filter((photo) => unworthyStore.has(photo.id))
    .map((photo) => photo.id);
  unworthyStore.unmarkMany(hiddenIds);
  return hiddenIds.length;
};

const updateRestoreAction = () => {
  if (!restoreButton || !localModerationEnabled || !gallery?.photos?.length) return;
  const hiddenCount = gallery.photos.concat(promotedPhotos()).filter((photo) => unworthyStore.has(photo.id)).length;
  restoreButton.hidden = hiddenCount === 0;
  restoreButton.textContent = hiddenCount > 1 ? `Restore ${hiddenCount} hidden` : "Restore hidden";
};

const updateSelection = () => {
  const cards = [...galleryRoot.querySelectorAll("[data-photo-index]")];
  if (!cards.length) return;
  selectedIndex = Math.max(0, Math.min(selectedIndex, cards.length - 1));
  cards.forEach((card, index) => {
    card.classList.toggle("is-selected", index === selectedIndex);
  });
  cards[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
  if (window.matchMedia("(min-width:1520px)").matches) return 8;
  if (window.matchMedia("(min-width:1120px)").matches) return 6;
  if (window.matchMedia("(min-width:860px)").matches) return 4;
  if (window.matchMedia("(min-width:640px)").matches) return 3;
  return 2;
};

const preferredDensityColumns = () => {
  const savedValue = Number(localStorage.getItem(densityKey));
  return Number.isInteger(savedValue) && savedValue >= 2 ? savedValue : maxDensityColumns();
};

const applyGalleryDensity = () => {
  if (!galleryRoot || !localModerationEnabled) return;
  const columns = Math.min(preferredDensityColumns(), maxDensityColumns());
  galleryRoot.style.setProperty("--gallery-zoom-columns", String(columns));
  if (densityInput) densityInput.value = String(columns);
  if (densityValue) densityValue.textContent = `${columns}`;
};

const renderGallery = () => {
  const allPhotos = visiblePhotos();
  const photos = filteredVisiblePhotos(allPhotos);
  if (!photos.length) {
    const filteredOut = allPhotos.length > 0 && activeFilterCount() > 0;
    const canRestoreCollection = localModerationEnabled && Boolean(gallery?.photos?.length);
    galleryRoot.innerHTML = `
      <article class="mock-photo empty-gallery-card" aria-label="${gallery.title} gallery empty state">
        <span>${filteredOut ? "No photos match the current filters" : "No locally visible photos in this collection"}</span>
        ${filteredOut ? '<button class="btn secondary" type="button" data-clear-gallery-empty>Clear filters</button>' : ""}
        ${!filteredOut && canRestoreCollection ? '<button class="btn secondary" type="button" data-restore-collection>Restore collection</button>' : ""}
      </article>
    `;
    galleryRoot.querySelector("[data-clear-gallery-empty]")?.addEventListener("click", () => {
      filterState = { ...defaultFilterState };
      writeFilterState();
      syncFilterControls();
      selectedIndex = 0;
      renderGallery();
    });
    galleryRoot.querySelector("[data-restore-collection]")?.addEventListener("click", () => {
      const restored = restoreCollectionHides();
      selectedIndex = 0;
      renderGallery();
      setGalleryStatus(restored ? `${restored} local hides restored for ${gallery.title}.` : "No local hides to restore.");
    });
    updateRestoreAction();
    setGalleryStatus(filteredOut
      ? "Adjust or clear filters to show this collection again."
      : canRestoreCollection
        ? "All regular photos in this collection are currently hidden locally."
        : "");
    return;
  }
  galleryRoot.innerHTML = photos.map((photo, index) => `
    <a
      class="mock-photo ${photo.className} ${(photo.gallerySrc || photo.imageSrc) ? "has-image" : ""}"
      href="${versionedHref(`./photo.html?id=${photo.id}`)}"
      aria-label="Open ${photo.title}"
      data-photo-index="${index}"
      data-photo-id="${photo.id}"
    >
      ${(photo.gallerySrc || photo.imageSrc) ? `<img src="${photo.gallerySrc || photo.imageSrc}" alt="${photo.title}"/>` : ""}
    </a>
  `).join("");
  if (localModerationEnabled) {
    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        event.preventDefault();
        selectedIndex = Number(card.dataset.photoIndex || 0);
        updateSelection();
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        window.location.assign(versionedHref(card.getAttribute("href")));
      });
    });
  }
  window.photosByElieVersionInternalLinks?.(galleryRoot);
  applyGalleryDensity();
  updateSelection();
  const filterStatus = activeFilterCount() ? `Showing ${photos.length} of ${allPhotos.length} after filters.` : `Showing ${photos.length} photos.`;
  if (localModerationEnabled) {
    const reserveCount = reserveFillEnabled ? reserveStore.photosFor(galleryKey).length : 0;
    setGalleryStatus(reserveCount
      ? `${filterStatus} Use arrow keys to move, H to hide and refill from reserve, U to undo.`
      : `${filterStatus} Use arrow keys to move, H to hide, U to undo.`);
    updateRestoreAction();
  } else {
    setGalleryStatus(filterStatus);
  }
};

if (galleryRoot && gallery) {
  document.title = `Photos By Elie | ${gallery.title} Gallery`;
  document.querySelector("[data-nav-current]").textContent = gallery.title;
  document.querySelector("[data-nav-current]").setAttribute("href", versionedHref(`./${galleryKey}.html`));
  if (document.querySelector("[data-gallery-number]")) document.querySelector("[data-gallery-number]").textContent = `Collection ${gallery.number}`;
  document.querySelector("[data-gallery-title]").textContent = gallery.title;
  if (document.querySelector("[data-gallery-description]")) document.querySelector("[data-gallery-description]").textContent = gallery.description;
  galleryRoot.classList.add(gallery.accent);
  galleryRoot.setAttribute("aria-label", `${gallery.title} photos`);
  ensureGalleryFilterControls();
  renderGallery();

  if (localModerationEnabled) {
    if (galleryActions) {
      restoreButton = document.createElement("button");
      restoreButton.className = "btn secondary";
      restoreButton.type = "button";
      restoreButton.hidden = true;
      restoreButton.addEventListener("click", () => {
        const restored = restoreCollectionHides();
        selectedIndex = 0;
        renderGallery();
        setGalleryStatus(restored ? `${restored} local hides restored for ${gallery.title}.` : "No local hides to restore.");
      });
      galleryActions.prepend(restoreButton);
      updateRestoreAction();

      const densityControl = document.createElement("label");
      densityControl.className = "gallery-density-control";
      densityControl.innerHTML = `
        <span>Grid</span>
        <input type="range" min="2" max="8" step="1" value="${Math.min(preferredDensityColumns(), maxDensityColumns())}" data-gallery-density/>
        <b data-gallery-density-value>${Math.min(preferredDensityColumns(), maxDensityColumns())}</b>
      `;
      restoreButton.after(densityControl);
      densityInput = densityControl.querySelector("[data-gallery-density]");
      densityValue = densityControl.querySelector("[data-gallery-density-value]");
      densityInput.addEventListener("input", () => {
        localStorage.setItem(densityKey, densityInput.value);
        applyGalleryDensity();
        updateSelection();
      });
      window.addEventListener("resize", () => {
        applyGalleryDensity();
        updateSelection();
      });
      applyGalleryDensity();
    }
    window.addEventListener("keydown", (event) => {
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
      if (event.key.toLowerCase() === "h") {
        const selected = photos[selectedIndex];
        if (!selected) return;
        unworthyStore.mark(selected.id);
        selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
        renderGallery();
        setGalleryStatus(`${selected.title} hidden on this localhost browser.`);
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() !== "u") return;
      const undoneId = unworthyStore.undo();
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

    window.addEventListener("photosbyelie:unworthychange", () => {
      renderGallery();
    });

    if (reserveFillEnabled) {
      reserveStore.load().then(() => {
        renderGallery();
      });
    }
  }
}
