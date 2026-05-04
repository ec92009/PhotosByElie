((async () => {
if (window.photosByElieReserve?.enabled) {
  await window.photosByElieReserve.load();
}
const params = new URLSearchParams(window.location.search);
const photoId = params.get("id") || "france-1";
const collections = window.photosByElieData || {};
const ownerCollections = window.photosByElieOwnerData || {};
const reserveCollections = window.photosByElieReserveData || {};
const fallbackCollection = Object.values(collections).find((collection) => Array.isArray(collection.photos) && collection.photos.length)
  || collections.france
  || { title: "Gallery", accent: "", photos: [] };
const regularCollectionEntry = Object.entries(collections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const reserveCollectionEntry = Object.entries(reserveCollections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const ownerCollectionEntry = Object.entries(ownerCollections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const collectionEntry = regularCollectionEntry || reserveCollectionEntry || ownerCollectionEntry;
const isReserveCollection = Boolean(!regularCollectionEntry && reserveCollectionEntry);
const isOwnerCollection = Boolean(!regularCollectionEntry && !reserveCollectionEntry && ownerCollectionEntry);
const [collectionKey, collection] = collectionEntry || ["france", fallbackCollection];
const photo = collection.photos.find((item) => item.id === photoId) || collection.photos[0] || null;
const photoIndex = photo ? collection.photos.findIndex((item) => item.id === photo.id) : -1;
const resolutions = window.photosByElieResolutions || [];
const availableResolutions = photo && window.photosByElieAvailableResolutions
  ? window.photosByElieAvailableResolutions(photo, resolutions)
  : resolutions;
const basketStore = window.photosByElieBasket;
const likedStore = window.photosByElieLiked;
const unworthyStore = window.photosByElieUnworthy;
const localModerationEnabled = Boolean(unworthyStore?.enabled);
if (isOwnerCollection && !localModerationEnabled) {
  window.location.replace("./");
  return;
}
const visibleCollectionPhotos = () => (
  unworthyStore?.filterPhotos
    ? unworthyStore.filterPhotos(collection.photos, { includeReserveOnly: isReserveCollection })
    : collection.photos
);

const navigateAfterHide = () => {
  const remainingPhotos = visibleCollectionPhotos();
  if (!remainingPhotos.length) {
    window.location.replace(`./${collectionKey}.html`);
    return true;
  }

  const currentVisibleIndex = remainingPhotos.findIndex((item) => item.id === photo.id);
  if (currentVisibleIndex >= 0) return false;

  const nextPhoto = collection.photos
    .slice(photoIndex + 1)
    .concat(collection.photos.slice(0, photoIndex))
    .find((item) => remainingPhotos.some((candidate) => candidate.id === item.id));

  window.location.replace(`./photo.html?id=${(nextPhoto || remainingPhotos[0]).id}`);
  return true;
};

const selectedOptions = () => Array.from(document.querySelectorAll("[data-resolution]:checked"))
  .map((input) => {
    const option = availableResolutions.find((item) => item.id === input.value);
    return option ? { id: option.id, label: option.label, price: option.price } : null;
  })
  .filter(Boolean);

const updateTotal = () => {
  const totalTarget = document.querySelector("[data-selection-total]");
  if (!totalTarget) return;
  const total = selectedOptions().reduce((sum, option) => sum + option.price, 0);
  totalTarget.textContent = `$${total}`;
};

const basketItemForPhoto = () => basketStore.read().find((item) => item.photoId === photo.id);
const status = document.querySelector("[data-basket-status]");
const likeToggle = document.querySelector("[data-like-toggle]");

if (!photo) {
  document.title = `Photos By Elie | ${collection.title}`;
  document.querySelector("[data-nav-current]").textContent = collection.title;
  document.querySelector("[data-nav-current]").setAttribute("href", `./${collectionKey}.html`);
  document.querySelector("[data-photo-title]").textContent = "Archive reset in progress";
  document.querySelector("[data-photo-meta]").textContent = `${collection.title} / No published photos yet`;
  document.querySelector("[data-back-link]").setAttribute("href", `./${collectionKey}.html`);
  document.querySelector(".detail-cycle")?.setAttribute("hidden", "");
  document.querySelector("[data-resolution-list]").innerHTML = "";
  document.querySelector("[data-selection-total]").textContent = "$0";
  const metadataRoot = document.querySelector("[data-photo-metadata]");
  metadataRoot.hidden = true;
  const preview = document.querySelector("[data-photo-preview]");
  preview.classList.add(collection.accent);
  preview.querySelector("[data-photo-preview-title]").textContent = "No published photos yet";
  if (status) status.textContent = "This gallery is being rebuilt from the Saturn archive.";
} else {
if (localModerationEnabled && !visibleCollectionPhotos().some((item) => item.id === photo.id) && navigateAfterHide()) {
  // The currently requested photo is locally suppressed, so move to the next visible one immediately.
} else {
document.title = `Photos By Elie | ${photo.title}`;
document.querySelector("[data-nav-current]").textContent = collection.title;
document.querySelector("[data-nav-current]").setAttribute("href", `./${collectionKey}.html`);
document.querySelector("[data-photo-title]").textContent = photo.title;
document.querySelector("[data-photo-meta]").textContent = [
  collection.title,
  window.photosByElieSourceFormats ? window.photosByElieSourceFormats(photo) : photo.full,
  window.photosByElieVerifiedMegapixels && window.photosByElieVerifiedMegapixels(photo)
    ? `${window.photosByElieVerifiedMegapixels(photo)} MP verified`
    : ""
].filter(Boolean).join(" / ");
document.querySelector("[data-back-link]").setAttribute("href", `./${collectionKey}.html`);

const prevPhotoLink = document.querySelector("[data-prev-photo]");
const nextPhotoLink = document.querySelector("[data-next-photo]");
if (prevPhotoLink && nextPhotoLink && collection.photos.length > 1) {
  const detailPhotos = visibleCollectionPhotos();
  const detailIndex = detailPhotos.findIndex((item) => item.id === photo.id);
  const previousPhoto = detailPhotos[(detailIndex - 1 + detailPhotos.length) % detailPhotos.length];
  const nextPhoto = detailPhotos[(detailIndex + 1) % detailPhotos.length];
  prevPhotoLink.setAttribute("href", `./photo.html?id=${previousPhoto.id}`);
  prevPhotoLink.setAttribute("aria-label", `Previous photo: ${previousPhoto.title}`);
  nextPhotoLink.setAttribute("href", `./photo.html?id=${nextPhoto.id}`);
  nextPhotoLink.setAttribute("aria-label", `Next photo: ${nextPhoto.title}`);
} else {
  document.querySelector(".detail-cycle")?.setAttribute("hidden", "");
}

const metadataRoot = document.querySelector("[data-photo-metadata]");
const metadata = Array.isArray(photo.metadata)
  ? photo.metadata.filter((item) => item.label && item.value && item.label !== "Preview file")
  : [];
metadataRoot.hidden = metadata.length === 0;
metadataRoot.replaceChildren(...metadata.map((item) => {
  const row = document.createElement("div");
  const label = document.createElement("dt");
  const value = document.createElement("dd");
  label.textContent = item.label;
  value.textContent = item.value;
  row.append(label, value);
  return row;
}));

const preview = document.querySelector("[data-photo-preview]");
const detailLayout = document.querySelector(".detail-layout");
const syncLandscapePreviewSize = () => {
  if (!detailLayout?.classList.contains("is-landscape")) return;
  const ratio = Number(preview.style.getPropertyValue("--detail-ratio")) || 1.5;
  const maxWidth = detailLayout.clientWidth;
  const maxHeight = Math.max(320, window.innerHeight - 240);
  preview.style.setProperty("--detail-landscape-width", `${Math.min(maxWidth, maxHeight * ratio)}px`);
};
preview.classList.add(collection.accent, photo.className);
if (photo.imageSrc) {
  preview.classList.add("has-image");
  const img = document.createElement("img");
  const setPreviewAspectRatio = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    preview.style.setProperty("--detail-aspect", `${img.naturalWidth} / ${img.naturalHeight}`);
    preview.style.setProperty("--detail-ratio", img.naturalWidth / img.naturalHeight);
    detailLayout?.classList.toggle("is-landscape", img.naturalWidth >= img.naturalHeight);
    detailLayout?.classList.toggle("is-portrait", img.naturalWidth < img.naturalHeight);
    syncLandscapePreviewSize();
  };
  img.src = photo.imageSrc;
  img.alt = photo.title;
  img.addEventListener("load", setPreviewAspectRatio);
  if (img.complete) setPreviewAspectRatio();
  preview.prepend(img);
}
window.addEventListener("resize", syncLandscapePreviewSize);
preview.querySelector("[data-photo-preview-title]").textContent = photo.title;

if (likeToggle && likedStore) {
  likeToggle.checked = likedStore.has(photo.id);
  likeToggle.addEventListener("change", () => {
    if (likeToggle.checked) {
      likedStore.add({ photoId: photo.id });
      status.textContent = `${photo.title} added to liked photos.`;
      return;
    }
    likedStore.remove(photo.id);
    status.textContent = `${photo.title} removed from liked photos.`;
  });
}

const shouldIgnoreShortcut = (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
};

window.addEventListener("keydown", (event) => {
  if (shouldIgnoreShortcut(event)) return;
  if (event.key === "ArrowLeft" && prevPhotoLink?.getAttribute("href")) {
    window.location.assign(prevPhotoLink.getAttribute("href"));
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowRight" && nextPhotoLink?.getAttribute("href")) {
    window.location.assign(nextPhotoLink.getAttribute("href"));
    event.preventDefault();
  }
});

if (localModerationEnabled) {
  window.addEventListener("keydown", (event) => {
    if (shouldIgnoreShortcut(event)) return;
    const key = event.key.toLowerCase();
    if (key === "h") {
      if (unworthyStore.has(photo.id)) {
        status.textContent = `${photo.title} is already marked unworthy on this localhost browser.`;
        return;
      }
      unworthyStore.mark(photo.id);
      navigateAfterHide();
      return;
    }
    if (key !== "u") return;
    const undoneId = unworthyStore.undo(photo.id);
    status.textContent = undoneId
      ? `${photo.title} restored on this localhost browser.`
      : "No local unworthy mark to undo.";
  });

  window.addEventListener("photosbyelie:unworthychange", () => {
    navigateAfterHide();
  });
}

const selectedIds = new Set((basketItemForPhoto()?.options || []).map((option) => option.id));

document.querySelector("[data-resolution-list]").innerHTML = availableResolutions.map((option) => `
  <label class="resolution-row">
    <input type="checkbox" data-resolution value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
    <span>
      <strong>${option.label}</strong>
      <small>${window.photosByElieResolutionDetail ? window.photosByElieResolutionDetail(photo, option) : option.detail}</small>
    </span>
    <b>$${option.price}</b>
  </label>
`).join("");

const syncSelectionToBasket = () => {
  const options = selectedOptions();
  const existing = basketItemForPhoto();
  basketStore.setPhotoOptions({
    photoId: photo.id,
    title: photo.title,
    collection: collection.title,
    options
  });
  updateTotal();
  if (!options.length) {
    status.textContent = existing ? `${photo.title} removed from basket.` : "No basket selections for this photo.";
    return;
  }
  status.textContent = `${photo.title} basket selections saved.`;
};

document.querySelectorAll("[data-resolution]").forEach((input) => {
  input.addEventListener("change", syncSelectionToBasket);
});

updateTotal();
}
}
})());
