(() => {
  const topbar = document.querySelector('.topbar');
  if (!topbar || topbar.querySelector('[data-owner-account-toggle]')) return;

  const loginButton = document.querySelector('[data-backstage-setup-login], [data-new-owner-login], [data-acs-login]');
  const logoutButton = document.querySelector('[data-backstage-setup-logout], [data-new-owner-logout], [data-acs-logout]');
  if (!loginButton && !logoutButton) return;

  let utilities = topbar.querySelector('.header-utility-controls');
  if (!utilities) {
    utilities = document.createElement('div');
    utilities.className = 'header-utility-controls';
    topbar.append(utilities);
  }

  const accountButton = document.createElement('button');
  accountButton.className = 'account-toggle';
  accountButton.type = 'button';
  accountButton.dataset.ownerAccountToggle = '';
  accountButton.setAttribute('aria-haspopup', 'dialog');
  accountButton.setAttribute('aria-expanded', 'false');
  accountButton.setAttribute('aria-label', 'Account');
  accountButton.title = 'Account';
  accountButton.innerHTML = '<svg class="md-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';

  const modal = document.createElement('div');
  modal.className = 'site-account-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <section class="site-account-dialog" role="dialog" aria-modal="true" aria-labelledby="owner-account-title">
      <div class="site-settings-head site-account-head">
        <h2 id="owner-account-title">Account</h2>
        <button class="site-settings-close" type="button" aria-label="Close account" title="Close account">x</button>
      </div>
      <div class="site-account-status">
        <strong>Cloud Owner account</strong>
        <span>Use Google sign-in to authorize this browser.</span>
      </div>
      <div class="site-account-actions" data-owner-account-actions></div>
    </section>
  `;
  const actions = modal.querySelector('[data-owner-account-actions]');
  [loginButton, logoutButton].filter(Boolean).forEach((button) => {
    button.classList.add('site-account-action');
    actions.append(button);
  });
  utilities.append(accountButton);
  document.body.append(modal);

  const closeButton = modal.querySelector('.site-settings-close');
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    accountButton.setAttribute('aria-expanded', 'false');
    accountButton.focus({ preventScroll: true });
  };
  const open = () => {
    modal.hidden = false;
    accountButton.setAttribute('aria-expanded', 'true');
    closeButton?.focus({ preventScroll: true });
  };
  accountButton.addEventListener('click', () => (modal.hidden ? open() : close()));
  closeButton?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
})();
