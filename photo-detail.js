const params = new URLSearchParams(window.location.search);
const photoId = params.get("id") || "france-1";
const collections = window.photosByElieData || {};
const collectionEntry = Object.entries(collections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const [collectionKey, collection] = collectionEntry || ["france", collections.france];
const photo = collection.photos.find((item) => item.id === photoId) || collection.photos[0];
const resolutions = window.photosByElieResolutions || [];
const basketStore = window.photosByElieBasket;

const selectedOptions = () => Array.from(document.querySelectorAll("[data-resolution]:checked"))
  .map((input) => {
    const option = resolutions.find((item) => item.id === input.value);
    return option ? { id: option.id, label: option.label, price: option.price } : null;
  })
  .filter(Boolean);

const updateTotal = () => {
  const total = selectedOptions().reduce((sum, option) => sum + option.price, 0);
  document.querySelector("[data-selection-total]").textContent = `$${total}`;
};

const updateBasketCount = () => {
  const basket = basketStore.read();
  document.querySelector("[data-basket-count]").textContent = String(basket.length);
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

const preview = document.querySelector("[data-photo-preview]");
preview.classList.add(collection.accent, photo.className);
if (photo.imageSrc) {
  preview.classList.add("has-image");
  preview.insertAdjacentHTML("afterbegin", `<img src="${photo.imageSrc}" alt="${photo.title}"/>`);
}
preview.querySelector("span").textContent = photo.title;

const selectedIds = new Set((basketItemForPhoto()?.options || []).map((option) => option.id));

document.querySelector("[data-resolution-list]").innerHTML = resolutions.map((option) => `
  <label class="resolution-row">
    <input type="checkbox" data-resolution value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
    <span>
      <strong>${option.label}</strong>
      <small>${option.detail}</small>
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
  updateBasketCount();
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
updateBasketCount();
