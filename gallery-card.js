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
    const origin = photoOrigin(photo, collectionKey);
    const originLabel = photoOriginLabel(photo, collectionKey, origin);
    const originShortLabel = photoOriginShortLabel(photo, collectionKey, origin);
    const image = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    const title = escapeHtml(photo?.title || photo?.id || "");
    const safeId = escapeHtml(photo?.id || "");
    const hrefAttr = escapeHtml(href);
    const photoClasses = [
      "mock-photo",
      collectionAccent,
      photo?.className || "",
      image ? "has-image" : "",
      rawLabel ? "has-raw-source" : ""
    ].filter(Boolean).join(" ");
    const photoAspectStyle = window.photosByEliePhotoAspectStyle?.(photo) || "";
    const photoOpenLabel = `Open ${title}`;
    const mediaHtml = `
      ${image ? `<img src="${escapeHtml(image)}" alt="${title}"/>` : `<span>${title || escapeHtml(missingLabel)}</span>`}
      ${rawLabel ? `<span class="raw-source-badge" title="${escapeHtml(rawLabel)} source">RAW</span>` : ""}
      <span class="photo-origin-badge is-${escapeHtml(origin)}" title="${escapeHtml(originLabel)}">${escapeHtml(originShortLabel)}</span>
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

  window.photosByElieGalleryCard = {
    escapeHtml,
    renderPhotoCard,
  };
})();
