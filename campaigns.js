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
  const filterBar = root.querySelector('[data-campaign-filters]');
  const rules = window.photosByElieCampaignCollection;
  const version = new URL(document.currentScript.src).searchParams.get('v');
  const normalizeSource = (value) => String(value || '').trim().toLowerCase();
  const sourceLabel = (key) => ({
    youtube: 'YouTube',
    pinterest: 'Pinterest',
    instagram: 'Instagram',
    facebook: 'Facebook',
    threads: 'Threads',
    etsy: 'Etsy',
  }[key] || (key ? key[0].toUpperCase() + key.slice(1) : 'All'));
  let activeSource = normalizeSource(new URLSearchParams(location.search).get('source')) || 'all';

  const applySourceFilter = (nextSource = 'all') => {
    activeSource = nextSource || 'all';
    const cards = [...grid.children];
    let visible = 0;
    for (const card of cards) {
      const cardSource = card.dataset.campaignSource || '';
      const show = activeSource === 'all' || cardSource === activeSource;
      card.hidden = !show;
      if (show) visible += 1;
    }
    if (filterBar) {
      filterBar.querySelectorAll('button[data-filter-source]').forEach((btn) => {
        const active = btn.dataset.filterSource === activeSource;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    status.textContent = visible
      ? (activeSource === 'all'
        ? `${visible} ${directoryNoun} to explore`
        : `${visible} ${sourceLabel(activeSource)} ${directoryNoun}`)
      : `No public ${directoryNoun} match this filter yet.`;
  };

  const renderSourceFilters = () => {
    if (!filterBar) return;
    const counts = new Map();
    for (const card of [...grid.children]) {
      const src = card.dataset.campaignSource || '';
      if (!src) continue;
      counts.set(src, (counts.get(src) || 0) + 1);
    }
    if (counts.size < 2) {
      filterBar.hidden = true;
      return;
    }
    const order = ['youtube', 'pinterest', 'instagram', 'facebook', 'threads', 'etsy'];
    const keys = [...counts.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    if (activeSource !== 'all' && !counts.has(activeSource)) activeSource = 'all';
    const buttons = [
      { key: 'all', label: `All (${grid.children.length})` },
      ...keys.map((key) => ({ key, label: `${sourceLabel(key)} (${counts.get(key)})` })),
    ].map(({ key, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'campaign-filter-pill';
      btn.dataset.filterSource = key;
      btn.setAttribute('aria-pressed', key === activeSource ? 'true' : 'false');
      btn.textContent = label;
      btn.addEventListener('click', () => applySourceFilter(key));
      return btn;
    });
    filterBar.replaceChildren(...buttons);
    filterBar.hidden = false;
    applySourceFilter(activeSource);
  };

  const campaignHref = (campaign) => `./campaign.html?c=${encodeURIComponent(campaign.id)}`;

  const captionFor = (campaign, entries, { video = null } = {}) => {
    const caption = document.createElement('div');
    caption.className = 'campaign-directory-caption';
    const title = document.createElement('h2');
    const titleLink = document.createElement('a');
    titleLink.href = campaignHref(campaign);
    titleLink.textContent = campaign.title;
    title.append(titleLink);
    const meta = document.createElement('p');
    meta.className = 'campaign-directory-meta';
    meta.textContent = [campaign.source, campaign.date].map((value) => String(value || '').trim()).filter(Boolean).join(' · ');
    const count = document.createElement('p');
    count.textContent = video
      ? `${video.portraitMp4 ? 'Portrait photo film' : 'Vertical YouTube Short'} · View collection →`
      : `${entries.length} photos · View collection →`;
    caption.append(title, meta, count);
    return caption;
  };

  const fourFrames = (preferredEntries, entries) => {
    const seen = new Set();
    const frames = [];
    for (const entry of [...preferredEntries, ...entries]) {
      const id = entry?.photo?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      frames.push(entry);
      if (frames.length === 4) return frames;
    }
    return [];
  };

  /** Build a linked four-photo composite from lifecycle-authorized public previews. */
  const cardFor = (campaign, entries, compositeEntries = entries) => {
    const frames = fourFrames(compositeEntries, entries);
    if (frames.length !== 4) return null;
    const card = document.createElement('a');
    card.className = 'campaign-directory-card';
    card.dataset.campaignRepresentation = 'four-photo-collage';
    card.dataset.campaignSource = normalizeSource(campaign.source);
    card.href = campaignHref(campaign);
    const composite = document.createElement('div');
    composite.className = 'campaign-composite campaign-composite--four';
    composite.setAttribute('role', 'img');
    composite.setAttribute('aria-label', `Four-photo composite: ${campaign.title}`);
    composite.dataset.frames = frames.length;
    for (const { photo } of frames) {
      const img = document.createElement('img');
      img.src = window.photosByElieMediaUrl(photo, 'gallery');
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        card.remove();
      }, { once: true });
      composite.append(img);
    }
    card.append(composite, captionFor(campaign, entries));
    return card;
  };

  /** Prefer the verified portrait derivative; retain the public YouTube fallback. */
  const videoCardFor = (campaign, video) => {
    const card = document.createElement('article');
    card.className = 'campaign-directory-card campaign-directory-card--video';
    card.dataset.campaignRepresentation = video.portraitMp4 ? 'native-portrait-video' : 'vertical-youtube-video';
    const frame = document.createElement('div');
    frame.className = 'campaign-directory-video';
    const player = document.createElement(video.portraitMp4 ? 'video' : 'iframe');
    if (video.portraitMp4) {
      player.src = video.portraitMp4;
      player.controls = true;
      player.playsInline = true;
      player.preload = 'none';
      if (campaign.imageUrl) player.poster = campaign.imageUrl;
      player.setAttribute('aria-label', campaign.title);
      player.addEventListener('error', () => {
        const message = document.createElement('p');
        message.setAttribute('role', 'status');
        message.textContent = 'The film could not load. Watch it on YouTube below.';
        frame.replaceChildren(message);
      }, { once: true });
    } else {
      player.src = video.portraitEmbedUrl;
      player.title = `${campaign.title} on YouTube`;
      player.loading = 'lazy';
      player.referrerPolicy = 'strict-origin-when-cross-origin';
      player.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      player.allowFullscreen = true;
    }
    frame.append(player);
    card.append(frame, captionFor(campaign, [], { video }));
    const watch = document.createElement('a');
    watch.className = 'campaign-directory-watch';
    // The preview stays vertical; the external CTA opens the matching wide film.
    watch.href = video.watchUrl;
    watch.target = '_blank';
    watch.rel = 'noopener noreferrer';
    watch.textContent = 'Watch on YouTube';
    card.querySelector('.campaign-directory-caption').append(watch);
    if (video.musicCredit) {
      const credit = document.createElement('p');
      credit.className = 'campaign-directory-meta';
      credit.textContent = video.musicCredit;
      card.querySelector('.campaign-directory-caption').append(credit);
    }
    return card;
  };

  const load = async () => {
    const response = await fetch(`./assets/campaigns/index.json?v=${encodeURIComponent(version || '')}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Campaign index unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.campaigns)) throw new Error('Invalid campaign index');
    const campaigns = payload.campaigns.filter((campaign) => rules.publicCampaign(campaign)
      && (!sourceFilter.size || sourceFilter.has(String(campaign.source || '').trim().toLowerCase())));
    const videoCampaigns = campaigns
      .map((campaign) => ({ campaign, video: window.photosByElieCampaignVideo?.normalize(campaign.video) }))
      .filter(({ video }) => Boolean(video?.portraitEmbedUrl));
    videoCampaigns.forEach(({ campaign, video }) => {
      const card = videoCardFor(campaign, video);
      card.dataset.campaignSource = normalizeSource(campaign.source) || 'youtube';
      grid.append(card);
    });
    if (grid.children.length) status.textContent = 'Published films are ready while public photo previews load.';
    let catalogAvailable = true;
    try { await window.photosByElieCatalogReady; } catch { catalogAvailable = false; }
    const index = new Map(Object.values(catalogAvailable ? window.photosByElieData : {}).flatMap((collection) =>
      (collection.photos || []).map((photo) => [photo.id, { photo }])));
    for (const campaign of campaigns) {
      const entries = rules.entries(campaign.photoIds, index);
      const compositeEntries = rules.entries(campaign.compositePhotoIds || campaign.photoIds, index);
      const publicFilm = window.photosByElieCampaignVideo?.normalize(campaign.video);
      if (publicFilm?.portraitEmbedUrl) continue;
      const card = cardFor(campaign, entries, compositeEntries);
      if (card) grid.append(card);
    }
    status.textContent = grid.children.length
      ? `${grid.children.length} ${directoryNoun} to explore`
      : `No public ${directoryNoun} are available yet.`;
    renderSourceFilters();
  };
  // Observe catalog rejection immediately, even while the campaign index is loading.
  window.photosByElieCatalogReady.catch(() => {});
  load().catch(() => { status.textContent = 'We could not load the collections. Please reload to try again.'; });
})();
