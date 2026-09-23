/* Stable action names shared by the preview and future WST production integration. */
(() => {
  const selectors = [
    ['#account-signup', 'account_signup'], ['#account-signin', 'account_signin'],
    ['#settings-open', 'display_settings'], ['#explore-trigger', 'hero_explore'],
    ['.scroll-cue', 'hero_scroll'], ['.primary-nav a[href*="gallery.html"]', 'nav_photos'],
    ['.usage-guide-action', 'gallery_selection'],
    ['[data-checkout-guest]', 'checkout_start'],
    ['[data-download-file]', 'download_file'], ['[data-download-all-files]', 'download_all'],
    ['[data-download-zip]', 'download_archive'],
    ['input[data-like-toggle]', 'photo_like'],
    ['[data-gallery-select-photo]', 'gallery_photo_select'],
    ['[data-gallery-like]', 'gallery_photo_like'],
    ['[data-resolution-list] input', 'resolution_select'],
    ['[data-photo-link]', 'photo_open'], ['[data-photo-caption]', 'photo_caption_open'],
    ['a[href*="basket.html"]', 'basket_open'], ['a[href*="liked.html"]', 'liked_open'],
    ['a[href*="photo.html"]', 'photo_open'],
    ['a[href*="gallery.html"]', 'gallery_open'],
    ['a[href*="campaign.html"]', 'social_collection_open'],
    ['a[href*="support.html"]', 'support_open'], ['a[href*="privacy.html"]', 'privacy_open'],
    ['a[href*="terms.html"]', 'terms_open'], ['a[href*="data-deletion.html"]', 'data_deletion_open'],
    ['a[href*="facebook.com"]', 'social_facebook'], ['a[href*="instagram.com"]', 'social_instagram'],
    ['a[href*="pinterest.com"]', 'social_pinterest'],
  ];
  const countries = ['spain', 'france', 'italy', 'usa', 'mexico', 'portugal'];
  countries.forEach(country => selectors.unshift([
    `.story-card-main[href*="gallery=${country}"]`, `country_${country}`,
  ]));

  /** Assign semantic IDs without recording photo IDs, search queries or button copy. */
  function mark(root) {
    for (const [selector, id] of selectors) {
      const elements = [...(root.querySelectorAll?.(selector) || [])];
      if (root.matches?.(selector)) elements.unshift(root);
      for (const element of elements) if (!element.dataset.wstCta) element.dataset.wstCta = id;
    }
  }
  mark(document);
  // Dynamic photo cards and purchase controls receive the same IDs as static markup.
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1) mark(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', event => {
    const target = event.target.closest?.('a,button,input');
    if (target) mark(target);
  }, true);
  window.PBEWebSignalsActions = Object.freeze({ ids: [...new Set(selectors.map(([, id]) => id))] });
})();
