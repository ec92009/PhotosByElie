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
    heroMedia: $("[data-campaign-hero-media]"),
    primary: $("[data-campaign-primary]"),
    related: $("[data-campaign-related]"),
    searchForm: $("[data-campaign-search-form]"),
    searchInput: $("[data-campaign-search-input]"),
    searchStatus: $("[data-campaign-search-status]"),
    searchResults: $("[data-campaign-search-results]"),
    embeddedWarning: $("[data-embedded-browser-warning]"),
    openBrowserLink: $("[data-open-browser-link]"),
    copyBrowserLink: $("[data-copy-browser-link]"),
  };

  const allPhotos = () => Object.entries(collections).flatMap(([collectionKey, collection]) => (
    (collection.photos || []).map((photo) => ({
      photo,
      collectionKey,
      collectionAccent: collection.accent || collectionKey,
    }))
  ));

  const photoIndex = new Map(allPhotos().map((entry) => [entry.photo.id, entry]));

  const photoHref = (id) => `./photo.html?id=${encodeURIComponent(id)}&v=74.36`;

  const renderCards = (container, ids) => {
    if (!container) return;
    const cards = (ids || []).map((id, index) => {
      const entry = photoIndex.get(id);
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
    els.searchResults.hidden = matches.length === 0;
    els.searchStatus.textContent = matches.length
      ? `${matches.length} result${matches.length === 1 ? "" : "s"} shown.`
      : "No matching photos found.";
    els.searchResults.innerHTML = matches.map((entry, index) => window.photosByElieGalleryCard.renderPhotoCard({
      photo: entry.photo,
      index,
      href: photoHref(entry.photo.id),
      collectionKey: entry.collectionKey,
      collectionAccent: entry.collectionAccent,
    })).join("");
  };

  const syncEmbeddedBrowserWarning = () => {
    const embedded = window.photosByElieEmbeddedBrowser;
    if (!els.embeddedWarning || !embedded?.detected) return;
    els.embeddedWarning.hidden = false;
    if (els.openBrowserLink) els.openBrowserLink.href = embedded.externalUrl;
  };

  const loadCampaign = async () => {
    syncEmbeddedBrowserWarning();
    const response = await fetch(`./assets/campaigns/${safeCampaignId}.json?v=74.36`);
    if (!response.ok) throw new Error(`Could not load campaign ${safeCampaignId}`);
    const campaign = await response.json();
    document.title = `${campaign.title || "Photos By Elie"} | Photos By Elie`;
    if (els.title) els.title.textContent = campaign.title || "Photos By Elie";
    if (els.eyebrow) els.eyebrow.textContent = campaign.eyebrow || "Photos By Elie";
    if (els.description) els.description.textContent = campaign.description || "";
    if (els.searchInput && campaign.searchPlaceholder) els.searchInput.placeholder = campaign.searchPlaceholder;
    renderHero(photoIndex.get(campaign.heroPhotoId || campaign.primaryPhotoIds?.[0]));
    renderCards(els.primary, campaign.primaryPhotoIds || []);
    renderCards(els.related, campaign.relatedPhotoIds || []);
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
