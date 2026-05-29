(() => {
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));

  const fallbackOrigin = (collectionKey) => (collectionKey === "ai" ? "ai" : "camera");
  const t = (key, fallback) => {
    const translated = window.photosByElieI18n?.t?.(key);
    return translated && translated !== key ? translated : fallback;
  };

  const fallbackOriginLabel = (origin) => (
    origin === "ai" ? t("origin.ai", "AI image") : t("origin.camera", "Camera photo")
  );
  const fallbackOriginShortLabel = (origin) => (origin === "ai" ? "AI" : "Camera");

  const photoOrigin = (photo, collectionKey) => (
    window.photosByEliePhotoOrigin?.(photo, collectionKey) || fallbackOrigin(collectionKey)
  );

  const photoOriginLabel = (photo, collectionKey, origin) => (
    window.photosByEliePhotoOriginLabel?.(photo, collectionKey)
    || fallbackOriginLabel(origin)
  );

  const photoOriginShortLabel = (photo, collectionKey, origin) => (
    window.photosByEliePhotoOriginShortLabel?.(photo, collectionKey)
    || fallbackOriginShortLabel(origin)
  );

  const originBadgeHtml = (origin, originLabel, isVideo = false) => {
    const iconName = isVideo ? "play" : origin === "ai" ? "autoAwesome" : "photoCamera";
    const icon = window.photosByElieMdIcon?.(iconName) || escapeHtml(isVideo ? "Video" : origin === "ai" ? "AI" : "Camera");
    return `<span class="photo-origin-badge is-${escapeHtml(isVideo ? "video" : origin)}" title="${escapeHtml(originLabel)}" aria-label="${escapeHtml(originLabel)}">${icon}<span class="origin-badge-label">${escapeHtml(originLabel)}</span></span>`;
  };

  const readableTextColor = (red, green, blue) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    return luminance > 0.42 ? "#111" : "#fff";
  };

  const applyCaptionColor = (image) => {
    if (!image || image.dataset.captionColorApplied === "true") return;
    const card = image.closest?.(".mock-photo-card");
    const caption = card?.querySelector?.("[data-photo-caption]");
    if (!caption || !image.naturalWidth || !image.naturalHeight) return;
    image.dataset.captionColorApplied = "true";
    try {
      const canvas = document.createElement("canvas");
      const width = 24;
      const height = 24;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        if (Math.max(r, g, b) > 246 || Math.min(r, g, b) < 8) continue;
        red += r;
        green += g;
        blue += b;
        count += 1;
      }
      if (!count) return;
      red = Math.round(red / count);
      green = Math.round(green / count);
      blue = Math.round(blue / count);
      caption.style.setProperty("--caption-bg", `rgb(${red} ${green} ${blue})`);
      caption.style.setProperty("--caption-fg", readableTextColor(red, green, blue));
      caption.style.setProperty("--caption-border", readableTextColor(red, green, blue) === "#111" ? "rgb(0 0 0 / .18)" : "rgb(255 255 255 / .28)");
    } catch {
      image.dataset.captionColorApplied = "blocked";
    }
  };

  const renderPhotoCard = ({
    photo,
    index,
    href = "",
    collectionKey = "",
    collectionAccent = "",
    actionHtml = "",
    ownerEditable = false,
    missingLabel = "",
  }) => {
    const rawLabel = window.photosByElieRawSourceLabel?.(photo) || "";
    const isVideo = window.photosByElieIsVideo?.(photo) === true;
    const origin = photoOrigin(photo, collectionKey);
    const originLabel = isVideo ? "Video" : photoOriginLabel(photo, collectionKey, origin);
    const originShortLabel = isVideo ? "Video" : photoOriginShortLabel(photo, collectionKey, origin);
    const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    const title = escapeHtml(photo?.title || photo?.id || "");
    const safeId = escapeHtml(photo?.id || "");
    const hrefAttr = escapeHtml(href);
    const photoClasses = [
      "mock-photo",
      collectionAccent,
      photo?.className || "",
      image ? "has-image" : "",
      isVideo ? "is-video" : "",
      rawLabel ? "has-raw-source" : ""
    ].filter(Boolean).join(" ");
    const photoAspectStyle = window.photosByEliePhotoAspectStyle?.(photo) || "";
    const photoOpenLabel = `Open ${title}`;
    const mediaHtml = `
      ${image ? `<img src="${escapeHtml(image)}" alt="${title}" crossorigin="anonymous" data-photo-card-image/>` : `<span>${title || escapeHtml(missingLabel)}</span>`}
      ${isVideo ? `<span class="video-card-badge" aria-hidden="true">${window.photosByElieMdIcon?.("play") || "▶"}</span>` : ""}
      ${rawLabel ? `<span class="raw-source-badge" title="${escapeHtml(rawLabel)} source">RAW</span>` : ""}
      ${originBadgeHtml(origin, originLabel, isVideo)}
    `;
    const media = href
      ? `<a class="${photoClasses}" href="${hrefAttr}" data-photo-link aria-label="${photoOpenLabel}"${photoAspectStyle}>${mediaHtml}</a>`
      : `<div class="${photoClasses}" data-photo-link aria-label="${photoOpenLabel}"${photoAspectStyle}>${mediaHtml}</div>`;
    const captionAttrs = ownerEditable
      ? ` data-owner-title-edit aria-label="Edit title for ${title}" title="Edit title"`
      : "";
    const captionClass = `mock-photo-caption${ownerEditable ? " is-owner-editable" : ""}`;
    const caption = href
      ? `<a class="${captionClass}" href="${hrefAttr}" data-photo-caption${captionAttrs}>${title}</a>`
      : `<span class="${captionClass}" data-photo-caption${captionAttrs}>${title}</span>`;

    return `
      <article
        class="mock-photo-card"
        aria-label="${photoOpenLabel}, ${escapeHtml(originLabel)}${rawLabel ? `, RAW source ${escapeHtml(rawLabel)}` : ""}"
        data-photo-index="${index}"
        data-photo-id="${safeId}"
        data-photo-href="${hrefAttr}"
      >
        ${media}
        ${actionHtml}
        ${caption}
      </article>
    `;
  };

  const markPreviewMissing = (image) => {
    if (!image || image.dataset.previewMissing === "true") return;
    image.dataset.previewMissing = "true";
    const media = image.closest?.("[data-photo-link]");
    if (!media) return;
    media.classList.remove("has-image");
    media.classList.add("is-preview-missing");
    const label = document.createElement("span");
    label.className = "missing-preview-label";
    label.textContent = "Preview unavailable";
    label.title = image.alt || "";
    image.replaceWith(label);
  };

  document.addEventListener("error", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.matches("[data-photo-card-image]")) return;
    markPreviewMissing(target);
  }, true);
  document.addEventListener("load", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.matches("[data-photo-card-image]")) return;
    applyCaptionColor(target);
  }, true);

  window.photosByElieGalleryCard = {
    escapeHtml,
    applyCaptionColor,
    originBadgeHtml,
    renderPhotoCard,
  };
})();
