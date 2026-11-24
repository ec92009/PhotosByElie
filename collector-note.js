(() => {
  const FALLBACK_COPY = {
    'collector.eyebrow': 'Collector’s note',
    'collector.title': 'Free travel wallpaper pack, plus new releases.',
    'collector.body': 'Get three high-resolution wallpapers from Andalusia, Tuscany, and Paris right away, plus an occasional note when a new series opens.',
    'collector.email_label': 'Email address',
    'collector.submit': 'Get the wallpapers',
    'collector.fineprint': 'Occasional notes only. No spam, no tracking cookies, unsubscribe in one click.',
    'collector.pack_title': 'Your wallpapers are ready',
    'collector.submitting': 'Preparing your wallpaper pack…',
    'collector.invalid_email': 'Please enter a valid email address.',
    'collector.success_email': 'Sent to your inbox — and ready to download below.',
    'collector.success_instant': 'You’re subscribed — your wallpapers are ready to download below.',
    'collector.already_subscribed': 'You’re already on the list — here are your wallpapers again.',
    'collector.rate_limited': 'Too many attempts right now. Please try again in a little while.',
    'collector.error': 'Could not complete signup right now. Please try again in a moment.',
    'collector.download': 'Download',
  };

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const text = (key) => {
    const translator = window.photosByElieI18n?.t;
    if (typeof translator === 'function') {
      const value = translator(key);
      if (value && value !== key) return value;
    }
    return FALLBACK_COPY[key] || key;
  };

  const activeLanguage = () => {
    const lang = window.photosByElieI18n?.language?.()
      || document.documentElement.dataset.language
      || document.documentElement.lang
      || 'en';
    const normalized = String(lang).trim().toLowerCase().slice(0, 2);
    return (normalized === 'fr' || normalized === 'es') ? normalized : 'en';
  };

  const workerBaseUrl = () => {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const params = new URLSearchParams(window.location.search);
    const localOverride = isLocalHost ? (params.get('authWorkerBase') || params.get('workerBase') || '') : '';
    const raw = localOverride
      || window.photosByElieMediaConfig?.authWorkerBaseUrl
      || 'https://auth.photos-by-elie.com';
    return String(raw).trim().replace(/\/+$/, '');
  };

  const sanitizeSlug = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);

  const resolveSource = (section) => {
    const base = sanitizeSlug(section?.dataset?.collectorSource) || 'site';
    if (base === 'gallery') {
      const params = new URLSearchParams(window.location.search);
      const slug = sanitizeSlug(document.body?.dataset?.gallery || params.get('gallery') || '');
      if (slug) return `gallery-${slug}`;
    }
    return base;
  };

  const init = (root = document) => {
    const section = root.querySelector('#collector-note');
    const form = root.querySelector('#collector-note-form');
    const emailInput = root.querySelector('#collector-email');
    const trapInput = root.querySelector('#collector-website');
    const submitButton = root.querySelector('#collector-submit');
    const status = root.querySelector('#collector-status');
    const packContainer = root.querySelector('#collector-wallpapers');
    const packList = root.querySelector('#collector-wallpapers-list');
    if (!section || !form || !emailInput || !submitButton || !status || !packContainer || !packList) return false;
    if (form.dataset.collectorBound === 'true') return true;
    form.dataset.collectorBound = 'true';

    let submitting = false;

    const setStatus = (message = '', { error = false, success = false } = {}) => {
      status.textContent = message;
      status.classList.toggle('is-error', error);
      status.classList.toggle('is-success', success);
    };

    const renderWallpapers = (wallpapers = []) => {
      if (!Array.isArray(wallpapers) || !wallpapers.length) return;
      const items = wallpapers.map((wallpaper) => {
        const li = document.createElement('li');
        li.className = 'collector-note-strip-pack-item';

        const meta = document.createElement('span');
        meta.className = 'collector-note-strip-pack-meta';
        const strong = document.createElement('strong');
        strong.textContent = String(wallpaper.title || '');
        const small = document.createElement('small');
        small.textContent = [wallpaper.location, wallpaper.dimensions].filter(Boolean).join(' · ');
        meta.append(strong, small);

        const link = document.createElement('a');
        link.className = 'btn secondary collector-note-strip-download';
        link.href = String(wallpaper.downloadUrl || '');
        link.target = '_blank';
        link.rel = 'noopener';
        link.setAttribute('download', '');
        link.textContent = text('collector.download');

        li.append(meta, link);
        return li;
      });
      packList.replaceChildren(...items);
      packContainer.hidden = false;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitting) return;
      const email = emailInput.value.trim();
      if (!EMAIL_PATTERN.test(email)) {
        setStatus(text('collector.invalid_email'), { error: true });
        emailInput.focus();
        return;
      }

      const worker = workerBaseUrl();
      if (!worker) {
        setStatus(text('collector.error'), { error: true });
        return;
      }

      submitting = true;
      submitButton.disabled = true;
      form.setAttribute('aria-busy', 'true');
      setStatus(text('collector.submitting'));

      try {
        const response = await fetch(`${worker}/newsletter/subscribe`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            language: activeLanguage(),
            source: resolveSource(section),
            website: trapInput?.value || '',
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 429) {
          setStatus(text('collector.rate_limited'), { error: true });
          return;
        }
        if (response.status === 400 && payload?.error === 'invalid_email') {
          setStatus(text('collector.invalid_email'), { error: true });
          return;
        }
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.error || 'newsletter_subscribe_failed');
        }
        const messageKey = payload.alreadySubscribed
          ? 'collector.already_subscribed'
          : payload.emailSent
            ? 'collector.success_email'
            : 'collector.success_instant';
        setStatus(text(messageKey), { success: true });
        renderWallpapers(payload.wallpapers);
        emailInput.value = '';
      } catch {
        setStatus(text('collector.error'), { error: true });
      } finally {
        submitting = false;
        submitButton.disabled = false;
        form.setAttribute('aria-busy', 'false');
      }
    });

    return true;
  };

  window.photosByElieCollectorNote = { init, resolveSource };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})();
