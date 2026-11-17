/* Shared customer preference: system | light | dark; datasets remain page-specific. */
(() => {
  const memory = new Map();
  const storage = {
    getItem(key) { try { return memory.has(key) ? memory.get(key) : localStorage.getItem(key); } catch { return memory.get(key) ?? null; } },
    setItem(key, value) { memory.set(key, String(value)); try { localStorage.setItem(key, value); } catch {} },
    removeItem(key) { memory.set(key, null); try { localStorage.removeItem(key); } catch {} },
  };
  const normalize = (value) => value === "day" ? "light" : value === "night" ? "dark" : ["light", "dark", "system"].includes(value) ? value : "system";
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  let preference = normalize(storage.getItem("byelie-theme"));
  const resolved = () => preference === "system" ? (media?.matches ? "dark" : "light") : preference;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener(resolved(), preference));
  const set = (value, key = "byelie-theme") => {
    preference = normalize(value);
    storage.setItem(key, preference);
    notify();
    return preference;
  };
  const changed = () => { if (preference === "system") notify(); };
  if (media?.addEventListener) media.addEventListener("change", changed);
  else media?.addListener?.(changed);
  window.addEventListener("storage", (event) => {
    if (event.key === "byelie-theme" || event.key === null) {
      memory.delete("byelie-theme");
      preference = normalize(storage.getItem("byelie-theme"));
      notify();
    }
  });
  window.photosByElieTheme = { storage, normalize, set, resolved, preference: () => preference,
    subscribe(listener) { listeners.add(listener); listener(resolved(), preference); } };
})();
