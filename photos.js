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
