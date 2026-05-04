(() => {
  const unworthyStore = window.photosByElieUnworthy;
  const reserveStore = window.photosByElieReserve;
  const hiddenStore = window.photosByElieHidden;
  const galleryRoot = document.querySelector("[data-unworthy-root]");
  const status = document.querySelector("[data-unworthy-status]");
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
  let selectedIndex = 0;
  let catalogsLoaded = false;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const escapeHtml = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const allPhotoIndex = () => {
    const byId = new Map();
    const addCollection = (collections, source) => {
      Object.entries(collections || {}).forEach(([galleryKey, collection]) => {
        (collection.photos || []).forEach((photo) => {
          if (byId.has(photo.id)) return;
          byId.set(photo.id, {
            ...photo,
            collectionTitle: collection.title,
            collectionAccent: collection.accent,
            galleryKey,
            source,
          });
        });
      });
    };
    addCollection(window.photosByElieData, "expo");
    addCollection(window.photosByElieReserveData, "reserve");
    addCollection(window.photosByElieHiddenData, "hidden");
    return byId;
  };

  const hiddenPhotos = () => {
    const index = allPhotoIndex();
    return unworthyStore.read().map((photoId) => index.get(photoId) || {
      id: photoId,
      title: photoId,
      collectionTitle: "Unknown",
      collectionAccent: "unknown-gallery",
      className: "p1",
      source: "missing",
    });
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

  const render = () => {
    if (!galleryRoot) return;
    if (!unworthyStore?.enabled) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="Owner controls unavailable">
          <span>Owner controls are only available on localhost</span>
        </article>
      `;
      setStatus("Hidden review is locked on the public site.");
      return;
    }

    const photos = hiddenPhotos();
    if (!catalogsLoaded) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="Loading hidden photos">
          <span>Loading hidden photos</span>
        </article>
      `;
      setStatus("Loading hidden photo catalogs.");
      return;
    }
    if (!photos.length) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="No hidden photos">
          <span>No hidden photos</span>
        </article>
      `;
      setStatus("The hidden gallery is empty.");
      return;
    }

    galleryRoot.innerHTML = photos.map((photo, index) => {
      const src = photo.gallerySrc || photo.imageSrc || "";
      const href = photo.source === "missing" ? "" : versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`);
      return `
        <article
          class="mock-photo ${photo.collectionAccent} ${photo.className} ${src ? "has-image" : ""}"
          aria-label="${escapeHtml(photo.title)}"
          data-photo-index="${index}"
          data-photo-id="${escapeHtml(photo.id)}"
          data-photo-href="${href}"
        >
          ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(photo.title)}"/>` : `<span>${escapeHtml(photo.title)}</span>`}
        </article>
      `;
    }).join("");

    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", () => {
        selectedIndex = Number(card.dataset.photoIndex || 0);
        updateSelection();
      });
      card.addEventListener("dblclick", () => {
        if (card.dataset.photoHref) window.location.assign(versionedHref(card.dataset.photoHref));
      });
    });
    window.photosByElieVersionInternalLinks?.(galleryRoot);

    updateSelection();
    setStatus(`${photos.length} hidden photo${photos.length === 1 ? "" : "s"}.`);
  };

  window.addEventListener("keydown", (event) => {
    if (!unworthyStore?.enabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
    }
    const photos = hiddenPhotos();
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
    if (event.key.toLowerCase() !== "p") return;
    const selected = photos[selectedIndex];
    if (!selected) return;
    unworthyStore.returnToReserve(selected.id);
    selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
    render();
    setStatus(`${selected.title} returned to Reserve.`);
    event.preventDefault();
  });

  window.addEventListener("photosbyelie:unworthychange", render);

  Promise.all([
    reserveStore?.load?.() || Promise.resolve({}),
    hiddenStore?.load?.() || Promise.resolve({}),
  ]).then(() => {
    catalogsLoaded = true;
    render();
  });
  render();
})();
