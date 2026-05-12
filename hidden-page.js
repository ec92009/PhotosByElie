(() => {
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
  let renderedPhotos = [];
  let pendingPreviewLayout = 0;
  let fitMode = localStorage.getItem(fitModeKey) === "fill" ? "fill" : "fit";
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

  const renderSharedPhotoCard = (options) => window.photosByElieGalleryCard?.renderPhotoCard?.(options) || "";

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
    return hiddenActions.read().map((photoId) => index.get(photoId) || {
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

  const maxDensityColumns = () => {
    if (window.matchMedia("(max-width:760px)").matches) return 3;
    return 10;
  };

  const defaultDensityColumns = () => {
    if (window.matchMedia("(min-width:1520px)").matches) return 8;
    if (window.matchMedia("(min-width:1120px)").matches) return 6;
    if (window.matchMedia("(min-width:860px)").matches) return 4;
    if (window.matchMedia("(min-width:640px)").matches) return 3;
    return 2;
  };

  const preferredDensityColumns = () => {
    const savedValue = Number(localStorage.getItem(densityKey));
    const numericColumns = Number.isInteger(savedValue) ? savedValue : defaultDensityColumns();
    return Math.min(Math.max(numericColumns, 1), maxDensityColumns());
  };

  const cancelPreviewLayout = () => {
    if (!pendingPreviewLayout) return;
    window.cancelAnimationFrame(pendingPreviewLayout);
    pendingPreviewLayout = 0;
  };

  const previewLayoutMetrics = () => {
    if (!galleryRoot) return null;
    const styles = window.getComputedStyle(galleryRoot);
    const rowHeight = Number.parseFloat(styles.getPropertyValue("--gallery-masonry-row-height")) || 8;
    const rowGap = Number.parseFloat(styles.rowGap) || 0;
    const columnGap = Number.parseFloat(styles.columnGap) || 0;
    const columns = preferredDensityColumns();
    const contentWidth = galleryRoot.clientWidth;
    const columnWidth = (contentWidth - columnGap * Math.max(0, columns - 1)) / columns;
    const spanUnit = rowHeight + rowGap;
    if (spanUnit <= 0 || columnWidth <= 0) return null;
    return { columnGap, columnWidth, columns, rowGap, spanUnit };
  };

  const columnSpan = (photo, metrics) => (
    window.photosByEliePhotoIsPanorama?.(photo) && metrics.columns > 1 ? metrics.columns : 1
  );

  const previewSpan = (photo, metrics, captionHeight = 0, spanColumns = 1) => {
    const dimensions = window.photosByEliePreviewDimensions?.(photo);
    const aspectRatio = dimensions?.width && dimensions?.height
      ? dimensions.width / dimensions.height
      : 1;
    const cardWidth = (metrics.columnWidth * spanColumns) + (metrics.columnGap * Math.max(0, spanColumns - 1));
    const imageHeight = cardWidth / Math.max(.2, aspectRatio);
    const cardGap = 4;
    const cardHeight = imageHeight + cardGap + captionHeight + 2;
    return Math.max(1, Math.ceil((cardHeight + metrics.rowGap) / metrics.spanUnit));
  };

  const applyPreviewLayout = () => {
    if (!galleryRoot) return;
    cancelPreviewLayout();
    galleryRoot.style.setProperty("--gallery-zoom-columns", String(preferredDensityColumns()));
    galleryRoot.dataset.imageFit = fitMode;
    const cards = galleryRoot.querySelectorAll("[data-photo-index]");
    if (fitMode !== "fit") {
      cards.forEach((card) => {
        card.style.removeProperty("--gallery-column-span");
        card.style.removeProperty("--gallery-masonry-span");
      });
      return;
    }
    const metrics = previewLayoutMetrics();
    if (!metrics) {
      pendingPreviewLayout = window.requestAnimationFrame(() => {
        pendingPreviewLayout = 0;
        applyPreviewLayout();
      });
      return;
    }
    cards.forEach((card, index) => {
      const photo = renderedPhotos[index];
      const spanColumns = columnSpan(photo, metrics);
      const captionHeight = card.querySelector("[data-photo-caption]")?.getBoundingClientRect().height || 0;
      card.style.setProperty("--gallery-column-span", String(spanColumns));
      card.style.setProperty("--gallery-masonry-span", String(previewSpan(photo, metrics, captionHeight, spanColumns)));
    });
  };

  const render = () => {
    if (!galleryRoot) return;
    if (shortcutHint) shortcutHint.hidden = !hiddenActions?.enabled || !shouldShowKeyboardHints();
    if (!hiddenActions?.enabled) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="Owner controls unavailable">
          <span>Owner controls are only available on localhost</span>
        </article>
      `;
      setStatus("Blocked review is locked on the public site.");
      return;
    }

    const photos = hiddenPhotos();
    renderedPhotos = photos;
    if (!catalogsLoaded) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="Loading blocked photos">
          <span>Loading blocked photos</span>
        </article>
      `;
      setStatus("Loading blocked photo catalogs.");
      return;
    }
    if (!photos.length) {
      galleryRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="No blocked photos">
          <span>No blocked photos</span>
        </article>
      `;
      setStatus("The blocked gallery is empty.");
      return;
    }

    galleryRoot.innerHTML = photos.map((photo, index) => {
      const href = photo.source === "missing" ? "" : versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`);
      return renderSharedPhotoCard({
        photo,
        index,
        href,
        collectionKey: photo.galleryKey,
        collectionAccent: photo.collectionAccent,
        missingLabel: photo.title,
      });
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

    applyPreviewLayout();
    updateSelection();
    setStatus(`${photos.length} blocked photo${photos.length === 1 ? "" : "s"}.`);
  };

  window.addEventListener("resize", () => {
    applyPreviewLayout();
    updateSelection({ scroll: false });
  });
  window.addEventListener("load", applyPreviewLayout, { once: true });
  window.addEventListener("storage", (event) => {
    if (event.key !== densityKey && event.key !== fitModeKey) return;
    fitMode = localStorage.getItem(fitModeKey) === "fill" ? "fill" : "fit";
    applyPreviewLayout();
  });

  window.addEventListener("keydown", async (event) => {
    if (!hiddenActions?.enabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
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
    if (event.key === "Enter") {
      const selected = photos[selectedIndex];
      if (selected && selected.source !== "missing") {
        window.location.assign(versionedHref(`./photo.html?id=${encodeURIComponent(selected.id)}`));
      }
      event.preventDefault();
      return;
    }
    const selected = photos[selectedIndex];
    if (!selected) return;
    if (event.key.toLowerCase() === "d") {
      const confirmed = window.confirm(`Discard "${selected.title}"?\n\nThis removes it from Blocked and keeps a tombstone so imports do not bring it back.`);
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
      setStatus(`${selected.title} re-promoted.`);
    } catch (error) {
      setStatus(error?.message || "Could not re-promote photo.");
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
    render();
  });
  render();
})();
