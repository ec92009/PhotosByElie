(() => {
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => window.photosByElieGalleryCard?.escapeHtml?.(value) || String(value || "");
  const collections = window.photosByElieData || {};
  const campaignId = new URLSearchParams(window.location.search).get("c") || "pinterest-invalides-2026-05-14";
  const safeCampaignId = campaignId.replace(/[^a-z0-9-]/gi, "");

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

  const photoHref = (id) => `./photo.html?id=${encodeURIComponent(id)}&v=76.19`;

  const entriesForIds = (ids) => (ids || [])
    .map((id) => photoIndex.get(id))
    .filter(Boolean);

  const renderEntries = (container, entries) => {
    if (!container) return;
    const cards = (entries || []).map((entry, index) => {
      if (!entry) return "";
      return window.photosByElieGalleryCard.renderPhotoCard({
        photo: entry.photo,
        index,
        href: photoHref(entry.photo.id),
        collectionKey: entry.collectionKey,
        collectionAccent: entry.collectionAccent,
      });
    }).filter(Boolean);
    container.innerHTML = cards.join("");
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
    });
    layoutControllers.push(controller);
    return controller;
  };

  const primaryLayout = createLayoutController(els.primary, () => primaryEntries.map((entry) => entry.photo));
  const relatedLayout = createLayoutController(els.related, () => relatedEntries.map((entry) => entry.photo));
  const searchLayout = createLayoutController(els.searchResults, () => searchEntries.map((entry) => entry.photo));

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
    topButton.setAttribute("aria-label", "Back to top");
    topButton.innerHTML = `<span aria-hidden="true">↑</span>`;
    viewControls.append(densityControl, topButton, fitControl);
    const headerControls = document.querySelector(".header-controls");
    headerControls?.insertBefore(viewControls, headerControls.querySelector(".site-version-badge"));
    if (!viewControls.isConnected) document.body.append(viewControls);
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

  const searchableText = (entry) => [
    entry.photo.title,
    entry.collectionKey,
    ...(entry.photo.keywords || []),
    ...(entry.photo.metadata || []).map((item) => `${item.label} ${item.value}`),
  ].filter(Boolean).join(" ").toLowerCase();

  const renderSearch = (query) => {
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      els.searchResults.hidden = true;
      els.searchResults.innerHTML = "";
      els.searchStatus.textContent = "Enter a title, place, keyword, or subject.";
      return;
    }
    const matches = allPhotos()
      .filter((entry) => terms.every((term) => searchableText(entry).includes(term)))
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
    const response = await fetch(`./assets/campaigns/${safeCampaignId}.json?v=76.19`);
    if (!response.ok) throw new Error(`Could not load campaign ${safeCampaignId}`);
    const campaign = await response.json();
    document.title = `${campaign.title || "Photos By Elie"} | Photos By Elie`;
    if (els.title) els.title.textContent = campaign.title || "Photos By Elie";
    if (els.nav) els.nav.href = `./campaign.html?c=${encodeURIComponent(safeCampaignId)}`;
    if (els.eyebrow) els.eyebrow.textContent = campaign.eyebrow || "Photos By Elie";
    if (els.description) els.description.textContent = campaign.description || "";
    if (els.relatedTitle) els.relatedTitle.textContent = campaign.relatedTitle || "More from the archive";
    if (els.searchInput && campaign.searchPlaceholder) els.searchInput.placeholder = campaign.searchPlaceholder;
    primaryEntries = entriesForIds(campaign.primaryPhotoIds || []);
    relatedEntries = entriesForIds(campaign.relatedPhotoIds || []);
    renderHero(photoIndex.get(campaign.heroPhotoId || campaign.primaryPhotoIds?.[0]));
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

  loadCampaign().catch((error) => {
    if (els.description) els.description.textContent = error.message || "This collection is unavailable.";
  });
})();
