(() => {
  const script = document.currentScript;
  const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
  const version = scriptUrl?.searchParams.get("v") || document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "";
  const withVersion = (path) => version ? `${path}?v=${encodeURIComponent(version)}` : path;

  const loadScript = (path) => new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = withVersion(path);
    element.async = true;
    element.addEventListener("load", resolve, { once: true });
    element.addEventListener("error", () => reject(new Error(`Could not load ${path}`)), { once: true });
    document.body.append(element);
  });

  const runWhenCatalogIsUseful = (callback) => {
    if (document.querySelector("[data-home-discovery]")) {
      window.setTimeout(callback, 0);
      return;
    }
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(callback, { timeout: 1200 });
      return;
    }
    window.setTimeout(callback, 150);
  };

  window.photosByElieFullCatalogReady = new Promise((resolve) => {
    runWhenCatalogIsUseful(async () => {
      try {
        await loadScript("./catalog-sqlite.js");
        await loadScript("./photos-data.js");
        await window.photosByElieCatalogReady;
        window.dispatchEvent(new CustomEvent("photosbyelie:catalogloaded", {
          detail: { collections: Object.keys(window.photosByElieData || {}).length },
        }));
        await loadScript("./basket-store.js");
        await loadScript("./liked-store.js");
        await loadScript("./basket-rail.js");
        resolve(window.photosByElieData || {});
      } catch (error) {
        console.warn(error?.message || "Full catalog load failed.");
        resolve(window.photosByElieData || null);
      }
    });
  });
})();
