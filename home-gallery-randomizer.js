const baseHomeCollections = [
  "france",
  "usa",
  "spain",
  "mexico",
  "ai",
  "italy",
  "portugal",
  "slovakia",
];
const panoramaCollectionKey = "panoramas";
const homeCollections = [...baseHomeCollections, panoramaCollectionKey];
const hasCollectionSamples = (data = {}) => (
  baseHomeCollections.some((key) => Array.isArray(data[key]?.photos) && data[key].photos.length)
);
const homeData = () => {
  const fullCatalog = window.photosByElieData || {};
  if (hasCollectionSamples(fullCatalog)) return fullCatalog;
  const homeCatalog = window.photosByElieHomeData || {};
  if (hasCollectionSamples(homeCatalog)) return homeCatalog;
  return fullCatalog || homeCatalog || {};
};

const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));

const galleryHrefForKey = (key) => {
  const fitMode = key === panoramaCollectionKey ? "fit" : "fill";
  const href = `./gallery.html?gallery=${encodeURIComponent(key)}&fit=${fitMode}&columns=3`;
  return window.photosByElieVersionedHref?.(href) || href;
};
const collectionTitleForKey = (key, collection) => (
  window.photosByElieI18n?.t?.(`collection.${key}`)
  || collection?.title
  || key
);

const isBlockedPhoto = (photo) => {
  const id = photo?.id;
  if (!id) return false;
  return Boolean(
    window.photosByEliePublicHiddenIds?.has?.(id)
    || window.photosByElieHiddenActions?.has?.(id)
  );
};

const panoramaCollectionForData = (data) => {
  const seen = new Set();
  const photos = baseHomeCollections
    .flatMap((key) => data[key]?.photos || [])
    .filter((photo) => {
      if (!photo?.id || seen.has(photo.id) || window.photosByElieIsVideo?.(photo)) return false;
      if (!window.photosByEliePhotoIsPanorama?.(photo)) return false;
      seen.add(photo.id);
      return true;
    });
  return {
    title: "Panoramas",
    accent: "panoramas-gallery",
    photos,
  };
};

const collectionForKey = (data, key) => (
  key === panoramaCollectionKey ? panoramaCollectionForData(data) : data[key]
);

const availablePhotosForCollection = (collection) => {
  const publicPhotos = window.photosByElieFilterPublicHidden?.(collection?.photos || []) || (collection?.photos || []);
  const photos = window.photosByElieHiddenActions?.filterPhotos
    ? window.photosByElieHiddenActions.filterPhotos(publicPhotos)
    : publicPhotos;
  return photos.filter((photo) => !isBlockedPhoto(photo));
};

const randomPhotoForCollection = (collection, excludedIds = new Set()) => {
  const availablePhotos = availablePhotosForCollection(collection)
    .filter((photo) => !excludedIds.has(photo?.id));
  if (!availablePhotos.length) return null;
  return availablePhotos[Math.floor(Math.random() * availablePhotos.length)];
};

const representativeImageForPhoto = (photo) => {
  return window.photosByElieMediaUrl?.(photo, "gallery") || "";
};

const applyRepresentativePhoto = (element, photo) => {
  if (!element) return;
  element.classList.remove("has-photo");
  element.style.removeProperty("--photo-image");
  delete element.dataset.photoId;
  if (!photo) return;
  const image = representativeImageForPhoto(photo);
  if (!image) return;
  element.classList.add("has-photo");
  if (photo.id) element.dataset.photoId = photo.id;
  element.style.setProperty("--photo-image", `url('${image}')`);
};

const buildHeroStack = () => {
  const root = document.querySelector("[data-home-stack]");
  if (!root) return;
  if (root.dataset.homeStackBuilt === "true" && root.children.length) return;
  const data = homeData();
  const markup = homeCollections.map((key) => {
    const collection = collectionForKey(data, key);
    if (!collection) return "";
    const photo = randomPhotoForCollection(collection);
    const image = representativeImageForPhoto(photo);
    const hasPhoto = image ? "has-photo" : "";
    const style = image ? ` style="--photo-image:url('${image}')"` : "";
    const title = escapeHtml(collectionTitleForKey(key, collection));
    const href = escapeHtml(galleryHrefForKey(key));
    const photoId = escapeHtml(photo?.id || "");
    return `<a class="photo-print ${key} ${hasPhoto}" href="${href}" data-home-stack-card data-gallery-key="${key}" data-photo-id="${photoId}" aria-label="${title} gallery"${style}><span class="hand-label">${title}</span></a>`;
  }).join("");
  if (!markup.trim()) return;
  root.innerHTML = markup;
  root.dataset.homeStackBuilt = "true";
};

const applyCarouselPhotos = () => {
  const data = homeData();
  document.querySelectorAll("[data-gallery-key]").forEach((card) => {
    const key = card.dataset.galleryKey;
    const art = card.querySelector(".photo-art");
    const collection = collectionForKey(data, key);
    const photo = randomPhotoForCollection(collection);
    applyRepresentativePhoto(art, photo);
  });
};

const refreshSamples = () => {
  buildHeroStack();
  applyCarouselPhotos();
};

const replaceHeroStackCardPhoto = (card) => {
  const key = card?.dataset.galleryKey;
  if (!key) return false;
  const collection = collectionForKey(homeData(), key);
  const previousId = card.dataset.photoId;
  const excludedIds = new Set(previousId ? [previousId] : []);
  const replacement = randomPhotoForCollection(collection, excludedIds)
    || randomPhotoForCollection(collection);
  if (!replacement) return false;
  applyRepresentativePhoto(card, replacement);
  return replacement.id !== previousId;
};

window.photosByElieHomeRandomizer = { refreshSamples, replaceHeroStackCardPhoto };
window.addEventListener("photosbyelie:carouselturn", applyCarouselPhotos);
window.addEventListener("photosbyelie:catalogloaded", refreshSamples);
window.addEventListener("photosbyelie:hiddenblacklistchange", refreshSamples);
window.addEventListener("photosbyelie:hiddenchange", refreshSamples);
(async () => {
  await Promise.allSettled([
    window.photosByElieHiddenBlacklistReady,
    window.photosByElieHiddenActionsReady,
  ]);
  refreshSamples();
})();
