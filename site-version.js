(() => {
  const script = document.currentScript;
  const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
  const scriptVersion = scriptUrl?.searchParams.get("v");
  const brandVersion = document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1];
  const version = scriptVersion || brandVersion;

  if (!version) return;

  const floatVersionBadge = () => {
    const badge = document.querySelector(".topbar .site-version-badge");
    if (badge && badge.parentElement !== document.body) document.body.append(badge);
  };

  floatVersionBadge();

  const versionedHref = (href) => {
    if (!href || href.startsWith("#")) return href;
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return href;
    }
    if (url.origin !== window.location.origin) return href;
    if (url.protocol !== "http:" && url.protocol !== "https:") return href;
    const isPage = url.pathname.endsWith("/") || url.pathname.endsWith(".html");
    if (!isPage) return href;
    url.searchParams.set("v", version);
    return url.href;
  };

  const versionElement = (element) => {
    if (element.matches?.("a[href]")) {
      const nextHref = versionedHref(element.getAttribute("href"));
      if (nextHref) element.setAttribute("href", nextHref);
    }
    if (element.matches?.("[data-href]")) {
      const nextHref = versionedHref(element.dataset.href);
      if (nextHref) element.dataset.href = nextHref;
    }
  };

  const versionInternalLinks = (root = document) => {
    root.querySelectorAll?.("a[href], [data-href]").forEach(versionElement);
  };

  const isClientLoginHref = (href) => {
    if (!href || href.startsWith("#")) return false;
    try {
      const url = new URL(href, window.location.href);
      return url.origin === window.location.origin
        && url.pathname.endsWith("/real-estate.html")
        && url.searchParams.get("logout") === "1";
    } catch {
      return false;
    }
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const wasClientLogin = isClientLoginHref(anchor.getAttribute("href"));
    versionElement(anchor);
    if (wasClientLogin || isClientLoginHref(anchor.getAttribute("href"))) {
      event.preventDefault();
      window.location.assign(anchor.href);
    }
  }, true);

  window.photosByElieVersionedHref = versionedHref;
  window.photosByElieVersionInternalLinks = versionInternalLinks;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => versionInternalLinks(), { once: true });
  } else {
    versionInternalLinks();
  }
})();
