(() => {
  const root = document.querySelector("[data-home-discovery]");
  if (!root) return;

  const form = root.querySelector("[data-home-discovery-form]");
  const status = root.querySelector("[data-home-discovery-status]");
  const resultsRoot = root.querySelector("[data-home-discovery-results]");
  const moreButton = root.querySelector("[data-home-discovery-more]");
  const searchInput = root.querySelector("[data-home-search]");
  const filterControls = [...root.querySelectorAll("[data-home-filter]")];
  const collectionSelect = root.querySelector('[data-home-filter="collection"]');
  const detailSequenceKey = "photosbyelie-detail-sequence";
  const pageSize = 24;
  const defaultState = {
    query: "",
    collection: "all",
    origin: "all",
    orientation: "all",
    mood: "all",
    subject: "all",
    sort: "newest",
  };
  let filterState = { ...defaultState };
  let catalogItems = [];
  let visibleLimit = pageSize;
  let latestMatches = [];

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
  const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
  const metadataValue = (photo, label) => window.photosByElieMetadataValue?.(photo, label) || "";
  const collectionTitleForKey = (key, collection) => {
    const translated = t(`collection.${key}`);
    return translated && translated !== `collection.${key}` ? translated : collection?.title || key;
  };
  const photoSearchText = (item) => {
    const photo = item.photo;
    return [
      photo?.title,
      photo?.caption,
      metadataValue(photo, "Keywords"),
      metadataValue(photo, "Description"),
      metadataValue(photo, "Original file"),
      metadataValue(photo, "Original size"),
      metadataValue(photo, "Preview file"),
      item.collectionTitle,
    ].filter(Boolean).join(" ").toLowerCase();
  };
  const searchTerms = () => String(filterState.query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const previewDimensions = (photo) => window.photosByEliePreviewDimensions?.(photo) || null;
  const photoOrientation = (photo) => {
    const dimensions = previewDimensions(photo);
    if (!dimensions?.width || !dimensions?.height) return "unknown";
    const ratio = dimensions.width / dimensions.height;
    if (ratio > 1.12) return "landscape";
    if (ratio < .9) return "portrait";
    return "square";
  };
  const photoOrigin = (photo, collectionKey) => window.photosByEliePhotoOrigin?.(photo, collectionKey) || (collectionKey === "ai" ? "ai" : "camera");
  const photoOriginLabel = (photo, collectionKey) => (
    t(photoOrigin(photo, collectionKey) === "ai" ? "origin.ai" : "origin.camera")
  );
  const photoOriginShortLabel = (photo, collectionKey) => (
    window.photosByEliePhotoOriginShortLabel?.(photo, collectionKey)
    || (photoOrigin(photo, collectionKey) === "ai" ? "AI" : "Camera")
  );
  const photoMoodTags = (item) => {
    const text = photoSearchText(item);
    const tags = new Set();
    if (/(sunset|sunrise|gold|yellow|orange|red|beach|desert|summer|warm)/.test(text)) tags.add("warm");
    if (/(ocean|sea|river|water|blue|snow|winter|harbor|harbour|atlantic|seine|cool)/.test(text)) tags.add("cool");
    if (/(gray|grey|unsaturated|black|white|interior|church|museum|palace|castle|architecture)/.test(text)) tags.add("neutral");
    if (/(art|garden|flower|green|color|colour|vivid|market|festival)/.test(text)) tags.add("vivid");
    return tags.size ? tags : new Set(["neutral"]);
  };
  const photoSubjectTags = (item) => {
    const text = photoSearchText(item);
    const tags = new Set();
    if (/(architecture|church|castle|chateau|fortress|palace|monastery|building|interior|invalides|versailles)/.test(text)) tags.add("architecture");
    if (/(ocean|sea|river|water|beach|harbor|harbour|coast|atlantic|seine|boat|bateau)/.test(text)) tags.add("water");
    if (/(art|museum|statue|monet|painting|gallery|sculpture)/.test(text)) tags.add("art");
    if (/(family|person|people|child|mom|bar mitzvah|portrait)/.test(text)) tags.add("people");
    if (/(garden|park|flower|tree|mountain|animal|nature|landscape)/.test(text)) tags.add("nature");
    if (/(city|street|travel|paris|lisbon|lisboa|mexico|slovakia|france|usa|portugal|spain)/.test(text)) tags.add("city");
    return tags.size ? tags : new Set(["other"]);
  };
  const captureTime = (photo) => {
    const raw = metadataValue(photo, "Captured");
    const match = String(raw).match(/^(\d{4}):(\d{2}):(\d{2})\s+(.+)$/);
    if (!match) return 0;
    return Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}`) || 0;
  };
  const verifiedMegapixels = (photo) => (
    window.photosByElieVerifiedMegapixels ? window.photosByElieVerifiedMegapixels(photo) : Number(photo?.megapixels) || 0
  );
  const maxAvailablePrice = (photo) => {
    const available = window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, window.photosByElieResolutions || [])
      : [];
    return Math.max(0, ...available.map((option) => option.price || 0));
  };
  const hasActiveFilters = () => (
    searchTerms().length > 0
    || ["collection", "origin", "orientation", "mood", "subject"].some((key) => filterState[key] && filterState[key] !== "all")
  );
  const matchesFilterState = (item) => {
    const terms = searchTerms();
    if (terms.length && !terms.every((term) => photoSearchText(item).includes(term))) return false;
    if (filterState.collection !== "all" && item.collectionKey !== filterState.collection) return false;
    if (filterState.origin !== "all" && photoOrigin(item.photo, item.collectionKey) !== filterState.origin) return false;
    if (filterState.orientation !== "all" && photoOrientation(item.photo) !== filterState.orientation) return false;
    if (filterState.mood !== "all" && !photoMoodTags(item).has(filterState.mood)) return false;
    if (filterState.subject !== "all" && !photoSubjectTags(item).has(filterState.subject)) return false;
    return true;
  };
  const sortItems = (items) => {
    const sorted = [...items];
    if (filterState.sort === "newest") sorted.sort((a, b) => captureTime(b.photo) - captureTime(a.photo));
    if (filterState.sort === "oldest") sorted.sort((a, b) => captureTime(a.photo) - captureTime(b.photo));
    if (filterState.sort === "title") sorted.sort((a, b) => String(a.photo.title || "").localeCompare(String(b.photo.title || "")));
    if (filterState.sort === "megapixels-desc") sorted.sort((a, b) => verifiedMegapixels(b.photo) - verifiedMegapixels(a.photo));
    if (filterState.sort === "megapixels-asc") sorted.sort((a, b) => verifiedMegapixels(a.photo) - verifiedMegapixels(b.photo));
    if (filterState.sort === "price-desc") sorted.sort((a, b) => maxAvailablePrice(b.photo) - maxAvailablePrice(a.photo));
    if (filterState.sort === "price-asc") sorted.sort((a, b) => maxAvailablePrice(a.photo) - maxAvailablePrice(b.photo));
    return sorted;
  };
  const visiblePhotosFor = (photos = []) => {
    const publicPhotos = window.photosByElieFilterPublicHidden?.(photos) || photos;
    return window.photosByElieHiddenActions?.filterPhotos
      ? window.photosByElieHiddenActions.filterPhotos(publicPhotos)
      : publicPhotos;
  };
  const flattenCatalog = (collections = {}) => Object.entries(collections)
    .flatMap(([collectionKey, collection]) => {
      const collectionTitle = collectionTitleForKey(collectionKey, collection);
      return visiblePhotosFor(collection?.photos || []).map((photo, index) => ({
        collection,
        collectionKey,
        collectionTitle,
        originalIndex: index,
        photo,
      }));
    });
  const populateCollectionOptions = (collections = {}) => {
    if (!collectionSelect) return;
    const selected = collectionSelect.value || "all";
    collectionSelect.innerHTML = `<option value="all" data-i18n="gallery.all">${escapeHtml(t("gallery.all"))}</option>`;
    Object.entries(collections).forEach(([key, collection]) => {
      const option = document.createElement("option");
      option.value = key;
      option.dataset.i18n = `collection.${key}`;
      option.textContent = collectionTitleForKey(key, collection);
      collectionSelect.append(option);
    });
    collectionSelect.value = [...collectionSelect.options].some((option) => option.value === selected) ? selected : "all";
  };
  const writeDetailSequenceContext = (items) => {
    try {
      sessionStorage.setItem(detailSequenceKey, JSON.stringify({
        source: "home",
        photoIds: items.map((item) => item.photo.id),
        createdAt: Date.now(),
      }));
    } catch {}
  };
  const syncControls = () => {
    if (searchInput) searchInput.value = filterState.query || "";
    filterControls.forEach((control) => {
      control.value = filterState[control.dataset.homeFilter] || "all";
    });
  };
  const setStatus = (key, replacements = {}) => {
    if (!status) return;
    status.removeAttribute("data-i18n");
    status.textContent = t(key, replacements);
  };
  const renderResults = () => {
    latestMatches = sortItems(catalogItems.filter(matchesFilterState));
    if (!hasActiveFilters()) {
      resultsRoot.hidden = true;
      moreButton.hidden = true;
      writeDetailSequenceContext([]);
      setStatus("home.catalog_ready", { count: catalogItems.length });
      return;
    }
    resultsRoot.hidden = false;
    const visibleItems = latestMatches.slice(0, visibleLimit);
    writeDetailSequenceContext(latestMatches.slice(0, Math.max(visibleLimit, pageSize * 3)));
    if (!visibleItems.length) {
      resultsRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="${escapeHtml(t("home.results"))}">
          <span>${escapeHtml(t("home.no_matches"))}</span>
        </article>
      `;
      moreButton.hidden = true;
      setStatus("home.no_matches");
      return;
    }
    resultsRoot.innerHTML = visibleItems.map((item) => {
      const photo = item.photo;
      const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
      const origin = photoOrigin(photo, item.collectionKey);
      const originLabel = photoOriginLabel(photo, item.collectionKey);
      const originShortLabel = photoOriginShortLabel(photo, item.collectionKey);
      const title = escapeHtml(photo.title);
      const href = escapeHtml(versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`));
      return `
        <article class="mock-photo-card home-result-card" aria-label="Open ${title}, ${escapeHtml(item.collectionTitle)}, ${escapeHtml(originLabel)}">
          <a class="mock-photo ${photo.className || ""} ${image ? "has-image" : ""}" href="${href}" data-home-result-link ${window.photosByEliePhotoAspectStyle?.(photo) || ""}>
            ${image ? `<img src="${escapeHtml(image)}" alt="${title}" loading="lazy"/>` : ""}
            <span class="photo-origin-badge is-${escapeHtml(origin)}" title="${escapeHtml(originLabel)}">${escapeHtml(originShortLabel)}</span>
          </a>
          <a class="mock-photo-caption" href="${href}" data-home-result-link>${title}</a>
          <p class="home-result-meta">${escapeHtml(item.collectionTitle)} / ${escapeHtml(originShortLabel)}</p>
        </article>
      `;
    }).join("");
    root.querySelectorAll("[data-home-result-link]").forEach((link) => {
      link.addEventListener("click", () => writeDetailSequenceContext(latestMatches));
    });
    window.photosByElieVersionInternalLinks?.(resultsRoot);
    moreButton.hidden = latestMatches.length <= visibleLimit;
    setStatus(hasActiveFilters() ? "home.showing_matches" : "home.showing_results", {
      count: visibleItems.length,
      total: latestMatches.length,
    });
  };
  const updateFilterState = () => {
    filterState = {
      ...filterState,
      query: searchInput?.value || "",
    };
    filterControls.forEach((control) => {
      filterState[control.dataset.homeFilter] = control.value || "all";
    });
    visibleLimit = pageSize;
    renderResults();
  };
  const setControlsDisabled = (disabled) => {
    if (searchInput) searchInput.disabled = disabled;
    filterControls.forEach((control) => { control.disabled = disabled; });
    const clearButton = root.querySelector("[data-home-clear-filters]");
    if (clearButton) clearButton.disabled = disabled;
  };

  setControlsDisabled(true);
  form?.addEventListener("submit", (event) => event.preventDefault());
  form?.addEventListener("input", updateFilterState);
  form?.addEventListener("change", updateFilterState);
  root.querySelector("[data-home-clear-filters]")?.addEventListener("click", () => {
    filterState = { ...defaultState };
    visibleLimit = pageSize;
    syncControls();
    renderResults();
  });
  moreButton?.addEventListener("click", () => {
    visibleLimit += pageSize;
    renderResults();
  });
  window.addEventListener("photosbyelie:languagechange", () => {
    populateCollectionOptions(window.photosByElieData || window.photosByElieHomeData || {});
    renderResults();
    window.photosByElieI18n?.apply?.();
  });
  window.addEventListener("photosbyelie:hiddenblacklistchange", async () => {
    const data = await (window.photosByElieFullCatalogReady || Promise.resolve(window.photosByElieData || {}));
    catalogItems = flattenCatalog(data || {});
    renderResults();
  });
  window.addEventListener("photosbyelie:hiddenchange", async () => {
    const data = await (window.photosByElieFullCatalogReady || Promise.resolve(window.photosByElieData || {}));
    catalogItems = flattenCatalog(data || {});
    renderResults();
  });

  (async () => {
    setStatus("home.loading_catalog");
    const data = await (window.photosByElieFullCatalogReady || Promise.resolve(window.photosByElieData || window.photosByElieHomeData || {}));
    await Promise.allSettled([
      window.photosByElieHiddenBlacklistReady,
      window.photosByElieHiddenActionsReady,
    ]);
    window.photosByElieProductSettings?.applyPriceOverrides?.();
    populateCollectionOptions(data || {});
    catalogItems = flattenCatalog(data || {});
    setControlsDisabled(false);
    syncControls();
    renderResults();
    window.photosByElieI18n?.apply?.();
  })();
})();
