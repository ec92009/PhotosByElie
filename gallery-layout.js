(() => {
  const defaultDensityKey = "photosbyelie-gallery-columns";
  const defaultFitModeKey = "photosbyelie-gallery-fit-mode";

  const maxDensityColumns = () => (window.matchMedia("(max-width:760px)").matches ? 8 : 10);
  const defaultDensityColumns = () => 3;

  const createMasonryController = ({
    root,
    getPhotos = () => [],
    densityKey = defaultDensityKey,
    fitModeKey = defaultFitModeKey,
    defaultDensity = defaultDensityColumns(),
    defaultFitMode = "fill",
    ignoreSavedLayout = false,
    allowCull = false,
    dimensionsFor = (photo) => window.photosByEliePreviewDimensions?.(photo),
    isPanorama = (photo) => window.photosByEliePhotoIsPanorama?.(photo),
  } = {}) => {
    let pendingLayout = 0;
    const params = new URLSearchParams(window.location.search);
    const initialDensity = Number(params.get("columns") || params.get("grid"));
    let densityOverride = Number.isFinite(initialDensity) && initialDensity > 0 ? initialDensity : null;
    const normalizeFitMode = (mode, fallback = "fill") => {
      const normalized = String(mode || "").toLowerCase();
      if (normalized === "fit" || normalized === "fill" || (allowCull && normalized === "cull")) return normalized;
      return fallback;
    };
    const requestedFit = String(params.get("fit") || params.get("view") || "").toLowerCase();
    const savedFitMode = ignoreSavedLayout ? "" : localStorage.getItem(fitModeKey);
    const defaultMode = normalizeFitMode(defaultFitMode);
    const savedMode = normalizeFitMode(savedFitMode, "");
    let fitMode = normalizeFitMode(requestedFit, savedMode || defaultMode);

    const clampDensityColumns = (columns) => {
      const numericColumns = Number(columns);
      return Math.min(
        Math.max(Number.isFinite(numericColumns) ? numericColumns : defaultDensity, 1),
        maxDensityColumns()
      );
    };

    const preferredDensityColumns = () => {
      if (densityOverride !== null) return clampDensityColumns(densityOverride);
      const savedDensity = localStorage.getItem(densityKey);
      const savedValue = savedDensity === null ? NaN : Number(savedDensity);
      return clampDensityColumns(!ignoreSavedLayout && Number.isInteger(savedValue) ? savedValue : defaultDensity);
    };

    const cancelPreviewLayout = () => {
      if (!pendingLayout) return;
      window.cancelAnimationFrame(pendingLayout);
      pendingLayout = 0;
    };

    const previewLayoutMetrics = () => {
      if (!root) return null;
      const styles = window.getComputedStyle(root);
      const rowHeight = Number.parseFloat(styles.getPropertyValue("--gallery-masonry-row-height")) || 8;
      const rowGap = Number.parseFloat(styles.rowGap) || 0;
      const columnGap = Number.parseFloat(styles.columnGap) || 0;
      const columns = preferredDensityColumns();
      const contentWidth = root.clientWidth;
      const columnWidth = (contentWidth - columnGap * Math.max(0, columns - 1)) / columns;
      const spanUnit = rowHeight + rowGap;
      if (spanUnit <= 0 || columnWidth <= 0) return null;
      return { columnGap, columnWidth, columns, rowGap, spanUnit };
    };

    const columnSpan = (photo, metrics) => (isPanorama(photo) && metrics.columns > 1 ? metrics.columns : 1);

    const previewSpan = (photo, metrics, captionHeight = 0, spanColumns = 1) => {
      const dimensions = dimensionsFor(photo);
      const aspectRatio = dimensions?.width && dimensions?.height ? dimensions.width / dimensions.height : 1;
      const cardWidth = (metrics.columnWidth * spanColumns) + (metrics.columnGap * Math.max(0, spanColumns - 1));
      const imageHeight = cardWidth / Math.max(.2, aspectRatio);
      const cardHeight = imageHeight + 2 + captionHeight + 2;
      return Math.max(1, Math.ceil((cardHeight + metrics.rowGap) / metrics.spanUnit));
    };

    const applyDensityControls = ({ input = null, value = null } = {}) => {
      if (!root) return;
      const columns = preferredDensityColumns();
      root.style.setProperty("--gallery-zoom-columns", String(columns));
      if (input) {
        input.max = String(maxDensityColumns());
        input.value = String(columns);
      }
      if (value) value.textContent = `${columns}`;
    };

    const syncDensityUrl = (columns) => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("grid");
        url.searchParams.set("columns", String(columns));
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      } catch {
        // URL syncing is optional for static/file previews.
      }
    };

    const setDensityColumns = (columns) => {
      densityOverride = null;
      const nextColumns = clampDensityColumns(columns);
      localStorage.setItem(densityKey, String(nextColumns));
      syncDensityUrl(nextColumns);
      return nextColumns;
    };

    const applyFitMode = (buttons = []) => {
      if (!root) return;
      root.dataset.imageFit = fitMode;
      buttons.forEach((button) => {
        const buttonMode = button.dataset.galleryFitMode || button.dataset.hiddenFitMode || "";
        button.setAttribute("aria-pressed", buttonMode === fitMode ? "true" : "false");
      });
    };

    const setFitMode = (mode) => {
      fitMode = normalizeFitMode(mode, "fit");
      localStorage.setItem(fitModeKey, fitMode);
      return fitMode;
    };

    const syncFromStorage = () => {
      if (ignoreSavedLayout) return;
      fitMode = normalizeFitMode(localStorage.getItem(fitModeKey), defaultMode);
    };

    const applyPreviewLayout = (photos = getPhotos()) => {
      if (!root) return;
      cancelPreviewLayout();
      applyDensityControls();
      applyFitMode();
      const cards = root.querySelectorAll("[data-photo-index]");
      if (fitMode !== "fit") {
        cards.forEach((card) => {
          card.style.removeProperty("--gallery-column-span");
          card.style.removeProperty("--gallery-masonry-span");
        });
        return;
      }
      const metrics = previewLayoutMetrics();
      if (!metrics) {
        pendingLayout = window.requestAnimationFrame(() => {
          pendingLayout = 0;
          applyPreviewLayout(photos);
        });
        return;
      }
      cards.forEach((card, index) => {
        const photo = photos[index];
        const spanColumns = columnSpan(photo, metrics);
        const captionHeight = card.querySelector("[data-photo-caption]")?.getBoundingClientRect().height || 0;
        card.style.setProperty("--gallery-column-span", String(spanColumns));
        card.style.setProperty("--gallery-masonry-span", String(previewSpan(photo, metrics, captionHeight, spanColumns)));
      });
    };

    return {
      applyDensityControls,
      applyFitMode,
      applyPreviewLayout,
      clampDensityColumns,
      fitMode: () => fitMode,
      maxDensityColumns,
      preferredDensityColumns,
      setDensityColumns,
      setFitMode,
      syncFromStorage,
      toggleFitMode: () => setFitMode(fitMode === "fill" ? "fit" : "fill"),
    };
  };

  window.photosByElieGalleryLayout = { createMasonryController };
})();
