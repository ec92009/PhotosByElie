(async () => {
  if (!new URLSearchParams(location.search).has("c")) return;
  try { await window.photosByElieCatalogReady; } catch {
    document.querySelector('[data-campaign-description]').textContent = 'This collection is unavailable. Please reload to try again.';
    return;
  }
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => window.photosByElieGalleryCard?.escapeHtml?.(value) || String(value || "");
  const collections = window.photosByElieData || {};
  const campaignId = new URLSearchParams(window.location.search).get("c") || "pinterest-invalides-2026-05-14";
  const safeCampaignId = campaignId.replace(/[^a-z0-9-]/gi, "");
  const scriptVersion = new URL(document.currentScript?.src || window.location.href, window.location.href).searchParams.get("v") || "";
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;

  const els = {
    title: $("[data-campaign-title]"),
    eyebrow: $("[data-campaign-eyebrow]"),
    description: $("[data-campaign-description]"),
    nav: $("[data-campaign-nav]"),
    heroMedia: $("[data-campaign-hero-media]"),
    primary: $("[data-campaign-primary]"),
    related: $("[data-campaign-related]"),
    relatedTitle: $("[data-campaign-related-title]"),
    searchForm: $("[data-campaign-search-form]"),
    searchInput: $("[data-campaign-search-input]"),
    searchStatus: $("[data-campaign-search-status]"),
    searchResults: $("[data-campaign-search-results]"),
    embeddedWarning: $("[data-embedded-browser-warning]"),
    openBrowserLink: $("[data-open-browser-link]"),
    copyBrowserLink: $("[data-copy-browser-link]"),
  };
  const densityKey = "photosbyelie-gallery-columns";
  const fitModeKey = "photosbyelie-gallery-fit-mode";
  let primaryEntries = [];
  let relatedEntries = [];
  let searchEntries = [];
  let viewControls = null;
  let densityInput = null;
  let densityValue = null;
  let fitModeButtons = [];
  const layoutControllers = [];

  const allPhotos = () => Object.entries(collections).flatMap(([collectionKey, collection]) => (
    (collection.photos || []).map((photo) => ({
      photo,
      collectionKey,
      collectionAccent: collection.accent || collectionKey,
    }))
  ));

  const photoIndex = new Map(allPhotos().map((entry) => [entry.photo.id, entry]));

  const photoHref = (id) => versionedHref(`./photo.html?id=${encodeURIComponent(id)}&fit=fill&columns=3`);

  const rules = window.photosByElieCampaignCollection;
  const entriesForIds = (ids) => rules.entries(ids, photoIndex);
  const likedStore = window.photosByElieLiked;
  const selectedPhotoIds = new Set();
  const t = (key, fallback) => {
    const translated = window.photosByElieI18n?.t?.(key);
    return translated && translated !== key ? translated : fallback;
  };
  const likedPhotoIds = () => new Set(likedStore?.read?.().map((item) => item.photoId) || []);

  const actionHtmlFor = (photo, likedIds) => {
    const isLiked = likedIds.has(photo.id);
    const isSelected = selectedPhotoIds.has(photo.id);
    return `
      <div class="gallery-card-selection">
        <button
          class="gallery-action-toggle gallery-select-toggle${isSelected ? " is-selected" : ""}"
          type="button"
          data-gallery-select-photo
          data-photo-id="${escapeHtml(photo.id)}"
          aria-label="${isSelected ? "Remove from selection" : "Add to selection"}"
          aria-pressed="${isSelected ? "true" : "false"}"
        >${isSelected ? "✓" : "+"}</button>
      </div>
      ${likedStore ? `
        <div class="gallery-card-actions">
          <button
            class="gallery-action-toggle gallery-like-toggle${isLiked ? " is-liked" : ""}"
            type="button"
            data-gallery-like
            data-photo-id="${escapeHtml(photo.id)}"
            aria-label="${escapeHtml(t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo", isLiked ? "Unlike this photo" : "Like this photo"))}"
            aria-pressed="${isLiked ? "true" : "false"}"
          >${window.photosByElieMdIcon?.(isLiked ? "favorite" : "favoriteBorder") || "<span aria-hidden=\"true\"></span>"}</button>
        </div>
      ` : ""}
    `;
  };

  const syncCampaignLikeButtons = () => {
    const likedIds = likedPhotoIds();
    document.querySelectorAll("[data-gallery-like]").forEach((button) => {
      const isLiked = likedIds.has(button.dataset.photoId);
      button.classList.toggle("is-liked", isLiked);
      button.setAttribute("aria-pressed", String(isLiked));
      button.setAttribute("aria-label", t(isLiked ? "a11y.unlike_photo" : "a11y.like_photo", isLiked ? "Unlike this photo" : "Like this photo"));
      button.innerHTML = window.photosByElieMdIcon?.(isLiked ? "favorite" : "favoriteBorder") || "<span aria-hidden=\"true\"></span>";
    });
  };

  const syncCampaignSelection = () => {
    document.querySelectorAll("[data-gallery-select-photo]").forEach((button) => {
      const isSelected = selectedPhotoIds.has(button.dataset.photoId);
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
      button.setAttribute("aria-label", isSelected ? "Remove from selection" : "Add to selection");
      button.textContent = isSelected ? "✓" : "+";
    });
    document.querySelectorAll(".mock-photo-card[data-photo-id]").forEach((card) => {
      card.classList.toggle("is-batch-selected", selectedPhotoIds.has(card.dataset.photoId));
    });
  };

  const bindCardActions = (container, entries) => {
    container?.querySelectorAll("[data-gallery-select-photo]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const photoId = button.dataset.photoId;
        if (!photoId) return;
        if (selectedPhotoIds.has(photoId)) selectedPhotoIds.delete(photoId);
        else selectedPhotoIds.add(photoId);
        syncCampaignSelection();
      });
    });
    container?.querySelectorAll("[data-gallery-like]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const photoId = button.dataset.photoId;
        if (!photoId || !likedStore) return;
        if (likedStore.has?.(photoId)) likedStore.remove(photoId);
        else likedStore.add(photoId);
        syncCampaignLikeButtons();
      });
    });
    container?.querySelectorAll("[data-photo-index]").forEach((card) => {
      const index = Number(card.dataset.photoIndex || 0);
      const entry = entries?.[index];
      if (!entry?.photo?.id) return;
      let clickNavigationTimer = 0;
      const openPreview = (event) => {
        if (event?.target?.closest?.("button")) return;
        window.clearTimeout(clickNavigationTimer);
        clickNavigationTimer = 0;
        event?.preventDefault?.();
        openCampaignQuickLook(container, entries, index, card.querySelector("[data-photo-link], [data-photo-caption]"));
      };
      // Give a second pointer click a chance to become the Quick Look gesture
      // before following the card's normal detail link.
      card.addEventListener("click", (event) => {
        if (event.target?.closest?.("button")) return;
        const link = event.target?.closest?.("[data-photo-link], [data-photo-caption]");
        if (!link) return;
        if (event.detail === 1) {
          event.preventDefault();
          window.clearTimeout(clickNavigationTimer);
          clickNavigationTimer = window.setTimeout(() => {
            clickNavigationTimer = 0;
            window.location.assign(card.dataset.photoHref || photoHref(entry.photo.id));
          }, 260);
        } else if (event.detail === 2) {
          event.preventDefault();
          window.clearTimeout(clickNavigationTimer);
          clickNavigationTimer = 0;
        }
      }, { capture: true });
      card.addEventListener("dblclick", openPreview);
      card.querySelectorAll("[data-photo-link], [data-photo-caption]").forEach((link) => {
        link.addEventListener("keydown", (event) => {
          if (event.key !== " ") return;
          openPreview(event);
        });
      });
      card.addEventListener("contextmenu", (event) => {
        if (event.target?.closest?.("button")) return;
        window.photosByElieShowMediaContextMenu?.(entry.photo, event, {
          owner: false,
          previewItems: entries.map((item) => item.photo),
          previewIndex: index,
          onOpenDetail: () => window.location.assign(card.dataset.photoHref || photoHref(entry.photo.id)),
        });
      });
    });
  };

  const renderEntries = (container, entries) => {
    if (!container) return;
    const likedIds = likedPhotoIds();
    const cards = (entries || []).map((entry, index) => {
      if (!entry) return "";
      return window.photosByElieGalleryCard.renderPhotoCard({
        photo: entry.photo,
        index,
        href: photoHref(entry.photo.id),
        collectionKey: entry.collectionKey,
        collectionAccent: entry.collectionAccent,
        actionHtml: actionHtmlFor(entry.photo, likedIds),
      });
    }).filter(Boolean);
    container.innerHTML = cards.join("");
    bindCardActions(container, entries);
    syncCampaignSelection();
    syncCampaignLikeButtons();
  };

  const renderCards = (container, ids) => {
    renderEntries(container, entriesForIds(ids));
  };

  const createLayoutController = (root, getPhotos) => {
    if (!root || !window.photosByElieGalleryLayout?.createMasonryController) return null;
    const controller = window.photosByElieGalleryLayout.createMasonryController({
      root,
      getPhotos,
      densityKey,
      fitModeKey,
      defaultDensity: 3,
      defaultFitMode: "fill",
      ignoreSavedLayout: true,
    });
    layoutControllers.push(controller);
    return controller;
  };

  const primaryLayout = createLayoutController(els.primary, () => primaryEntries.map((entry) => entry.photo));
  const relatedLayout = createLayoutController(els.related, () => relatedEntries.map((entry) => entry.photo));
  const searchLayout = createLayoutController(els.searchResults, () => searchEntries.map((entry) => entry.photo));

  const layoutForContainer = (container) => container === els.primary
    ? primaryLayout
    : container === els.searchResults ? searchLayout : relatedLayout;

  const openCampaignQuickLook = (container, entries, index, focusTarget) => {
    const entry = entries?.[index];
    if (!entry?.photo?.id || typeof window.photosByElieOpenFinderPreview !== "function") return false;
    const items = entries.map((item) => item.photo).filter((photo) => photo?.id);
    const itemIndex = Math.max(0, items.findIndex((photo) => photo.id === entry.photo.id));
    const layout = layoutForContainer(container);
    window.photosByElieOpenFinderPreview(entry.photo, {
      items,
      index: itemIndex,
      wrapNavigation: true,
      navigationKind: "loaded",
      navigationColumns: layout?.preferredDensityColumns?.() || 1,
      quickLookCommands: (photo) => [
        {
          id: "toggle-selection",
          label: selectedPhotoIds.has(photo?.id) ? "Deselect" : "Select",
          shortcutLabel: "S",
          selectionEffect: "toggle-current",
        },
        ...(likedStore ? [{
          id: "like",
          label: likedStore.has?.(photo?.id) ? "Unlike" : "Like",
          shortcutLabel: "L",
          selectionEffect: "preserve",
        }] : []),
      ],
      dispatchQuickLookCommand: (commandId, photo) => {
        if (!photo?.id) return null;
        if (commandId === "toggle-selection") {
          if (selectedPhotoIds.has(photo.id)) selectedPhotoIds.delete(photo.id);
          else selectedPhotoIds.add(photo.id);
          syncCampaignSelection();
          return { value: { succeeded: [photo.id] } };
        }
        if (commandId === "like" && likedStore) {
          if (likedStore.has?.(photo.id)) likedStore.remove(photo.id);
          else likedStore.add(photo.id);
          syncCampaignLikeButtons();
          return { value: { succeeded: [photo.id] } };
        }
        return null;
      },
      restoreFocus: (targetPhoto) => {
        const card = [...(container?.querySelectorAll?.("[data-photo-id]") || [])]
          .find((candidate) => candidate.dataset.photoId === targetPhoto?.id);
        (card?.querySelector("[data-photo-link], [data-photo-caption]") || focusTarget)?.focus?.({ preventScroll: true });
      },
    });
    return true;
  };

  const applyCampaignDensity = () => {
    layoutControllers.forEach((controller, index) => {
      controller.applyDensityControls(index === 0 ? { input: densityInput, value: densityValue } : {});
    });
  };

  const applyCampaignFitMode = () => {
    layoutControllers.forEach((controller, index) => {
      controller.applyFitMode(index === 0 ? fitModeButtons : []);
    });
  };

  const applyCampaignPreviewLayout = () => {
    primaryLayout?.applyPreviewLayout(primaryEntries.map((entry) => entry.photo));
    relatedLayout?.applyPreviewLayout(relatedEntries.map((entry) => entry.photo));
    searchLayout?.applyPreviewLayout(searchEntries.map((entry) => entry.photo));
  };

  const applyCampaignLayout = () => {
    applyCampaignDensity();
    applyCampaignFitMode();
    applyCampaignPreviewLayout();
    window.photosByEliePositionGalleryViewControls?.(viewControls);
  };

  const setCampaignDensityColumns = (columns) => {
    layoutControllers.forEach((controller) => controller.setDensityColumns(columns));
    applyCampaignLayout();
  };

  const setCampaignFitMode = (mode) => {
    layoutControllers.forEach((controller) => controller.setFitMode(mode));
    applyCampaignLayout();
  };

  const ensureCampaignViewControls = () => {
    if (viewControls || !primaryLayout) return;
    viewControls = document.createElement("div");
    viewControls.className = "gallery-view-controls is-header-mounted";
    viewControls.setAttribute("aria-label", "Gallery view controls");
    const densityControl = document.createElement("label");
    densityControl.className = "gallery-density-control";
    densityControl.innerHTML = `
      <span>Grid</span>
      <input type="range" min="1" max="${primaryLayout.maxDensityColumns()}" step="1" value="${primaryLayout.preferredDensityColumns()}" data-gallery-density/>
      <b data-gallery-density-value>${primaryLayout.preferredDensityColumns()}</b>
    `;
    const fitControl = document.createElement("div");
    fitControl.className = "gallery-fit-control";
    fitControl.setAttribute("role", "group");
    fitControl.setAttribute("aria-label", "Image fit");
    fitControl.innerHTML = `
      <button type="button" data-gallery-fit-mode="fit" aria-pressed="true">Fit</button>
      <button type="button" data-gallery-fit-mode="fill" aria-pressed="false">Fill</button>
    `;
    const topButton = document.createElement("button");
    topButton.className = "gallery-top-button";
    topButton.type = "button";
    topButton.dataset.galleryBackToTop = "";
    topButton.setAttribute("aria-label", "Back to top");
    topButton.innerHTML = `<span aria-hidden="true">↑</span>`;
    viewControls.append(densityControl, fitControl);
    const headerControls = document.querySelector(".header-controls");
    if (headerControls) headerControls.prepend(viewControls);
    else document.body.append(viewControls);
    document.body.append(topButton);
    densityInput = densityControl.querySelector("[data-gallery-density]");
    densityValue = densityControl.querySelector("[data-gallery-density-value]");
    fitModeButtons = [...fitControl.querySelectorAll("[data-gallery-fit-mode]")];
    topButton.addEventListener("click", () => {
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
    densityInput.addEventListener("input", () => setCampaignDensityColumns(densityInput.value));
    fitControl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-gallery-fit-mode]");
      if (button) setCampaignFitMode(button.dataset.galleryFitMode);
    });
    window.addEventListener("resize", applyCampaignLayout);
    window.addEventListener("load", applyCampaignLayout, { once: true });
    document.fonts?.ready?.then(applyCampaignLayout).catch(() => {});
  };

  const renderHero = (entry) => {
    if (!entry || !els.heroMedia) return;
    const image = window.photosByElieMediaUrl?.(entry.photo, "detail") || window.photosByElieMediaUrl?.(entry.photo, "gallery") || "";
    const title = escapeHtml(entry.photo.title || entry.photo.id);
    els.heroMedia.innerHTML = image
      ? `<a href="${photoHref(entry.photo.id)}"><img src="${escapeHtml(image)}" alt="${title}"/></a>`
      : `<a class="mock-photo" href="${photoHref(entry.photo.id)}"><span>${title}</span></a>`;
  };

  const renderSearch = (query) => {
    const terms = window.photosByEliePhotoFilter?.searchTerms?.({ query }) || String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      searchEntries = [];
      els.searchResults.hidden = true;
      els.searchResults.innerHTML = "";
      els.searchStatus.textContent = "Enter a title, place, keyword, or subject.";
      searchLayout?.applyPreviewLayout([]);
      return;
    }
    const matches = allPhotos()
      .filter((entry) => window.photosByEliePhotoFilter?.matchesSearchTerms
        ? window.photosByEliePhotoFilter.matchesSearchTerms(entry.photo, { query }, { collectionKey: entry.collectionKey })
        : terms.every((term) => String(entry.photo.title || "").toLowerCase().includes(term)))
      .slice(0, 24);
    searchEntries = matches;
    els.searchResults.hidden = matches.length === 0;
    els.searchStatus.textContent = matches.length
      ? `${matches.length} result${matches.length === 1 ? "" : "s"} shown.`
      : "No matching photos found.";
    renderEntries(els.searchResults, matches);
    applyCampaignLayout();
  };

  const syncEmbeddedBrowserWarning = () => {
    const embedded = window.photosByElieEmbeddedBrowser;
    if (!els.embeddedWarning || !embedded?.detected) return;
    els.embeddedWarning.hidden = false;
    if (els.openBrowserLink) els.openBrowserLink.href = embedded.externalUrl;
  };

  const loadCampaign = async () => {
    syncEmbeddedBrowserWarning();
    const response = await fetch(`./assets/campaigns/${safeCampaignId}.json${scriptVersion ? `?v=${encodeURIComponent(scriptVersion)}` : ""}`);
    if (!response.ok) throw new Error(`Could not load campaign ${safeCampaignId}`);
    const campaign = await response.json();
    if (!rules.publicCampaign(campaign)) throw new Error("This collection is unavailable.");
    document.title = `${campaign.title || "Photos By Elie"} | Photos By Elie`;
    if (els.title) els.title.textContent = campaign.title || "Photos By Elie";
    if (els.nav) els.nav.href = `./campaign.html?c=${encodeURIComponent(safeCampaignId)}`;
    if (els.eyebrow) els.eyebrow.textContent = campaign.eyebrow || "Photos By Elie";
    if (els.description) els.description.textContent = campaign.description || "";
    if (els.relatedTitle) els.relatedTitle.textContent = campaign.relatedTitle || "More from the archive";
    if (els.searchInput && campaign.searchPlaceholder) els.searchInput.placeholder = campaign.searchPlaceholder;
    primaryEntries = entriesForIds(rules.memberIds(campaign));
    relatedEntries = [];
    els.related.closest("section").hidden = true;
    if (!primaryEntries.length) els.description.textContent = "No public photographs are currently available in this collection.";
    const heroEntry = photoIndex.get(campaign.heroPhotoId || campaign.primaryPhotoIds?.[0]);
    const heroImage = campaign.imageUrl || (heroEntry && (window.photosByElieMediaUrl?.(heroEntry.photo, "detail") || window.photosByElieMediaUrl?.(heroEntry.photo, "gallery"))) || window.photosByElieSeo?.defaultImage;
    const campaignUrl = window.photosByElieSeo?.pageUrl?.("/campaign.html", { c: safeCampaignId });
    window.photosByElieSeo?.applyPageMeta({
      title: `${campaign.title || "Photos By Elie Collection"} | Photos By Elie`,
      description: campaign.description || "Browse a focused Photos By Elie travel photo collection.",
      url: campaignUrl,
      image: heroImage,
      imageAlt: campaign.imageAlt || campaign.title || "Photos By Elie collection",
      jsonLd: window.photosByElieSeo.collectionPageJsonLd({
        name: campaign.title || "Photos By Elie Collection",
        description: campaign.description || "Browse a focused Photos By Elie travel photo collection.",
        url: campaignUrl,
        image: heroImage,
        photos: [heroImage, ...(campaign.previewImageUrls || [])].map((image) => ({ image })),
      }),
    });
    renderHero(heroEntry);
    renderEntries(els.primary, primaryEntries);
    renderEntries(els.related, relatedEntries);
    ensureCampaignViewControls();
    applyCampaignLayout();
  };

  els.searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderSearch(els.searchInput?.value || "");
  });

  els.copyBrowserLink?.addEventListener("click", async () => {
    const embedded = window.photosByElieEmbeddedBrowser;
    const ok = await embedded?.copyText?.(embedded.externalUrl);
    els.copyBrowserLink.textContent = ok ? "Copied" : "Copy failed";
  });

  window.addEventListener("photosbyelie:likedchange", syncCampaignLikeButtons);

  loadCampaign().catch((error) => {
    if (els.description) els.description.textContent = error.message || "This collection is unavailable.";
  });
})();
