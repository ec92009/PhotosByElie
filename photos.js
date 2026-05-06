const root = document.documentElement;
const key = 'byelie-theme';
const btn = document.querySelector('[data-theme-toggle]');
const languageKey = 'byelie-language';
const languageBtn = document.querySelector('[data-language-toggle]');
const languages = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
];
const rawSourceTypes = new Set(['DNG', 'NEF', 'CR2', 'CR3', 'ARW', 'RAF', 'ORF', 'RW2', 'RAW', 'PEF', 'SRW', 'RWL']);
const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
const tapFirstQuery = window.matchMedia?.('(max-width: 760px) and (hover: none) and (pointer: coarse)');
let hasKeyboardInput = false;

const syncInputModeClass = () => {
  const isTapFirst = Boolean(tapFirstQuery?.matches);
  root.classList.toggle('is-localhost', localHostnames.has(window.location.hostname));
  root.classList.toggle('is-tap-first', isTapFirst);
  root.classList.toggle('has-keyboard-input', hasKeyboardInput);
};

window.photosByElieInputMode = {
  isLocalhost: () => localHostnames.has(window.location.hostname),
  isTapFirst: () => Boolean(tapFirstQuery?.matches),
  hasKeyboardInput: () => hasKeyboardInput,
  shouldShowKeyboardHints: () => localHostnames.has(window.location.hostname) || !tapFirstQuery?.matches || hasKeyboardInput,
  applyKeyboardHint: (element, enabled = true) => {
    if (!element) return;
    element.hidden = !enabled || !window.photosByElieInputMode.shouldShowKeyboardHints();
  }
};

const productSettingsKey = 'photosbyelie-product-settings';
const readProductSettings = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(productSettingsKey) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const writeProductSettings = (settings) => {
  try {
    localStorage.setItem(productSettingsKey, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
};

window.photosByElieProductSettings = {
  read: readProductSettings,
  physicalProductsEnabled: () => (
    window.photosByElieInputMode.isLocalhost()
    && readProductSettings().physicalProductsEnabled === true
  ),
  setPhysicalProductsEnabled: (enabled) => {
    if (!window.photosByElieInputMode.isLocalhost()) return false;
    const settings = { ...readProductSettings(), physicalProductsEnabled: Boolean(enabled) };
    writeProductSettings(settings);
    window.dispatchEvent(new CustomEvent('photosbyelie:productsettingschange', { detail: settings }));
    return settings.physicalProductsEnabled;
  }
};

syncInputModeClass();
tapFirstQuery?.addEventListener?.('change', () => {
  syncInputModeClass();
  window.dispatchEvent(new CustomEvent('photosbyelie:inputmodechange'));
});
window.addEventListener('keydown', (event) => {
  if (hasKeyboardInput || event.metaKey || event.ctrlKey || event.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(event.key)) return;
  hasKeyboardInput = true;
  syncInputModeClass();
  window.dispatchEvent(new CustomEvent('photosbyelie:inputmodechange'));
}, { capture: true });

const photoMetadataValue = (photo, label) => (
  (photo?.metadata || []).find((item) => item.label === label)?.value || ''
);

window.photosByElieRawSourceLabel = (photo) => {
  const sourceType = (photo?.sourceFiles || [])
    .map((source) => String(source?.type || '').trim().toUpperCase())
    .find((type) => rawSourceTypes.has(type));
  if (sourceType) return sourceType;
  const sourceText = [
    photo?.full,
    photoMetadataValue(photo, 'Original file'),
    photoMetadataValue(photo, 'Original size')
  ].filter(Boolean).join(' ').toUpperCase();
  const match = sourceText.match(/\b(DNG|NEF|CR2|CR3|ARW|RAF|ORF|RW2|RAW|PEF|SRW|RWL)\b/);
  return match?.[1] || '';
};

const normalizePublicMediaBase = (value) => String(value || '').trim().replace(/\/+$/, '');
const mediaConfig = window.photosByElieMediaConfig || {};
const mediaBaseStorageKey = 'photosbyelie-public-media-base';
const mediaBaseFromQuery = (() => {
  try {
    return normalizePublicMediaBase(new URLSearchParams(window.location.search).get('mediaBase') || '');
  } catch {
    return '';
  }
})();

if (mediaBaseFromQuery.toLowerCase() === 'local') {
  try {
    localStorage.removeItem(mediaBaseStorageKey);
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
} else if (mediaBaseFromQuery) {
  try {
    localStorage.setItem(mediaBaseStorageKey, mediaBaseFromQuery);
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
}

const storedMediaBase = (() => {
  try {
    return normalizePublicMediaBase(localStorage.getItem(mediaBaseStorageKey) || '');
  } catch {
    return '';
  }
})();
const configuredMediaBase = normalizePublicMediaBase(mediaConfig.publicBaseUrl);
window.photosByEliePublicMediaBase = normalizePublicMediaBase(
  mediaBaseFromQuery && mediaBaseFromQuery.toLowerCase() !== 'local'
    ? mediaBaseFromQuery
    : window.photosByEliePublicMediaBase || configuredMediaBase || storedMediaBase
);
window.photosByEliePublicMediaHostnames = new Set(mediaConfig.publicMediaHostnames || ['ec92009.github.io']);
window.photosByElieMediaStatus = () => ({
  baseUrl: window.photosByEliePublicMediaBase,
  requiresPublicMedia: window.photosByEliePublicMediaHostnames.has(window.location.hostname),
});

window.photosByEliePublicHiddenIds = new Set();
window.photosByElieIsPublicHidden = (photo) => (
  !window.photosByElieInputMode.isLocalhost()
  && Boolean(photo?.id)
  && window.photosByEliePublicHiddenIds.has(photo.id)
);
window.photosByElieFilterPublicHidden = (photos = []) => {
  if (window.photosByElieInputMode.isLocalhost() || !window.photosByEliePublicHiddenIds.size) return photos;
  return photos.filter((photo) => !window.photosByEliePublicHiddenIds.has(photo?.id));
};
window.photosByElieHiddenBlacklistReady = (async () => {
  const base = normalizePublicMediaBase(window.photosByEliePublicMediaBase);
  if (!base || window.photosByElieInputMode.isLocalhost()) return window.photosByEliePublicHiddenIds;
  try {
    const url = `${base}/hidden-blacklist.json?t=${Math.floor(Date.now() / 60000)}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Hidden blacklist ${response.status}`);
    const payload = await response.json();
    const ids = Array.isArray(payload?.photo_ids) ? payload.photo_ids : [];
    window.photosByEliePublicHiddenIds = new Set(ids.filter((id) => typeof id === 'string' && id));
    window.dispatchEvent(new CustomEvent('photosbyelie:hiddenblacklistchange', {
      detail: { count: window.photosByEliePublicHiddenIds.size }
    }));
  } catch {
    window.photosByEliePublicHiddenIds = new Set();
  }
  return window.photosByEliePublicHiddenIds;
})();

window.photosByElieMediaKey = (photo, size = 'gallery') => {
  const preview = photo?.media?.publicPreview;
  if (preview?.allowed === false) return '';
  const key = size === 'detail' ? preview?.detailKey : preview?.galleryKey;
  return key || '';
};

window.photosByElieLocalMediaUrl = (photo, size = 'gallery') => {
  if (!photo) return '';
  if (size === 'detail') return photo.imageSrc || photo.gallerySrc || '';
  return photo.gallerySrc || photo.imageSrc || '';
};

window.photosByElieMediaUrl = (photo, size = 'gallery') => {
  const key = window.photosByElieMediaKey(photo, size);
  const base = normalizePublicMediaBase(window.photosByEliePublicMediaBase);
  if (base && key) return `${base}/${key.replace(/^\/+/, '')}`;
  if (base && photo?.media?.publicPreview?.allowed === false) {
    return window.photosByElieInputMode.isLocalhost() ? window.photosByElieLocalMediaUrl(photo, size) : '';
  }
  if (!base && window.photosByElieMediaStatus().requiresPublicMedia && key) return '';
  return window.photosByElieLocalMediaUrl(photo, size);
};

btn?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem(key, root.dataset.theme);
});

const setLanguage = (language) => {
  const next = languages.find((item) => item.code === language) || languages[0];
  root.dataset.language = next.code;
  root.lang = next.code;
  if (languageBtn) languageBtn.textContent = next.label;
  localStorage.setItem(languageKey, next.code);
};

if (languageBtn) {
  const savedLanguage = localStorage.getItem(languageKey);
  setLanguage(savedLanguage);
  languageBtn.addEventListener('click', () => {
    const currentIndex = languages.findIndex((item) => item.code === root.dataset.language);
    const nextLanguage = languages[(currentIndex + 1) % languages.length];
    setLanguage(nextLanguage.code);
  });
}
