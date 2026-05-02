const params = new URLSearchParams(window.location.search);
const photoId = params.get("id") || "france-1";
const collections = window.photosByElieData || {};
const collectionEntry = Object.entries(collections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const [collectionKey, collection] = collectionEntry || ["france", collections.france];
const photo = collection.photos.find((item) => item.id === photoId) || collection.photos[0];
const resolutions = window.photosByElieResolutions || [];
const basketKey = "photosbyelie-basket";

const readBasket = () => {
  try {
    return JSON.parse(localStorage.getItem(basketKey) || "[]");
  } catch {
    return [];
  }
};

const writeBasket = (items) => {
  localStorage.setItem(basketKey, JSON.stringify(items));
};

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
  const basket = readBasket();
  document.querySelector("[data-basket-count]").textContent = String(basket.length);
};

document.title = `Photos By Elie | ${photo.title}`;
document.querySelector("[data-nav-current]").textContent = collection.title;
document.querySelector("[data-nav-current]").setAttribute("href", `./${collectionKey}.html`);
document.querySelector("[data-photo-title]").textContent = photo.title;
document.querySelector("[data-photo-meta]").textContent = `${collection.title} / ${photo.full} / ${photo.megapixels} MP source`;
document.querySelector("[data-photo-caption]").textContent = photo.caption;
document.querySelector("[data-back-link]").setAttribute("href", `./${collectionKey}.html`);

const preview = document.querySelector("[data-photo-preview]");
preview.classList.add(collection.accent, photo.className);
preview.querySelector("span").textContent = photo.title;

document.querySelector("[data-resolution-list]").innerHTML = resolutions.map((option, index) => `
  <label class="resolution-row">
    <input type="checkbox" data-resolution value="${option.id}" ${index === 1 ? "checked" : ""}/>
    <span>
      <strong>${option.label}</strong>
      <small>${option.detail}</small>
    </span>
    <b>$${option.price}</b>
  </label>
`).join("");

document.querySelectorAll("[data-resolution]").forEach((input) => {
  input.addEventListener("change", updateTotal);
});

document.querySelector("[data-add-basket]").addEventListener("click", () => {
  const options = selectedOptions();
  if (!options.length) return;
  const basket = readBasket();
  basket.push({
    photoId: photo.id,
    title: photo.title,
    collection: collection.title,
    options,
    total: options.reduce((sum, option) => sum + option.price, 0)
  });
  writeBasket(basket);
  updateBasketCount();
  document.querySelector("[data-basket-status]").innerHTML = `${photo.title} added with ${options.length} license option${options.length === 1 ? "" : "s"}. <a href="./basket.html">View basket</a>`;
});

updateTotal();
updateBasketCount();
