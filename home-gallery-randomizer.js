const homeCollections = [
  "france",
  "usa",
  "spain",
  "mexico",
  "ai",
  "portugal",
  "slovakia",
];

const randomPhotoForCollection = (collection) => {
  const publicPhotos = window.photosByElieFilterPublicHidden?.(collection?.photos || []) || (collection?.photos || []);
  const photos = window.photosByElieHiddenActions?.filterPhotos
    ? window.photosByElieHiddenActions.filterPhotos(publicPhotos)
    : publicPhotos;
  if (!photos.length) return null;
  return photos[Math.floor(Math.random() * photos.length)];
};

const representativeImageForPhoto = (photo) => {
  const mediaImage = window.photosByElieMediaUrl?.(photo, "gallery") || "";
  if (mediaImage) return mediaImage;
  if (window.photosByElieMediaStatus?.().requiresPublicMedia) return "";
  return photo?.gallerySrc || photo?.imageSrc || "";
};

const applyRepresentativePhoto = (element, photo) => {
  if (!element || !photo) return;
  const image = representativeImageForPhoto(photo);
  if (!image) return;
  element.classList.add("has-photo");
  element.style.setProperty("--photo-image", `url('${image}')`);
};

const buildHeroStack = () => {
  const root = document.querySelector("[data-home-stack]");
  if (!root) return;
  const data = window.photosByElieData || {};
  root.innerHTML = homeCollections.map((key) => {
    const collection = data[key];
    if (!collection) return "";
    const photo = randomPhotoForCollection(collection);
    const image = representativeImageForPhoto(photo);
    const hasPhoto = image ? "has-photo" : "";
    const style = image ? ` style="--photo-image:url('${image}')"` : "";
    return `<span class="photo-print ${key} ${hasPhoto}"${style}><span class="hand-label">${collection.title}</span></span>`;
  }).join("");
};

const applyCarouselPhotos = () => {
  const data = window.photosByElieData || {};
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
window.addEventListener("photosbyelie:hiddenblacklistchange", refreshSamples);
refreshSamples();
