(async () => {
  await window.photosByElieCatalogReady;
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const hiddenStore = window.photosByElieHidden;
  const galleryRoot = document.querySelector("[data-hidden-root]");
  const status = document.querySelector("[data-hidden-status]");
  const shortcutHint = document.querySelector("[data-hidden-shortcut-hint]");
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
  const shouldShowKeyboardHints = () => window.photosByElieInputMode?.shouldShowKeyboardHints?.() ?? true;
  const densityKey = "photosbyelie-gallery-columns";
  const fitModeKey = "photosbyelie-gallery-fit-mode";
  const pageSize = 24;
  let renderedPhotos = [];
  let allHiddenPhotos = [];
  let selectedIndex = 0;
  let catalogsLoaded = false;
  let visibleLimit = pageSize;
  let photoIndexCache = null;
  let viewControls = null;
  let densityInput = null;
  let densityValue = null;
  let fitModeButtons = [];
  let moreButton = null;
  let showAllButton = null;
  const galleryLayout = window.photosByElieGalleryLayout.createMasonryController({
    root: galleryRoot,
    getPhotos: () => renderedPhotos,
    densityKey,
    fitModeKey,
    allowCull: true,
  });

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const fitModeStatus = (mode) => {
    if (mode === "cull") return "Cull view.";
    return mode === "fill" ? "Fill view." : "Fit view.";
  };

  const cycleFitMode = () => {
    const modes = ["fill", "fit", "cull"];
    const currentIndex = modes.indexOf(galleryLayout.fitMode());
    const nextMode = galleryLayout.setFitMode(modes[(Math.max(0, currentIndex) + 1) % modes.length]);
    applyPreviewLayout();
    return nextMode;
  };

  const escapeHtml = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const renderSharedPhotoCard = (options) => window.photosByElieGalleryCard?.renderPhotoCard?.(options) || "";

  const photoActionHtml = () => `
    <div class="waste-basket-card-actions">
      <span class="waste-basket-state">Blacklisted master</span>
    </div>
  `;

  const allPhotoIndex = () => {
    if (photoIndexCache) return photoIndexCache;
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
    photoIndexCache = byId;
    return byId;
  };

  const hiddenPhotos = () => {
    const index = allPhotoIndex();
    return hiddenActions.read().map((photoId) => index.get(photoId) || {
      id: photoId,
      title: photoId,
      collectionTitle: "Unknown",
      collectionAccent: "unknown-gallery",
      className: "p1",
      source: "missing",
    });
  };

  const ensureViewControls = () => {
    if (!galleryRoot || viewControls) return;
    viewControls = document.createElement("div");
    viewControls.className = "gallery-view-controls";
    viewControls.setAttribute("aria-label", "Waste Basket view controls");
    viewControls.innerHTML = `
      <label class="gallery-density-control">
        <span>Grid</span>
        <input type="range" min="1" max="${galleryLayout.maxDensityColumns()}" step="1" value="${galleryLayout.preferredDensityColumns()}" data-hidden-density/>
        <b data-hidden-density-value>${galleryLayout.preferredDensityColumns()}</b>
      </label>
      <div class="gallery-fit-control" role="group" aria-label="Image fit">
        <button type="button" data-hidden-fit-mode="fit" aria-pressed="true">Fit</button>
        <button type="button" data-hidden-fit-mode="fill" aria-pressed="false">Fill</button>
      </div>
      <button class="gallery-top-button" type="button" data-hidden-top>Top</button>
    `;
    document.body.append(viewControls);
    densityInput = viewControls.querySelector("[data-hidden-density]");
    densityValue = viewControls.querySelector("[data-hidden-density-value]");
    fitModeButtons = [...viewControls.querySelectorAll("[data-hidden-fit-mode]")];
    densityInput?.addEventListener("input", () => {
      galleryLayout.setDensityColumns(Number(densityInput.value));
      galleryLayout.applyDensityControls({ input: densityInput, value: densityValue });
      applyPreviewLayout();
      updateSelection();
    });
    viewControls.querySelector("[data-hidden-top]")?.addEventListener("click", () => {
      selectedIndex = 0;
      updateSelection();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    viewControls.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-hidden-fit-mode]");
      if (!button) return;
      galleryLayout.setFitMode(button.dataset.hiddenFitMode);
      galleryLayout.applyFitMode(fitModeButtons);
      applyPreviewLayout();
    });
    galleryLayout.applyDensityControls({ input: densityInput, value: densityValue });
    galleryLayout.applyFitMode(fitModeButtons);
    positionViewControls();
  };

  const ensurePagingControls = () => {
    if (moreButton || !galleryRoot) return;
    const controls = document.createElement("div");
    controls.className = "gallery-pagination-controls";
    moreButton = document.createElement("button");
    moreButton.className = "btn secondary gallery-more-button";
    moreButton.type = "button";
    moreButton.textContent = "Show more";
    moreButton.hidden = true;
    showAllButton = document.createElement("button");
    showAllButton.className = "btn secondary gallery-more-button";
    showAllButton.type = "button";
    showAllButton.textContent = "Show all";
    showAllButton.hidden = true;
    controls.append(moreButton, showAllButton);
    galleryRoot.after(controls);
    moreButton.addEventListener("click", () => {
      visibleLimit = Math.min(allHiddenPhotos.length, visibleLimit + pageSize);
      render({ scrollSelection: false });
    });
    showAllButton.addEventListener("click", () => {
      visibleLimit = allHiddenPhotos.length;
      render({ scrollSelection: false });
    });
  };

  const syncPagingControls = (photos) => {
    ensurePagingControls();
    if (!moreButton || !showAllButton) return;
    const hasMore = photos.length > renderedPhotos.length;
    moreButton.hidden = !hasMore;
    showAllButton.hidden = !hasMore;
    const moreCount = Math.min(pageSize, Math.max(0, photos.length - renderedPhotos.length));
    moreButton.textContent = `Show ${moreCount} more`;
    showAllButton.textContent = "Show all";
  };

  const positionViewControls = () => {
    window.photosByEliePositionGalleryViewControls?.(viewControls);
  };

  const updateSelection = ({ scroll = true } = {}) => {
    const cards = [...galleryRoot.querySelectorAll("[data-photo-index]")];
    if (!cards.length) return;
    selectedIndex = Math.max(0, Math.min(selectedIndex, cards.length - 1));
    cards.forEach((card, index) => {
      card.classList.toggle("is-selected", index === selectedIndex);
    });
    if (scroll) cards[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const visibleColumnCount = () => {
    const cards = [...galleryRoot.querySelectorAll("[data-photo-index]")];
    if (!cards.length) return 1;
    const firstTop = cards[0].offsetTop;
    const columns = cards.findIndex((card, index) => index > 0 && card.offsetTop !== firstTop);
    return columns > 0 ? columns : cards.length;
  };

  const applyPreviewLayout = () => {
    galleryLayout.applyDensityControls({ input: densityInput, value: densityValue });
    galleryLayout.applyFitMode(fitModeButtons);
    galleryLayout.applyPreviewLayout(renderedPhotos);
  };

  const render = ({ scrollSelection = true } = {}) => {
    if (!galleryRoot) return;
    if (shortcutHint) shortcutHint.hidden = !hiddenActions?.enabled || !shouldShowKeyboardHints();
    if (!hiddenActions?.enabled) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="Owner controls unavailable">
          <span>Owner controls are only available on localhost</span>
        </article>
      `;
      setStatus("Waste Basket review is locked on the public site.");
      return;
    }

    ensureViewControls();
    ensurePagingControls();
    allHiddenPhotos = hiddenPhotos();
    if (!catalogsLoaded) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="Loading Waste Basket photos">
          <span>Loading Waste Basket photos</span>
        </article>
      `;
      setStatus("Loading Waste Basket photo catalogs.");
      return;
    }
    if (!allHiddenPhotos.length) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="No Waste Basket photos">
          <span>No Waste Basket photos</span>
        </article>
      `;
      setStatus("The Waste Basket is empty.");
      syncPagingControls(allHiddenPhotos);
      return;
    }

    visibleLimit = Math.min(Math.max(visibleLimit, pageSize), allHiddenPhotos.length);
    const photos = allHiddenPhotos.slice(0, visibleLimit);
    renderedPhotos = photos;
    const moreCount = Math.max(0, allHiddenPhotos.length - photos.length);

    galleryRoot.innerHTML = photos.map((photo, index) => {
      const href = photo.source === "missing" ? "" : versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`);
      return renderSharedPhotoCard({
        photo,
        index,
        href,
        collectionKey: photo.galleryKey,
        collectionAccent: photo.collectionAccent,
        actionHtml: photoActionHtml(),
        missingLabel: photo.title,
      });
    }).join("");

    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        event.preventDefault();
        selectedIndex = Number(card.dataset.photoIndex || 0);
        updateSelection();
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        if (card.dataset.photoHref) window.location.assign(versionedHref(card.dataset.photoHref));
      });
    });
    window.photosByElieVersionInternalLinks?.(galleryRoot);

    applyPreviewLayout();
    syncPagingControls(allHiddenPhotos);
    updateSelection({ scroll: scrollSelection });
    setStatus(moreCount
      ? `Showing ${photos.length} of ${allHiddenPhotos.length} Waste Basket photos.`
      : `${photos.length} Waste Basket photo${photos.length === 1 ? "" : "s"}.`);
  };

  window.addEventListener("resize", () => {
    applyPreviewLayout();
    positionViewControls();
    updateSelection({ scroll: false });
  });
  window.addEventListener("scroll", positionViewControls, { passive: true });
  window.addEventListener("load", () => {
    applyPreviewLayout();
    positionViewControls();
  }, { once: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      applyPreviewLayout();
      positionViewControls();
      updateSelection({ scroll: false });
    }).catch(() => {});
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== densityKey && event.key !== fitModeKey) return;
    galleryLayout.syncFromStorage();
    applyPreviewLayout();
  });

  window.addEventListener("keydown", async (event) => {
    if (!hiddenActions?.enabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
    }
    const photos = renderedPhotos.length ? renderedPhotos : hiddenPhotos();
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
      const nextIndex = selectedIndex + visibleColumnCount();
      if (nextIndex >= photos.length - 1 && visibleLimit < allHiddenPhotos.length) {
        visibleLimit = Math.min(allHiddenPhotos.length, visibleLimit + pageSize);
        render({ scrollSelection: false });
      }
      selectedIndex = Math.min(nextIndex, renderedPhotos.length - 1);
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
    if (event.key === "Enter") {
      const selected = photos[selectedIndex];
      if (selected && selected.source !== "missing") {
        window.location.assign(versionedHref(`./photo.html?id=${encodeURIComponent(selected.id)}`));
      }
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "z") {
      const nextMode = cycleFitMode();
      setStatus(fitModeStatus(nextMode));
      event.preventDefault();
      return;
    }
    const selected = photos[selectedIndex];
    if (!selected) return;
    if (event.key.toLowerCase() === "d") {
      const confirmed = window.confirm(`Discard "${selected.title}"?\n\nThis keeps the master blacklisted, removes remaining review/catalog copies, and leaves only the tombstone so imports do not bring it back.`);
      if (!confirmed) {
        event.preventDefault();
        return;
      }
      try {
        await hiddenActions.discard?.(selected.id);
        selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
        render();
        setStatus(`${selected.title} discarded.`);
      } catch (error) {
        setStatus(error?.message || "Could not discard photo.");
      }
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() !== "p") return;
    try {
      await hiddenActions.promoteHidden(selected.id);
      selectedIndex = Math.min(selectedIndex, Math.max(0, photos.length - 2));
      render();
      setStatus(`${selected.title} put back.`);
    } catch (error) {
      setStatus(error?.message || "Could not put photo back.");
    }
    event.preventDefault();
  });

  window.addEventListener("photosbyelie:hiddenchange", render);
  window.addEventListener("photosbyelie:inputmodechange", render);

  Promise.all([
    reserveStore?.load?.() || Promise.resolve({}),
    hiddenStore?.load?.() || Promise.resolve({}),
  ]).then(() => {
    catalogsLoaded = true;
    photoIndexCache = null;
    render();
  });
  render();
})();
