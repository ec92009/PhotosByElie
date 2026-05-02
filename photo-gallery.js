const galleryKey = document.body.dataset.gallery;
const gallery = window.photosByElieData?.[galleryKey];

const galleryRoot = document.querySelector("[data-gallery-root]");

if (galleryRoot && gallery) {
  document.title = `Photos By Elie | ${gallery.title} Gallery`;
  document.querySelector("[data-nav-current]").textContent = gallery.title;
  document.querySelector("[data-nav-current]").setAttribute("href", `./${galleryKey}.html`);
  document.querySelector("[data-gallery-number]").textContent = `Collection ${gallery.number}`;
  document.querySelector("[data-gallery-title]").textContent = gallery.title;
  document.querySelector("[data-gallery-description]").textContent = gallery.description;
  galleryRoot.classList.add(gallery.accent);
  galleryRoot.setAttribute("aria-label", `${gallery.title} mock photos`);
  galleryRoot.innerHTML = gallery.photos.map((photo) => `
    <a class="mock-photo ${photo.className} ${photo.imageSrc ? "has-image" : ""}" href="./photo.html?id=${photo.id}" aria-label="Open ${photo.title}">
      ${photo.imageSrc ? `<img src="${photo.imageSrc}" alt="${photo.title}"/>` : ""}
      <span>${photo.title}</span>
    </a>
  `).join("");
}
