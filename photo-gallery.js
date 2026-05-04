const galleryKey = document.body.dataset.gallery;
const gallery = window.photosByElieData?.[galleryKey];
const galleryRoot = document.querySelector("[data-gallery-root]");
const galleryStatus = document.querySelector("[data-gallery-status]");
const unworthyStore = window.photosByElieUnworthy;
const reserveStore = window.photosByElieReserve;
const localModerationEnabled = Boolean(unworthyStore?.enabled);
const reserveFillEnabled = Boolean(localModerationEnabled && reserveStore?.enabled);
const galleryActions = document.querySelector("[data-gallery-actions]");
let selectedIndex = 0;
let restoreButton = null;
const densityKey = "photosbyelie-gallery-columns";
let densityInput = null;
let densityValue = null;

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
  const photos = visiblePhotos();
  if (!photos.length) {
    const canRestoreCollection = localModerationEnabled && Boolean(gallery?.photos?.length);
    galleryRoot.innerHTML = `
      <article class="mock-photo empty-gallery-card" aria-label="${gallery.title} archive reset">
        <span>No locally visible photos in this collection</span>
        ${canRestoreCollection ? '<button class="btn secondary" type="button" data-restore-collection>Restore collection</button>' : ""}
      </article>
    `;
    galleryRoot.querySelector("[data-restore-collection]")?.addEventListener("click", () => {
      const restored = restoreCollectionHides();
      selectedIndex = 0;
      renderGallery();
      setGalleryStatus(restored ? `${restored} local hides restored for ${gallery.title}.` : "No local hides to restore.");
    });
    updateRestoreAction();
    setGalleryStatus(canRestoreCollection ? "All regular photos in this collection are currently hidden locally." : "");
    return;
  }
  galleryRoot.innerHTML = photos.map((photo, index) => `
    <a
      class="mock-photo ${photo.className} ${(photo.gallerySrc || photo.imageSrc) ? "has-image" : ""}"
      href="./photo.html?id=${photo.id}"
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
        window.location.assign(card.getAttribute("href"));
      });
    });
  }
  applyGalleryDensity();
  updateSelection();
  if (localModerationEnabled) {
    const reserveCount = reserveFillEnabled ? reserveStore.photosFor(galleryKey).length : 0;
    setGalleryStatus(reserveCount ? "Use arrow keys to move, H to hide and refill from reserve, U to undo." : "Use arrow keys to move, H to hide, U to undo.");
    updateRestoreAction();
  }
};

if (galleryRoot && gallery) {
  document.title = `Photos By Elie | ${gallery.title} Gallery`;
  document.querySelector("[data-nav-current]").textContent = gallery.title;
  document.querySelector("[data-nav-current]").setAttribute("href", `./${galleryKey}.html`);
  if (document.querySelector("[data-gallery-number]")) document.querySelector("[data-gallery-number]").textContent = `Collection ${gallery.number}`;
  document.querySelector("[data-gallery-title]").textContent = gallery.title;
  if (document.querySelector("[data-gallery-description]")) document.querySelector("[data-gallery-description]").textContent = gallery.description;
  galleryRoot.classList.add(gallery.accent);
  galleryRoot.setAttribute("aria-label", `${gallery.title} photos`);
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
      const photos = visiblePhotos();
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
        setGalleryStatus("No local unworthy mark to undo.");
        return;
      }
      const nextPhotos = visiblePhotos();
      const restoredIndex = nextPhotos.findIndex((photo) => photo.id === undoneId);
      if (restoredIndex >= 0) selectedIndex = restoredIndex;
      updateSelection();
      setGalleryStatus("Last local unworthy mark undone.");
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
