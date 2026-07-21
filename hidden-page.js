(async () => {
  await window.photosByElieCatalogReady;
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const hiddenStore = window.photosByElieHidden;
  const galleryRoot = document.querySelector("[data-hidden-root]");
  const status = document.querySelector("[data-hidden-status]");
  const shortcutHint = document.querySelector("[data-hidden-shortcut-hint]");
  const selectionCount = document.querySelector("[data-hidden-selection-count]");
  const selectAllButton = document.querySelector("[data-hidden-select-all]");
  const clearSelectionButton = document.querySelector("[data-hidden-clear-selection]");
  const restoreSelectedButton = document.querySelector("[data-hidden-restore-selected]");
  const discardSelectedButton = document.querySelector("[data-hidden-discard-selected]");
  const emptyWasteBasketButton = document.querySelector("[data-hidden-empty]");
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
  const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
  const seeMoreLabel = (count) => t("home.see_more_count", { count });
  const seeAllLabel = (count) => t("home.see_all_count", { count });
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
  let moreDoubleButton = null;
  let showAllButton = null;
  let lastSelectionIndex = null;
  let managerBusy = false;
  const selectedIds = new Set();
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

  const photoActionHtml = (photo) => `
    <div class="waste-basket-card-actions">
      <input type="checkbox" data-hidden-card-checkbox aria-label="Select ${escapeHtml(photo.title || photo.id)}" ${selectedIds.has(photo.id) ? "checked" : ""}/>
      <span class="waste-basket-state">Blacklisted master</span>
    </div>
  `;

  const syncManagerControls = () => {
    const count = selectedIds.size;
    if (selectionCount) {
      selectionCount.textContent = `${count.toLocaleString()} selected · ${allHiddenPhotos.length.toLocaleString()} in Waste Basket`;
    }
    [clearSelectionButton, restoreSelectedButton, discardSelectedButton].forEach((button) => {
      if (button) button.disabled = managerBusy || count === 0;
    });
    if (selectAllButton) selectAllButton.disabled = managerBusy || renderedPhotos.length === 0;
    if (emptyWasteBasketButton) emptyWasteBasketButton.disabled = managerBusy || allHiddenPhotos.length === 0;
  };

  const setManagerBusy = (busy) => {
    managerBusy = busy;
    syncManagerControls();
  };

  const selectedPhotoIds = () => [...selectedIds].filter((photoId) => allHiddenPhotos.some((photo) => photo.id === photoId));

  const restorePhotoIds = async (photoIds) => {
    const ids = [...new Set(photoIds)].filter(Boolean);
    if (!ids.length) return;
    setManagerBusy(true);
    setStatus(`Restoring ${ids.length.toLocaleString()} photo${ids.length === 1 ? "" : "s"}...`);
    try {
      const restored = await hiddenActions.undoMany(ids);
      restored.forEach((photoId) => selectedIds.delete(photoId));
      render({ scrollSelection: false });
      setStatus(`${restored.length.toLocaleString()} photo${restored.length === 1 ? "" : "s"} restored.`);
    } finally {
      setManagerBusy(false);
    }
  };

  const discardPhotoIds = async (photoIds, { empty = false } = {}) => {
    const ids = [...new Set(photoIds)].filter(Boolean);
    if (!ids.length) return;
    const label = empty ? "the entire Waste Basket" : `${ids.length.toLocaleString()} selected photo${ids.length === 1 ? "" : "s"}`;
    if (!window.confirm(`Permanently discard ${label}?\n\nThis writes durable tombstones and queues deletion of matching R2 media. It cannot be undone from the Waste Basket.`)) return;
    setManagerBusy(true);
    let completed = 0;
    try {
      for (const photoId of ids) {
        setStatus(`Permanently discarding ${completed + 1} of ${ids.length}...`);
        await hiddenActions.discard(photoId);
        selectedIds.delete(photoId);
        completed += 1;
      }
      render({ scrollSelection: false });
      setStatus(`${completed.toLocaleString()} photo${completed === 1 ? "" : "s"} permanently discarded; R2 deletion is queued.`);
    } catch (error) {
      render({ scrollSelection: false });
      throw new Error(`${completed.toLocaleString()} completed before the operation stopped. ${error?.message || "Could not finish permanent discard."}`);
    } finally {
      setManagerBusy(false);
    }
  };

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
    moreButton.textContent = seeMoreLabel(pageSize);
    moreButton.hidden = true;
    moreDoubleButton = document.createElement("button");
    moreDoubleButton.className = "btn secondary gallery-more-button";
    moreDoubleButton.type = "button";
    moreDoubleButton.textContent = seeMoreLabel(pageSize * 2);
    moreDoubleButton.hidden = true;
    showAllButton = document.createElement("button");
    showAllButton.className = "btn secondary gallery-more-button";
    showAllButton.type = "button";
    showAllButton.textContent = seeAllLabel(pageSize);
    showAllButton.hidden = true;
    controls.append(moreButton, moreDoubleButton, showAllButton);
    galleryRoot.after(controls);
    moreButton.addEventListener("click", () => {
      visibleLimit = Math.min(allHiddenPhotos.length, visibleLimit + pageSize);
      render({ scrollSelection: false });
    });
    moreDoubleButton.addEventListener("click", () => {
      visibleLimit = Math.min(allHiddenPhotos.length, visibleLimit + pageSize * 2);
      render({ scrollSelection: false });
    });
    showAllButton.addEventListener("click", () => {
      visibleLimit = allHiddenPhotos.length;
      render({ scrollSelection: false });
    });
  };

  const syncPagingControls = (photos) => {
    ensurePagingControls();
    if (!moreButton || !moreDoubleButton || !showAllButton) return;
    const hasMore = photos.length > renderedPhotos.length;
    moreButton.hidden = !hasMore;
    moreDoubleButton.hidden = !hasMore || photos.length - renderedPhotos.length <= pageSize;
    showAllButton.hidden = !hasMore;
    const remaining = Math.max(0, photos.length - renderedPhotos.length);
    moreButton.textContent = seeMoreLabel(Math.min(pageSize, remaining));
    moreDoubleButton.textContent = seeMoreLabel(Math.min(pageSize * 2, remaining));
    showAllButton.textContent = seeAllLabel(remaining);
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
      const photo = renderedPhotos[index];
      const batchSelected = Boolean(photo && selectedIds.has(photo.id));
      card.classList.toggle("is-batch-selected", batchSelected);
      const checkbox = card.querySelector("[data-hidden-card-checkbox]");
      if (checkbox) checkbox.checked = batchSelected;
    });
    if (scroll) cards[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    syncManagerControls();
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

  const extendKeyboardSelection = (destinationIndex) => {
    if (!renderedPhotos.length) return;
    let anchorIndex = Number.isInteger(lastSelectionIndex) ? lastSelectionIndex : -1;
    if (anchorIndex < 0 && selectedIds.size === 1) {
      const [onlySelectedId] = selectedIds;
      anchorIndex = renderedPhotos.findIndex((photo) => photo.id === onlySelectedId);
    }
    if (anchorIndex < 0) anchorIndex = Math.max(0, Math.min(selectedIndex, renderedPhotos.length - 1));
    lastSelectionIndex = anchorIndex;
    selectedIds.clear();
    const start = Math.min(anchorIndex, destinationIndex);
    const end = Math.max(anchorIndex, destinationIndex);
    renderedPhotos.slice(start, end + 1).forEach((photo) => selectedIds.add(photo.id));
  };

  const moveKeyboardFocus = (destinationIndex, { extend = false } = {}) => {
    selectedIndex = Math.max(0, Math.min(destinationIndex, renderedPhotos.length - 1));
    if (extend) extendKeyboardSelection(selectedIndex);
    updateSelection();
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
    const liveIds = new Set(allHiddenPhotos.map((photo) => photo.id));
    [...selectedIds].forEach((photoId) => {
      if (!liveIds.has(photoId)) selectedIds.delete(photoId);
    });
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
        actionHtml: photoActionHtml(photo),
        missingLabel: photo.title,
      });
    }).join("");

    galleryRoot.querySelectorAll("[data-photo-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        event.preventDefault();
        const nextIndex = Number(card.dataset.photoIndex || 0);
        const photo = renderedPhotos[nextIndex];
        if (!photo) return;
        if (event.shiftKey && Number.isInteger(lastSelectionIndex)) {
          const start = Math.min(lastSelectionIndex, nextIndex);
          const end = Math.max(lastSelectionIndex, nextIndex);
          if (!event.metaKey && !event.ctrlKey) selectedIds.clear();
          renderedPhotos.slice(start, end + 1).forEach((item) => selectedIds.add(item.id));
        } else if (event.metaKey || event.ctrlKey || event.target.closest("[data-hidden-card-checkbox]")) {
          if (selectedIds.has(photo.id)) selectedIds.delete(photo.id);
          else selectedIds.add(photo.id);
        } else {
          selectedIds.clear();
          selectedIds.add(photo.id);
        }
        selectedIndex = nextIndex;
        lastSelectionIndex = nextIndex;
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

  selectAllButton?.addEventListener("click", () => {
    renderedPhotos.forEach((photo) => selectedIds.add(photo.id));
    updateSelection({ scroll: false });
  });
  clearSelectionButton?.addEventListener("click", () => {
    selectedIds.clear();
    lastSelectionIndex = null;
    updateSelection({ scroll: false });
  });
  restoreSelectedButton?.addEventListener("click", () => {
    restorePhotoIds(selectedPhotoIds()).catch((error) => setStatus(error?.message || "Could not restore selected photos."));
  });
  discardSelectedButton?.addEventListener("click", () => {
    discardPhotoIds(selectedPhotoIds()).catch((error) => setStatus(error?.message || "Could not discard selected photos."));
  });
  emptyWasteBasketButton?.addEventListener("click", () => {
    discardPhotoIds(allHiddenPhotos.map((photo) => photo.id), { empty: true })
      .catch((error) => setStatus(error?.message || "Could not empty the Waste Basket."));
  });

  window.addEventListener("keydown", async (event) => {
    if (!hiddenActions?.enabled || event.defaultPrevented || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      renderedPhotos.forEach((photo) => selectedIds.add(photo.id));
      updateSelection({ scroll: false });
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    const photos = renderedPhotos.length ? renderedPhotos : hiddenPhotos();
    if (!photos.length) return;
    if (event.key === "ArrowRight") {
      moveKeyboardFocus(selectedIndex + 1, { extend: event.shiftKey });
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft") {
      moveKeyboardFocus(selectedIndex - 1, { extend: event.shiftKey });
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      const nextIndex = selectedIndex + visibleColumnCount();
      if (nextIndex >= photos.length - 1 && visibleLimit < allHiddenPhotos.length) {
        visibleLimit = Math.min(allHiddenPhotos.length, visibleLimit + pageSize);
        render({ scrollSelection: false });
      }
      moveKeyboardFocus(nextIndex, { extend: event.shiftKey });
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp") {
      moveKeyboardFocus(selectedIndex - visibleColumnCount(), { extend: event.shiftKey });
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
