const homeCollections = [
  "france",
  "usa",
  "spain",
  "mexico",
  "ai",
  "italy",
  "portugal",
  "slovakia",
];
const homeData = () => window.photosByElieData || window.photosByElieHomeData || {};

const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));

const galleryHrefForKey = (key) => window.photosByElieVersionedHref?.(`./gallery.html?gallery=${encodeURIComponent(key)}`) || `./gallery.html?gallery=${encodeURIComponent(key)}`;
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

const randomPhotoForCollection = (collection) => {
  const publicPhotos = window.photosByElieFilterPublicHidden?.(collection?.photos || []) || (collection?.photos || []);
  const photos = window.photosByElieHiddenActions?.filterPhotos
    ? window.photosByElieHiddenActions.filterPhotos(publicPhotos)
    : publicPhotos;
  const availablePhotos = photos.filter((photo) => !isBlockedPhoto(photo));
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
  const data = homeData();
  root.innerHTML = homeCollections.map((key) => {
    const collection = data[key];
    if (!collection) return "";
    const photo = randomPhotoForCollection(collection);
    const image = representativeImageForPhoto(photo);
    const hasPhoto = image ? "has-photo" : "";
    const style = image ? ` style="--photo-image:url('${image}')"` : "";
    const title = escapeHtml(collectionTitleForKey(key, collection));
    const href = escapeHtml(galleryHrefForKey(key));
    const photoId = escapeHtml(photo?.id || "");
    return `<a class="photo-print ${key} ${hasPhoto}" href="${href}" data-home-stack-card data-photo-id="${photoId}" aria-label="${title} gallery"${style}><span class="hand-label">${title}</span></a>`;
  }).join("");
};

const applyCarouselPhotos = () => {
  const data = homeData();
  document.querySelectorAll("[data-gallery-key]").forEach((card) => {
    const key = card.dataset.galleryKey;
    const art = card.querySelector(".photo-art");
    const collection = data[key];
    const photo = randomPhotoForCollection(collection);
    applyRepresentativePhoto(art, photo);
  });
};

const refreshSamples = () => {
  buildHeroStack();
  applyCarouselPhotos();
};

window.photosByElieHomeRandomizer = { refreshSamples };
window.addEventListener("photosbyelie:carouselturn", refreshSamples);
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
