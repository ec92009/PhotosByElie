(() => {
  const topbar = document.querySelector('.topbar');
  if (!topbar || topbar.querySelector('[data-owner-settings-toggle]')) return;

  const versionBadge = topbar.querySelector('.site-version-badge');
  if (versionBadge && versionBadge.parentElement !== document.body) document.body.append(versionBadge);

  let themeToggle = document.querySelector('[data-theme-toggle]');
  const controls = themeToggle?.closest('.header-controls');
  const version = versionBadge?.textContent?.trim() || 'Current build';
  const settingsButton = document.createElement('button');
  settingsButton.className = 'settings-toggle';
  settingsButton.type = 'button';
  settingsButton.dataset.ownerSettingsToggle = '';
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.setAttribute('aria-label', 'Settings');
  settingsButton.title = 'Settings';
  settingsButton.innerHTML = '<svg class="md-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 2.42C14.47 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.5.42L9.12 5.07c-.61.25-1.18.59-1.69.98l-2.49-1c-.23-.08-.48 0-.6.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.25.42.5.42h4c.25 0 .47-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>';

  const modal = document.createElement('div');
  modal.className = 'site-settings-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <section class="site-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="owner-settings-title">
      <div class="site-settings-head">
        <h2 id="owner-settings-title">Settings</h2>
        <button class="site-settings-close" type="button" aria-label="Close settings" title="Close settings">x</button>
      </div>
      <div class="site-settings-section">
        <p class="site-settings-section-title">Appearance</p>
        <div class="site-settings-slot" data-owner-settings-theme></div>
      </div>
      <div class="site-settings-section">
        <p class="site-settings-section-title">About</p>
        <p class="site-settings-value">${version}</p>
      </div>
    </section>
  `;

  const themeSlot = modal.querySelector('[data-owner-settings-theme]');
  if (!themeToggle) {
    themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.type = 'button';
    themeToggle.dataset.themeToggle = '';
    themeToggle.innerHTML = '<span class="mode-light">Night</span><span class="mode-dark">Day</span>';
  }
  if (themeToggle && themeSlot) themeSlot.append(themeToggle);
  if (controls && !controls.children.length) controls.remove();
  let utilities = topbar.querySelector('.header-utility-controls');
  if (!utilities) {
    utilities = document.createElement('div');
    utilities.className = 'header-utility-controls';
    topbar.append(utilities);
  }
  document.body.append(modal);
  utilities.append(settingsButton);

  const syncThemeToggle = () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    themeToggle.setAttribute('aria-pressed', String(isDark));
    themeToggle.setAttribute('title', isDark ? 'Switch to day mode' : 'Switch to night mode');
  };
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('byelie-theme', next);
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
    syncThemeToggle();
  });
  syncThemeToggle();

  const closeButton = modal.querySelector('.site-settings-close');
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsButton.focus({ preventScroll: true });
  };
  const open = () => {
    modal.hidden = false;
    settingsButton.setAttribute('aria-expanded', 'true');
    closeButton?.focus({ preventScroll: true });
  };
  settingsButton.addEventListener('click', () => (modal.hidden ? open() : close()));
  closeButton?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
})();
