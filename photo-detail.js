const params = new URLSearchParams(window.location.search);
const photoId = params.get("id") || "france-1";
const collections = window.photosByElieData || {};
const collectionEntry = Object.entries(collections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const [collectionKey, collection] = collectionEntry || ["france", collections.france];
const photo = collection.photos.find((item) => item.id === photoId) || collection.photos[0];
const photoIndex = collection.photos.findIndex((item) => item.id === photo.id);
const resolutions = window.photosByElieResolutions || [];
const availableResolutions = window.photosByElieAvailableResolutions
  ? window.photosByElieAvailableResolutions(photo, resolutions)
  : resolutions;
const basketStore = window.photosByElieBasket;

const selectedOptions = () => Array.from(document.querySelectorAll("[data-resolution]:checked"))
  .map((input) => {
    const option = availableResolutions.find((item) => item.id === input.value);
    return option ? { id: option.id, label: option.label, price: option.price } : null;
  })
  .filter(Boolean);

const updateTotal = () => {
  const total = selectedOptions().reduce((sum, option) => sum + option.price, 0);
  document.querySelector("[data-selection-total]").textContent = `$${total}`;
};

const basketItemForPhoto = () => basketStore.read().find((item) => item.photoId === photo.id);
const status = document.querySelector("[data-basket-status]");

document.title = `Photos By Elie | ${photo.title}`;
document.querySelector("[data-nav-current]").textContent = collection.title;
document.querySelector("[data-nav-current]").setAttribute("href", `./${collectionKey}.html`);
document.querySelector("[data-photo-title]").textContent = photo.title;
document.querySelector("[data-photo-meta]").textContent = `${collection.title} / ${photo.full} / ${photo.megapixels} MP source`;
document.querySelector("[data-photo-caption]").textContent = photo.caption;
document.querySelector("[data-back-link]").setAttribute("href", `./${collectionKey}.html`);

const prevPhotoLink = document.querySelector("[data-prev-photo]");
const nextPhotoLink = document.querySelector("[data-next-photo]");
if (prevPhotoLink && nextPhotoLink && collection.photos.length > 1) {
  const previousPhoto = collection.photos[(photoIndex - 1 + collection.photos.length) % collection.photos.length];
  const nextPhoto = collection.photos[(photoIndex + 1) % collection.photos.length];
  prevPhotoLink.setAttribute("href", `./photo.html?id=${previousPhoto.id}`);
  prevPhotoLink.setAttribute("aria-label", `Previous photo: ${previousPhoto.title}`);
  nextPhotoLink.setAttribute("href", `./photo.html?id=${nextPhoto.id}`);
  nextPhotoLink.setAttribute("aria-label", `Next photo: ${nextPhoto.title}`);
} else {
  document.querySelector(".detail-cycle")?.setAttribute("hidden", "");
}

const metadataRoot = document.querySelector("[data-photo-metadata]");
const metadata = Array.isArray(photo.metadata) ? photo.metadata.filter((item) => item.label && item.value) : [];
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
preview.querySelector("span").textContent = photo.title;

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
