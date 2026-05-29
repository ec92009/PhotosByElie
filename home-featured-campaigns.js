(() => {
  const grid = document.querySelector("[data-featured-campaign-grid]");
  if (!grid) return;

  const scriptUrl = new URL(document.currentScript?.src || window.location.href, window.location.href);
  const version = scriptUrl.searchParams.get("v") || document.querySelector(".site-version-badge")?.textContent?.replace(/^v/i, "") || "";
  const indexUrl = `./assets/campaigns/index.json${version ? `?v=${encodeURIComponent(version)}` : ""}`;
  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));

  const platformLabel = (source = "") => {
    const normalized = String(source).trim();
    if (/instagram/i.test(normalized)) return "Instagram";
    if (/facebook/i.test(normalized)) return "Facebook";
    if (/pinterest/i.test(normalized)) return "Pinterest";
    return normalized || "Photos By Elie";
  };

  const summary = (item) => {
    const count = Number(item.primaryPhotoCount) || 0;
    const prefix = count ? `${count}-photo edit` : "Campaign edit";
    const description = String(item.description || "").replace(/\s+/g, " ").trim();
    return description ? `${prefix}: ${description}` : prefix;
  };

  const renderCampaign = (item) => {
    const href = versionedHref(item.href || `./campaign.html?c=${encodeURIComponent(item.id)}`);
    const frames = JSON.stringify(Array.isArray(item.previewImageUrls) ? item.previewImageUrls : []).replace(/"/g, "&quot;");
    return `
      <a class="featured-campaign-card" href="${escapeHtml(href)}" data-campaign-id="${escapeHtml(item.id)}" data-preview-frames="${frames}">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.imageAlt || item.title)}" loading="lazy"/>` : ""}
        <span>
          <em class="featured-campaign-platform">${escapeHtml(platformLabel(item.source))}</em>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(summary(item))}</small>
        </span>
      </a>
    `;
  };

  fetch(indexUrl, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Campaign index unavailable: ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const campaigns = Array.isArray(payload.campaigns) ? payload.campaigns : [];
      if (!campaigns.length) return;
      grid.innerHTML = campaigns.map(renderCampaign).join("");
      window.dispatchEvent(new CustomEvent("photosbyelie:featuredcampaignsrendered", { detail: { count: campaigns.length } }));
    })
    .catch(() => {
      window.dispatchEvent(new CustomEvent("photosbyelie:featuredcampaignsrendered", { detail: { count: grid.querySelectorAll(".featured-campaign-card").length } }));
    });
})();
