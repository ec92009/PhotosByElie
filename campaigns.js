(() => {
  const root = document.querySelector('[data-all-campaigns]');
  if (new URLSearchParams(location.search).has('c')) return;
  document.querySelectorAll('[data-campaign-detail]').forEach((el) => { el.hidden = true; });
  root.hidden = false;
  document.body.classList.add('all-campaigns');
  const sourceFilter = new Set(String(root.dataset.campaignSources || '')
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean));
  const directoryTitle = String(root.dataset.directoryTitle || 'All campaigns').trim() || 'All campaigns';
  const directoryDescription = String(root.dataset.directoryDescription || '').trim();
  const directoryNoun = String(root.dataset.directoryNoun || 'collections').trim() || 'collections';
  document.title = `${directoryTitle} | Photos By Elie`;
  const title = root.querySelector('[data-directory-title]');
  if (title) title.textContent = directoryTitle;
  const description = root.querySelector('[data-directory-description]');
  if (description && directoryDescription) description.textContent = directoryDescription;
  const status = root.querySelector('[role="status"]');
  const grid = root.querySelector('[data-campaign-directory]');
  const rules = window.photosByElieCampaignCollection;
  const version = new URL(document.currentScript.src).searchParams.get('v');

  /** Build a linked composite from lifecycle-authorized, public watermarked previews. */
  const cardFor = (campaign, entries, compositeEntries = entries) => {
    const card = document.createElement('a');
    card.className = 'campaign-directory-card';
    card.href = `./campaign.html?c=${encodeURIComponent(campaign.id)}`;
    const composite = document.createElement('div');
    composite.className = 'campaign-composite';
    composite.setAttribute('role', 'img');
    composite.setAttribute('aria-label', `Photographic composite: ${campaign.title}`);
    const frames = compositeEntries.slice(0, 4);
    composite.dataset.frames = frames.length;
    for (const { photo } of frames) {
      const img = document.createElement('img');
      img.src = window.photosByElieMediaUrl(photo, 'gallery');
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.remove();
        composite.dataset.frames = composite.children.length;
        if (!composite.children.length) composite.textContent = 'Preview unavailable';
      }, { once: true });
      composite.append(img);
    }
    const caption = document.createElement('div');
    caption.className = 'campaign-directory-caption';
    const title = document.createElement('h2');
    title.textContent = campaign.title;
    const meta = document.createElement('p');
    meta.className = 'campaign-directory-meta';
    meta.textContent = [campaign.source, campaign.date].map((value) => String(value || '').trim()).filter(Boolean).join(' · ');
    const count = document.createElement('p');
    count.textContent = `${entries.length} photo${entries.length === 1 ? '' : 's'} · View collection →`;
    caption.append(title, meta, count);
    card.append(composite, caption);
    return card;
  };

  const load = async () => {
    const response = await fetch(`./assets/campaigns/index.json?v=${encodeURIComponent(version || '')}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Campaign index unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.campaigns)) throw new Error('Invalid campaign index');
    await window.photosByElieCatalogReady;
    const index = new Map(Object.values(window.photosByElieData).flatMap((collection) =>
      (collection.photos || []).map((photo) => [photo.id, { photo }])));
    for (const campaign of payload.campaigns) {
      if (!rules.publicCampaign(campaign)) continue;
      if (sourceFilter.size && !sourceFilter.has(String(campaign.source || '').trim().toLowerCase())) continue;
      const entries = rules.entries(campaign.photoIds, index);
      const compositeEntries = rules.entries(campaign.compositePhotoIds || campaign.photoIds, index);
      if (entries.length) grid.append(cardFor(campaign, entries, compositeEntries.length ? compositeEntries : entries));
    }
    status.textContent = grid.children.length
      ? `${grid.children.length} ${directoryNoun} to explore`
      : `No public ${directoryNoun} are available yet.`;
  };
  // Observe catalog rejection immediately, even while the campaign index is loading.
  window.photosByElieCatalogReady.catch(() => {});
  load().catch(() => { status.textContent = 'We could not load the collections. Please reload to try again.'; });
})();
