(() => {
  const root = document.querySelector("[data-home-discovery]");
  if (!root) return;

  const form = root.querySelector("[data-home-discovery-form]");
  const status = root.querySelector("[data-home-discovery-status]");
  const resultsRoot = root.querySelector("[data-home-discovery-results]");
  const moreButton = root.querySelector("[data-home-discovery-more]");
  const showAllButton = root.querySelector("[data-home-discovery-show-all]");
  const searchInput = root.querySelector("[data-home-search]");
  const filterControls = [...root.querySelectorAll("[data-home-filter]")];
  const collectionSelect = root.querySelector('[data-home-filter="collection"]');
  const detailSequenceKey = "photosbyelie-detail-sequence";
  const pageSize = 24;
  const photoFilter = window.photosByEliePhotoFilter;
  const defaultState = photoFilter.defaultState();
  let filterState = { ...defaultState };
  let catalogItems = [];
  let visibleLimit = pageSize;
  let latestMatches = [];
  let selectedIndex = 0;
  let showAllRenderToken = 0;

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
  const hiddenActions = () => window.photosByElieHiddenActions;
  const likedStore = () => window.photosByElieLiked;
  const localModerationEnabled = () => Boolean(hiddenActions()?.enabled);
  const likedPhotoIds = () => new Set(likedStore()?.read?.().map((item) => item.photoId) || []);
  const shortcutKey = (label) => `<kbd>${label}</kbd>`;
  const splitKeywordText = (value) => String(value || "")
    .split(/[;,]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const uniqueKeywords = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const setMetadataValue = (photo, label, value) => {
    if (!Array.isArray(photo.metadata)) photo.metadata = [];
    const item = photo.metadata.find((entry) => entry.label === label);
    if (item) {
      item.value = value;
      return;
    }
    photo.metadata.unshift({ label, value });
  };
  const shouldShowKeyboardHints = () => window.photosByElieInputMode?.shouldShowKeyboardHints?.() ?? true;
  const ensureHomeKeyboardHint = () => {
    if (!localModerationEnabled() || root.querySelector("[data-home-discovery-shortcut-hint]")) return;
    const hint = document.createElement("p");
    hint.className = "keyboard-hint home-discovery-keyboard-hint";
    hint.dataset.homeDiscoveryShortcutHint = "";
    hint.innerHTML = [
      "Owner shortcuts:",
      `${shortcutKey("X")} block`,
      `${shortcutKey("D")} discard`,
      `${shortcutKey("L")} like`,
      `${shortcutKey("U")} undo`,
      `${shortcutKey("T")} title`,
      `${shortcutKey("K")} keywords`,
      `${shortcutKey("R")} review`,
      `${shortcutKey("Arrows")} select`,
      `${shortcutKey("Enter")} detail`,
      `${shortcutKey("Double-click")} detail`,
    ].join(" <span aria-hidden=\"true\">|</span> ");
    hint.hidden = !shouldShowKeyboardHints();
    form?.after(hint);
  };
  window.addEventListener("photosbyelie:inputmodechange", () => {
    const hint = root.querySelector("[data-home-discovery-shortcut-hint]");
    if (hint) hint.hidden = !localModerationEnabled() || !shouldShowKeyboardHints();
  });
  const collectionTitleForKey = (key, collection) => {
    const translated = t(`collection.${key}`);
    return translated && translated !== `collection.${key}` ? translated : collection?.title || key;
  };
  const photoOrigin = (photo, collectionKey) => photoFilter.photoOrigin(photo, collectionKey);
  const photoOriginLabel = (photo, collectionKey) => (
    t(photoOrigin(photo, collectionKey) === "ai" ? "origin.ai" : "origin.camera")
  );
  const photoOriginShortLabel = (photo, collectionKey) => (
    window.photosByEliePhotoOriginShortLabel?.(photo, collectionKey)
    || (photoOrigin(photo, collectionKey) === "ai" ? "AI" : "Camera")
  );
  const homeFilterKeys = ["query", "collection", "origin", "orientation", "mediaType", "minSize", "mood", "subject", "dateFrom", "dateTo"];
  const filterContextFor = (item) => ({
    collectionKey: item.collectionKey,
    collectionTitle: item.collectionTitle,
  });
  const hasActiveFilters = () => photoFilter.activeFilterCount(filterState, homeFilterKeys) > 0;
  const matchesFilterState = (item) => photoFilter.matchesPhoto(item.photo, filterState, filterContextFor(item));
  const sortItems = (items) => photoFilter.sortItems(items, filterState, { photoFor: (item) => item.photo });
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
      const key = control.dataset.homeFilter;
      const fallback = control instanceof HTMLSelectElement ? "all" : "";
      control.value = filterState[key] || fallback;
    });
    photoFilter.syncAdaptiveControls({
      root,
      state: filterState,
      filterSelector: "data-home-filter",
      translate: t,
    });
  };
  const setStatus = (key, replacements = {}) => {
    if (!status) return;
    status.removeAttribute("data-i18n");
    status.textContent = t(key, replacements);
  };
  const visibleResultItems = () => latestMatches.slice(0, visibleLimit);
  const selectedItem = () => visibleResultItems()[selectedIndex] || null;
  const updateSelection = ({ scroll = true } = {}) => {
    const cards = [...resultsRoot.querySelectorAll("[data-home-result-index]")];
    if (!cards.length) return;
    selectedIndex = Math.max(0, Math.min(selectedIndex, cards.length - 1));
    cards.forEach((card, index) => {
      const isSelected = index === selectedIndex;
      card.classList.toggle("is-selected", isSelected);
    });
    if (scroll) cards[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const visibleColumnCount = () => {
    const cards = [...resultsRoot.querySelectorAll("[data-home-result-index]")];
    if (!cards.length) return 1;
    const firstTop = cards[0].offsetTop;
    const columns = cards.findIndex((card, index) => index > 0 && card.offsetTop !== firstTop);
    return columns > 0 ? columns : cards.length;
  };
  const updateLikeButtons = () => {
    const likedIds = likedPhotoIds();
    resultsRoot.querySelectorAll("[data-home-like]").forEach((button) => {
      const isLiked = likedIds.has(button.dataset.photoId);
      button.classList.toggle("is-liked", isLiked);
      button.setAttribute("aria-pressed", String(isLiked));
      button.setAttribute("aria-label", t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo"));
      button.innerHTML = window.photosByElieMdIcon?.(isLiked ? "favorite" : "favoriteBorder") || "<span aria-hidden=\"true\"></span>";
    });
  };
  const toggleLike = (item) => {
    const store = likedStore();
    if (!item?.photo?.id || !store) return null;
    const isLiked = store.has?.(item.photo.id);
    if (isLiked) {
      store.remove(item.photo.id);
      updateLikeButtons();
      return false;
    }
    store.add(item.photo.id);
    updateLikeButtons();
    return true;
  };
  const navigateToItem = (item = selectedItem()) => {
    if (!item?.photo?.id) return;
    writeDetailSequenceContext(latestMatches);
    window.location.assign(versionedHref(`./photo.html?id=${encodeURIComponent(item.photo.id)}`));
  };
  const openOwnerMetadataModal = (item, field) => {
    const actions = hiddenActions();
    if (!localModerationEnabled() || !item?.photo) return;
    const photo = item.photo;
    const isKeywords = field === "keywords";
    const dialog = document.createElement("dialog");
    dialog.className = "owner-metadata-modal";
    const title = isKeywords ? "Edit keywords" : "Edit title";
    const currentKeywords = metadataValue(photo, "Keywords");
    const value = isKeywords ? currentKeywords : (photo.title || "");
    const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    dialog.innerHTML = `
      <form class="owner-metadata-modal-form" method="dialog">
        <h2>${escapeHtml(title)}</h2>
        ${image ? `
          <figure class="owner-metadata-modal-preview">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(photo.title || title)}"/>
          </figure>
        ` : ""}
        <label>
          <span>${isKeywords ? "Keywords" : "Title"}</span>
          ${isKeywords
            ? `<textarea rows="4" data-owner-modal-field>${escapeHtml(value)}</textarea>`
            : `<input type="text" value="${escapeHtml(value)}" data-owner-modal-field/>`
          }
        </label>
        <div class="owner-metadata-modal-actions">
          <button class="btn secondary" type="button" data-owner-modal-cancel>Cancel</button>
          <button class="btn" type="submit">Save</button>
        </div>
      </form>
    `;
    const modalForm = dialog.querySelector("form");
    const input = dialog.querySelector("[data-owner-modal-field]");
    const saveButton = dialog.querySelector("button[type='submit']");
    const closeWithoutSaving = () => {
      if (dialog.open) dialog.close("cancel");
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeWithoutSaving();
    });
    dialog.querySelector("[data-owner-modal-cancel]")?.addEventListener("click", closeWithoutSaving);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWithoutSaving();
        return;
      }
      if (!["Enter", "Return"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (!saveButton.disabled) modalForm.requestSubmit();
    });
    modalForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saveButton.disabled) return;
      saveButton.disabled = true;
      const nextTitle = isKeywords ? (photo.title || "") : String(input.value || "").trim();
      const nextKeywords = isKeywords
        ? uniqueKeywords(splitKeywordText(input.value)).join(", ")
        : currentKeywords;
      if (!nextTitle) {
        saveButton.disabled = false;
        setStatus("home.title_required");
        input.focus();
        return;
      }
      const previousTitle = photo.title || "";
      const previousKeywords = currentKeywords;
      dialog.close("save");
      photo.title = nextTitle;
      setMetadataValue(photo, "Metadata title", nextTitle);
      setMetadataValue(photo, "Keywords", nextKeywords);
      const currentId = photo.id;
      renderResults({ preserveSelectedId: currentId });
      setStatus("home.saving_metadata");
      try {
        await actions.updatePhotoMetadata?.(photo.id, { title: nextTitle, keywords: nextKeywords });
        setStatus("home.metadata_saved", { title: photo.title });
      } catch (error) {
        photo.title = previousTitle;
        setMetadataValue(photo, "Metadata title", previousTitle);
        setMetadataValue(photo, "Keywords", previousKeywords);
        renderResults({ preserveSelectedId: currentId });
        setStatus(error?.message || "home.metadata_failed");
      }
    });
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    input?.focus();
    input?.select?.();
  };
  const renderResults = (options = {}) => {
    const previousSelectedId = options.preserveSelectedId || selectedItem()?.photo?.id || "";
    latestMatches = sortItems(catalogItems.filter(matchesFilterState));
    if (!hasActiveFilters()) {
      resultsRoot.hidden = true;
      moreButton.hidden = true;
      if (showAllButton) showAllButton.hidden = true;
      writeDetailSequenceContext([]);
      setStatus("home.catalog_ready", { count: catalogItems.length });
      return;
    }
    resultsRoot.hidden = false;
    const visibleItems = latestMatches.slice(0, visibleLimit);
    const nextSelectedIndex = previousSelectedId
      ? visibleItems.findIndex((item) => item.photo.id === previousSelectedId)
      : -1;
    selectedIndex = nextSelectedIndex >= 0
      ? nextSelectedIndex
      : Math.max(0, Math.min(selectedIndex, visibleItems.length - 1));
    writeDetailSequenceContext(latestMatches);
    if (!visibleItems.length) {
      resultsRoot.innerHTML = `
        <article class="mock-photo empty-gallery-card" aria-label="${escapeHtml(t("home.results"))}">
          <span>${escapeHtml(t("home.no_matches"))}</span>
        </article>
      `;
      moreButton.hidden = true;
      if (showAllButton) showAllButton.hidden = true;
      setStatus("home.no_matches");
      return;
    }
    const likedIds = likedPhotoIds();
    resultsRoot.innerHTML = visibleItems.map((item, index) => {
      const photo = item.photo;
      const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
      const isVideo = window.photosByElieIsVideo?.(photo) === true;
      const origin = photoOrigin(photo, item.collectionKey);
      const originLabel = isVideo ? "Video" : photoOriginLabel(photo, item.collectionKey);
      const originShortLabel = isVideo ? "Video" : photoOriginShortLabel(photo, item.collectionKey);
      const badgeOrigin = isVideo ? "video" : origin;
      const title = escapeHtml(photo.title);
      const href = escapeHtml(versionedHref(`./photo.html?id=${encodeURIComponent(photo.id)}`));
      const isLiked = likedIds.has(photo.id);
      return `
        <article
          class="mock-photo-card home-result-card"
          aria-label="Open ${title}, ${escapeHtml(item.collectionTitle)}, ${escapeHtml(originLabel)}"
          data-home-result-index="${index}"
          data-photo-id="${escapeHtml(photo.id)}"
          data-photo-href="${href}"
        >
          <a class="mock-photo ${photo.className || ""} ${image ? "has-image" : ""} ${isVideo ? "is-video" : ""}" href="${href}" data-home-result-link ${window.photosByEliePhotoAspectStyle?.(photo) || ""}>
            ${image ? `<img src="${escapeHtml(image)}" alt="${title}" loading="lazy" data-photo-card-image/>` : ""}
            ${isVideo ? `<span class="video-card-badge" aria-hidden="true">${window.photosByElieMdIcon?.("play") || "▶"}</span>` : ""}
            ${window.photosByElieGalleryCard?.originBadgeHtml?.(origin, originLabel, isVideo) || `<span class="photo-origin-badge is-${escapeHtml(badgeOrigin)}" title="${escapeHtml(originLabel)}">${escapeHtml(originShortLabel)}</span>`}
          </a>
          ${likedStore() ? `
            <div class="gallery-card-actions">
              <button
                class="gallery-action-toggle gallery-like-toggle${isLiked ? " is-liked" : ""}"
                type="button"
                data-home-like
                data-photo-id="${escapeHtml(photo.id)}"
                aria-label="${escapeHtml(t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo"))}"
                aria-pressed="${isLiked ? "true" : "false"}"
              >
                ${window.photosByElieMdIcon?.(isLiked ? "favorite" : "favoriteBorder") || "<span aria-hidden=\"true\"></span>"}
              </button>
            </div>
          ` : ""}
          <a class="mock-photo-caption" href="${href}" data-home-result-link>${title}</a>
          <p class="home-result-meta">${escapeHtml(item.collectionTitle)} / ${escapeHtml(originShortLabel)}</p>
        </article>
      `;
    }).join("");
    resultsRoot.querySelectorAll("[data-home-like]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = button.closest("[data-home-result-index]");
        const item = visibleItems[Number(card?.dataset.homeResultIndex || 0)];
        const liked = toggleLike(item);
        if (item && liked !== null) {
          setStatus(liked ? "detail.added_liked" : "detail.removed_liked", { title: item.photo.title });
        }
      });
    });
    root.querySelectorAll("[data-home-result-link]").forEach((link) => {
      link.addEventListener("click", (event) => {
        const card = link.closest("[data-home-result-index]");
        selectedIndex = Number(card?.dataset.homeResultIndex || 0);
        updateSelection({ scroll: false });
        if (localModerationEnabled()) {
          event.preventDefault();
          return;
        }
        writeDetailSequenceContext(latestMatches);
      });
    });
    resultsRoot.querySelectorAll("[data-home-result-index]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-home-like]")) return;
        if (!localModerationEnabled()) return;
        event.preventDefault();
        selectedIndex = Number(card.dataset.homeResultIndex || 0);
        updateSelection();
      });
      card.addEventListener("dblclick", (event) => {
        if (event.target.closest("[data-home-like]")) return;
        event.preventDefault();
        selectedIndex = Number(card.dataset.homeResultIndex || 0);
        navigateToItem();
      });
    });
    window.photosByElieVersionInternalLinks?.(resultsRoot);
    updateSelection({ scroll: false });
    const hasMore = latestMatches.length > visibleLimit;
    moreButton.hidden = !hasMore;
    if (showAllButton) {
      showAllButton.hidden = !hasMore;
      showAllButton.textContent = t("home.show_all");
    }
    setStatus("gallery.showing_filtered_items", {
      count: visibleItems.length,
      total: latestMatches.length,
      items: photoFilter.statusNoun(filterState, t),
    });
  };
  const updateFilterState = (options = {}) => {
    filterState = {
      ...filterState,
      query: searchInput?.value || "",
    };
    filterControls.forEach((control) => {
      const key = control.dataset.homeFilter;
      filterState[key] = control instanceof HTMLInputElement && control.type === "date"
        ? photoFilter.dateFilterValue(control.value)
        : control.value || "all";
    });
    syncControls();
    visibleLimit = pageSize;
    selectedIndex = 0;
    renderResults();
    if (options.focusResults && hasActiveFilters() && !resultsRoot.hidden) {
      resultsRoot.focus({ preventScroll: true });
    }
  };
  const setControlsDisabled = (disabled) => {
    if (searchInput) searchInput.disabled = disabled;
    filterControls.forEach((control) => { control.disabled = disabled; });
    const clearButton = root.querySelector("[data-home-clear-filters]");
    if (clearButton) clearButton.disabled = disabled;
  };
  const isTypingTarget = (target) => (
    target instanceof HTMLElement
    && (
      target.isContentEditable
      || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
    )
  );
  const stepSelection = (nextIndex) => {
    const currentVisibleCount = visibleResultItems().length;
    if (!currentVisibleCount) return;
    if (nextIndex >= currentVisibleCount && visibleLimit < latestMatches.length) {
      visibleLimit = Math.min(latestMatches.length, visibleLimit + pageSize);
      selectedIndex = Math.min(nextIndex, visibleLimit - 1);
      renderResults();
      return;
    }
    selectedIndex = Math.max(0, Math.min(nextIndex, currentVisibleCount - 1));
    updateSelection();
  };
  const handleHomeKeydown = async (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (resultsRoot.hidden || !visibleResultItems().length) return;
    const selected = selectedItem();
    if (event.key === "ArrowRight") {
      stepSelection(selectedIndex + 1);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft") {
      stepSelection(selectedIndex - 1);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      stepSelection(selectedIndex + visibleColumnCount());
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp") {
      stepSelection(selectedIndex - visibleColumnCount());
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      navigateToItem(selected);
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "l") {
      const liked = toggleLike(selected);
      if (selected && liked !== null) {
        setStatus(liked ? "detail.added_liked" : "detail.removed_liked", { title: selected.photo.title });
        event.preventDefault();
      }
      return;
    }
    if (!localModerationEnabled()) return;
    const actions = hiddenActions();
    if (event.key.toLowerCase() === "t" || event.key.toLowerCase() === "k") {
      openOwnerMetadataModal(selected, event.key.toLowerCase() === "k" ? "keywords" : "title");
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "r") {
      if (!selected?.photo) return;
      try {
        if (!actions.queueTitleKeywordReview) {
          throw new Error("Refresh Owner mode to load title/keyword review queueing.");
        }
        const result = await actions.queueTitleKeywordReview(selected.photo.id);
        setStatus(result?.already_pending
          ? `${selected.photo.title} is already in title/keyword review.`
          : `${selected.photo.title} sent to title/keyword review.`);
      } catch (error) {
        setStatus(error?.message || "Could not send photo to title/keyword review.");
      }
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "x" || event.key.toLowerCase() === "b" || event.key.toLowerCase() === "h") {
      if (!selected?.photo) return;
      try {
        await actions.mark(selected.photo.id);
        selectedIndex = Math.min(selectedIndex, Math.max(0, visibleResultItems().length - 2));
        setStatus("home.moved_blocked", { title: selected.photo.title });
      } catch (error) {
        setStatus(error?.message || "home.block_failed");
      }
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "d") {
      if (!selected?.photo) return;
      const confirmed = window.confirm(`Discard "${selected.photo.title}"?\n\nThis removes it from the catalog and keeps a tombstone so imports do not bring it back.`);
      if (!confirmed) {
        event.preventDefault();
        return;
      }
      try {
        await actions.discard?.(selected.photo.id);
        selectedIndex = Math.min(selectedIndex, Math.max(0, visibleResultItems().length - 2));
        setStatus("home.discarded", { title: selected.photo.title });
      } catch (error) {
        setStatus(error?.message || "home.discard_failed");
      }
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() !== "u") return;
    let undoneId = null;
    try {
      undoneId = await actions.undo();
    } catch (error) {
      setStatus(error?.message || "home.undo_failed");
      event.preventDefault();
      return;
    }
    if (!undoneId) {
      setStatus("home.nothing_to_undo");
      event.preventDefault();
      return;
    }
    const restoredIndex = latestMatches.findIndex((item) => item.photo.id === undoneId);
    if (restoredIndex >= 0) {
      visibleLimit = Math.max(visibleLimit, Math.ceil((restoredIndex + 1) / pageSize) * pageSize);
      selectedIndex = restoredIndex;
    }
    renderResults({ preserveSelectedId: undoneId });
    setStatus("home.undo_done");
    event.preventDefault();
  };

  setControlsDisabled(true);
  resultsRoot.setAttribute("tabindex", "-1");
  form?.addEventListener("submit", (event) => event.preventDefault());
  form?.addEventListener("input", () => updateFilterState());
  form?.addEventListener("change", (event) => updateFilterState({
    focusResults: event.target instanceof HTMLSelectElement,
  }));
  window.addEventListener("keydown", handleHomeKeydown);
  window.addEventListener("photosbyelie:likedchange", updateLikeButtons);
  window.addEventListener("photosbyelie:owneractionerror", (event) => {
    setStatus(event.detail?.message || "home.owner_action_failed");
  });
  root.querySelector("[data-home-clear-filters]")?.addEventListener("click", () => {
    filterState = { ...defaultState };
    visibleLimit = pageSize;
    selectedIndex = 0;
    syncControls();
    renderResults();
  });
  moreButton?.addEventListener("click", () => {
    showAllRenderToken += 1;
    visibleLimit += pageSize;
    renderResults();
  });
  showAllButton?.addEventListener("click", () => {
    const token = showAllRenderToken + 1;
    showAllRenderToken = token;
    const addNextChunk = () => {
      if (token !== showAllRenderToken) return;
      if (visibleLimit >= latestMatches.length) {
        if (showAllButton) showAllButton.disabled = false;
        return;
      }
      visibleLimit = Math.min(latestMatches.length, visibleLimit + pageSize);
      renderResults();
      if (showAllButton) {
        showAllButton.disabled = visibleLimit < latestMatches.length;
        showAllButton.textContent = visibleLimit < latestMatches.length ? `Showing ${visibleLimit}/${latestMatches.length}` : t("home.show_all");
      }
      if (visibleLimit < latestMatches.length) window.setTimeout(addNextChunk, 0);
    };
    addNextChunk();
  });
  window.addEventListener("photosbyelie:languagechange", () => {
    populateCollectionOptions(window.photosByElieData || window.photosByElieHomeData || {});
    syncControls();
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
    ensureHomeKeyboardHint();
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
    ensureHomeKeyboardHint();
    setControlsDisabled(false);
    syncControls();
    renderResults();
    window.photosByElieI18n?.apply?.();
  })();
})();
