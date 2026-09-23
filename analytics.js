(() => {
  // WST replaces native browser analytics on the approved public storefront.
  // Never create sessions or send storefront events from private/local previews.
  const storefrontPaths = new Set(['/', '/index.html', '/gallery.html', '/photo.html', '/basket.html', '/liked.html', '/order.html', '/campaign.html', '/support.html', '/privacy.html', '/terms.html', '/data-deletion.html']);
  if (storefrontPaths.has(window.location.pathname)) {
    window.photosByElieAnalytics = { enabled: () => false, track: () => {} };
    if (window.location.origin !== 'https://photos-by-elie.com' || window.photosByElieMonitoringPreview
      || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
    const actions = document.createElement('script');
    actions.src = '/wst-actions.js?v=249.0';
    actions.onload = () => {
      const beacon = document.createElement('script');
      beacon.src = '/wst-beacon.js?v=249.0';
      Object.assign(beacon.dataset, { wstEnabled: 'true', wstEndpoint: 'https://web-signals-collector.ec92009.workers.dev/v1/events', wstSite: 'photosbyelie', wstEnvironment: 'production', wstSessionless: 'true', wstConsent: 'not_required' });
      document.body.append(beacon);
    };
    document.body.append(actions);
    return;
  }
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  const OWNER_PATHS = /\/(?:owner|owner-review)\.html$/i;
  const CALLBACK_PATHS = /\/(?:etsy|instagram)-callback\.html$/i;
  const MAX_EVENTS = 20;
  const MAX_STRING = 160;
  const sessionKey = "photosbyelie-analytics-session";

  const cleanString = (value, max = MAX_STRING) => String(value || "")
    .replace(/[^\w .:/?=&%#@+-]/g, "")
    .slice(0, max)
    .trim();

  const cleanPath = (value) => {
    const path = cleanString(value || window.location.pathname, 220).split("#")[0].split("?")[0];
    return path.startsWith("/") ? path : `/${path.replace(/^\/+/, "")}`;
  };

  const isLocal = () => LOCAL_HOSTS.has(window.location.hostname);

  const shouldDisable = () => (
    isLocal()
    || OWNER_PATHS.test(window.location.pathname)
    || CALLBACK_PATHS.test(window.location.pathname)
    || document.body?.hasAttribute("data-real-estate")
    || document.body?.hasAttribute("data-owner-root")
    || navigator.doNotTrack === "1"
    || window.doNotTrack === "1"
    || navigator.globalPrivacyControl === true
  );

  const workerBaseUrl = () => String(
    window.photosByElieMediaConfig?.analyticsWorkerBaseUrl
    || window.photosByElieMediaConfig?.checkoutWorkerBaseUrl
    || ""
  ).replace(/\/+$/, "");

  const enabled = () => Boolean(workerBaseUrl()) && !shouldDisable();

  const sessionId = () => {
    try {
      const existing = sessionStorage.getItem(sessionKey);
      if (existing) return existing;
      const next = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(sessionKey, next);
      return next;
    } catch {
      return "";
    }
  };

  const siteVersion = () => (
    document.querySelector(".site-version-badge")?.textContent?.replace(/^v/i, "")
    || window.photosByElieSiteVersion
    || ""
  );

  const pageType = () => {
    const name = (window.location.pathname.split("/").pop() || "index.html").replace(/\.html$/i, "") || "home";
    if (name === "index") return "home";
    return cleanString(name || "page", 40);
  };

  const context = () => ({
    sessionId: sessionId(),
    version: siteVersion(),
    hostname: window.location.hostname,
    path: cleanPath(window.location.pathname),
    pageType: pageType(),
  });

  const normalizeEvent = (name, data = {}) => ({
    event: cleanString(name, 80).toLowerCase().replace(/[^a-z0-9_:-]/g, "_"),
    ...context(),
    ...Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [
      key,
      typeof value === "string" ? cleanString(value) : value,
    ])),
  });

  const postEvents = (events) => {
    if (!enabled()) return;
    const batch = (Array.isArray(events) ? events : [events]).slice(0, MAX_EVENTS);
    if (!batch.length) return;
    const body = JSON.stringify({ events: batch });
    const endpoint = `${workerBaseUrl()}/analytics/events`;
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }
    } catch {}
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  };

  const track = (name, data = {}) => postEvents([normalizeEvent(name, data)]);

  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  };

  const basketStats = (items = window.photosByElieBasket?.read?.() || []) => {
    const productCount = items.reduce((sum, item) => sum + (Array.isArray(item.options) ? item.options.length : 0), 0);
    const subtotalCents = Math.round(items.reduce((sum, item) => sum + Number(item.total || 0), 0) * 100);
    return {
      basketItemCount: items.length,
      basketProductCount: productCount,
      subtotalCents,
    };
  };

  let lastBasketSignature = "";
  let lastLikedSignature = "";

  const signature = (items) => JSON.stringify((items || []).map((item) => ({
    photoId: item.photoId,
    options: (item.options || []).map((option) => option.id).sort(),
  })));

  const syncInitialState = () => {
    lastBasketSignature = signature(window.photosByElieBasket?.read?.() || []);
    lastLikedSignature = signature(window.photosByElieLiked?.read?.() || []);
  };

  const trackPage = () => {
    const params = new URLSearchParams(window.location.search);
    track("page_view");
    if (window.location.pathname.endsWith("/gallery.html") || document.body?.hasAttribute("data-gallery")) {
      track("gallery_view", { collectionKey: params.get("gallery") || document.body?.dataset.gallery || "" });
    } else if (window.location.pathname.endsWith("/photo.html")) {
      track("photo_view", { photoId: params.get("id") || "" });
    } else if (window.location.pathname.endsWith("/basket.html")) {
      track("basket_view", basketStats());
    } else if (window.location.pathname.endsWith("/order.html")) {
      track("order_view", { status: params.get("checkout") || "" });
    }
  };

  document.addEventListener("click", (event) => {
    if (!enabled()) return;
    const target = event.target?.closest?.("a,button");
    if (!target) return;
    const href = target.getAttribute("href") || "";
    if (target.matches("[data-checkout-guest]")) {
      track("checkout_click", basketStats());
      return;
    }
    if (target.matches("[data-download-file]")) {
      track("download_click", { downloadType: "file" });
      return;
    }
    if (target.matches("[data-download-all-files]")) {
      track("download_click", { downloadType: "all_files" });
      return;
    }
    if (target.matches("[data-download-zip]")) {
      track("download_click", { downloadType: "archive" });
      return;
    }
    try {
      const url = new URL(href, window.location.href);
      if (url.pathname.endsWith("/photo.html")) {
        track("photo_open_click", { photoId: url.searchParams.get("id") || "" });
      } else if (url.pathname.endsWith("/gallery.html")) {
        track("gallery_open_click", { collectionKey: url.searchParams.get("gallery") || target.dataset.galleryKey || "" });
      }
    } catch {}
  }, { capture: true });

  window.addEventListener("photosbyelie:basketchange", (event) => {
    const items = event.detail?.items || [];
    const nextSignature = signature(items);
    if (nextSignature === lastBasketSignature) return;
    lastBasketSignature = nextSignature;
    track("basket_change", basketStats(items));
  });

  window.addEventListener("photosbyelie:likedchange", (event) => {
    const items = event.detail?.items || [];
    const nextSignature = signature(items);
    if (nextSignature === lastLikedSignature) return;
    lastLikedSignature = nextSignature;
    track("liked_change", { itemCount: number(items.length) });
  });

  window.photosByElieAnalytics = {
    enabled,
    track,
  };

  syncInitialState();
  trackPage();
})();
