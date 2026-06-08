(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const enabled = localHosts.has(window.location.hostname);

  const status = document.querySelector("[data-title-keyword-review-status]");
  const lockedPanel = document.querySelector("[data-title-keyword-review-locked]");
  const summaryRoot = document.querySelector("[data-title-keyword-review-summary]");
  const root = document.querySelector("[data-title-keyword-review-root]");

  const queueUrl = "./assets/owner-actions/title-keyword-review-queue/latest.json";
  const helperQueueUrl = "/__photosbyelie/title-keyword-review-queue";
  const blacklistUrl = "./assets/owner-actions/keyword-blacklist.json";
  const approvalsEndpoint = "/__photosbyelie/photo-action";
  const ownerReviewReturnStateKey = "photosbyelie-owner-review-return-state";
  const ownerReviewDetailPhotoStateKey = "photosbyelie-owner-review-detail-photo";
  const ownerReviewReturnMaxAgeMs = 1000 * 60 * 60 * 2;
  const titleReviewDensityKey = "photosbyelie-title-review-cull-density";
  const titleReviewFitModeKey = "photosbyelie-title-review-cull-fit-mode";
  const titleReviewInitialRenderCount = 48;
  const titleReviewShowMoreSmallCount = 24;
  const titleReviewShowMoreLargeCount = 48;
  const titleReviewModes = new Set(["cull", "edit"]);
  const stateKeywordFlags = new Set([
    "title_keywords_reviewed",
    "title_keywords_proposed",
    "title_keywords_rejected",
    "title_keywords_parked",
  ]);
  const rejectReasons = [
    { value: "incorrect", label: "incorrect", note: "this title is incorrect" },
    { value: "generic", label: "too generic", note: "too generic; make the title more specific" },
    { value: "placeholder", label: "placeholder", note: "too placeholder-y; replace with a real title" },
    { value: "keywords", label: "use keywords", note: "use the existing keywords as clues" },
    { value: "detail", label: "add details", note: "dig up more details" },
    { value: "shoot", label: "use shoot", note: "use other photos in the 2-3 hour window for clues" },
    { value: "other", label: "other", note: "what should change?" },
  ];
  const rejectReasonByValue = new Map(rejectReasons.map((reason) => [reason.value, reason]));
  const legacyRejectReasonNotes = new Map([
    ["incorrect", "incorrect"],
    ["too generic", "generic"],
    ["generic", "generic"],
    ["too placeholder-y", "placeholder"],
    ["too placeholder", "placeholder"],
    ["placeholder", "placeholder"],
    ["use the hints in the keywords to provide a decent title", "keywords"],
    ["needs detail", "detail"],
    ["use other photos in the shoot as clues", "shoot"],
    ["other:", "other"],
  ]);

  const escapeHtml = (value) => String(value ?? "")
    .replace(/[&<>'\"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;",
    }[char] || char));
  const formatCount = (value) => Number(value || 0).toLocaleString();

  const uniqueKeywords = (items) => {
    const seen = new Set();
    const next = [];
    for (const item of items || []) {
      const value = String(item || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(value);
    }
    return next;
  };

  const splitKeywordText = (raw) => String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const parseCaptureTime = (raw) => {
    const value = String(raw || "").trim();
    if (!value) return NaN;
    const normalized = value.replace(
      /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
      "$1-$2-$3T$4:$5:$6",
    );
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const downloadJson = (filename, payload) => {
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
  const normalizedReviewMode = (value) => titleReviewModes.has(String(value || "").toLowerCase())
    ? String(value || "").toLowerCase()
    : "";
  const initialReviewMode = () => normalizedReviewMode(new URLSearchParams(window.location.search).get("mode"))
    || normalizedReviewMode(new URLSearchParams(window.location.search).get("returnMode"))
    || "cull";
  let reviewMode = initialReviewMode();
  const ownerReviewReturnHrefFor = (photoId, scrollY = null, mode = reviewMode) => {
    const params = new URLSearchParams({ view: "title-keywords" });
    if (photoId) params.set("returnPhoto", photoId);
    const cleanMode = normalizedReviewMode(mode);
    if (cleanMode) params.set("mode", cleanMode);
    const savedScrollY = Number(scrollY);
    if (Number.isFinite(savedScrollY) && savedScrollY >= 0) params.set("returnScroll", String(Math.round(savedScrollY)));
    return `./owner-review.html?${params.toString()}`;
  };
  const detailHrefForReviewPhoto = (photoId, mode = reviewMode) => {
    const params = new URLSearchParams({
      id: photoId,
      from: "owner-review",
      returnView: "title-keywords",
      returnPhoto: photoId,
    });
    const cleanMode = normalizedReviewMode(mode);
    if (cleanMode) params.set("returnMode", cleanMode);
    return versionedHref(`./photo.html?${params.toString()}`);
  };
  const clearOwnerReviewReturnUrl = () => {
    const current = new URL(window.location.href);
    if (!current.searchParams.has("returnPhoto") && !current.searchParams.has("returnView")) return;
    current.searchParams.delete("returnPhoto");
    current.searchParams.delete("returnView");
    current.searchParams.delete("returnScroll");
    current.searchParams.delete("returnMode");
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
  };
  const readOwnerReviewReturnState = () => {
    try {
      const payload = JSON.parse(sessionStorage.getItem(ownerReviewReturnStateKey) || "null");
      if (
        payload?.source === "owner-review"
        && payload.view === "title-keywords"
        && Date.now() - Number(payload.createdAt || 0) < ownerReviewReturnMaxAgeMs
      ) {
        return payload;
      }
    } catch {}
    return null;
  };
  const pendingOwnerReviewReturn = () => {
    const query = new URLSearchParams(window.location.search);
    const photoId = String(query.get("returnPhoto") || "").trim();
    const queryScrollY = Number(query.get("returnScroll"));
    const queryMode = normalizedReviewMode(query.get("mode") || query.get("returnMode"));
    const payload = readOwnerReviewReturnState();
    if (payload || photoId) {
      return {
        ...payload,
        photoId: String(payload?.photoId || photoId || "").trim(),
        scrollY: Number.isFinite(Number(payload?.scrollY)) ? Number(payload?.scrollY) : queryScrollY,
        mode: normalizedReviewMode(payload?.mode || payload?.returnMode || queryMode),
      };
    }
    return null;
  };

  const loadJson = async (url) => {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(`Could not load ${url}`);
    }
    return payload;
  };

  const loadReviewQueue = async () => {
    if (enabled) {
      try {
        const queue = await loadJson(helperQueueUrl);
        if (queue?.ok !== false) {
          return {
            queue,
            sourceHref: queue?.proposal_files?.batch || helperQueueUrl,
          };
        }
      } catch {
        // Plain static servers do not expose the Owner SQLite helper endpoint.
      }
    }
    return {
      queue: await loadJson(queueUrl),
      sourceHref: queueUrl,
    };
  };

  const keywordBlacklistSet = (payload) => {
    const keywords = payload?.keywords;
    if (!Array.isArray(keywords)) return new Set();
    return new Set(keywords.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  };

  const normalizeKeywords = (raw, blacklist) => uniqueKeywords(splitKeywordText(raw))
    .filter((keyword) => {
      const normalized = keyword.toLowerCase();
      return !blacklist.has(normalized) && !stateKeywordFlags.has(normalized);
    });

  const rejectedProposalCommentMarker = "Rejected proposal:";
  const stripRejectedProposalContext = (value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    const index = text.toLowerCase().indexOf(`\n\n${rejectedProposalCommentMarker.toLowerCase()}`);
    return (index >= 0 ? text.slice(0, index) : text).trim();
  };
  const commentWithRejectedProposalContext = ({ comment, title, keywords }) => {
    const ownerComment = stripRejectedProposalContext(comment);
    if (!ownerComment) return "";
    const cleanTitle = String(title || "").trim();
    const cleanKeywords = uniqueKeywords(keywords || []);
    if (!cleanTitle && !cleanKeywords.length) return ownerComment;
    return [
      ownerComment,
      "",
      rejectedProposalCommentMarker,
      `Title: ${cleanTitle || "(blank)"}`,
      `Keywords: ${cleanKeywords.join(", ") || "(none)"}`,
    ].join("\n");
  };

  const cleanModelName = (value) => String(value || "").trim();

  const rejectReasonCheckboxesHtml = (selectedValue = "") => rejectReasons
    .map((reason) => `
      <label class="title-keyword-review-reject-option" data-review-reject-option>
        <input type="checkbox" value="${escapeHtml(reason.value)}" data-review-reject-reason${reason.value === selectedValue ? " checked" : ""}/>
        <span>${escapeHtml(reason.label)}</span>
      </label>
    `)
    .join("");

  const rejectReasonValueForComment = (comment) => {
    const normalized = String(comment || "").trim().toLowerCase();
    if (!normalized) return "";
    const exact = rejectReasons.find((reason) => reason.note.trim().toLowerCase() === normalized);
    if (exact) return exact.value;
    if (legacyRejectReasonNotes.has(normalized)) return legacyRejectReasonNotes.get(normalized) || "";
    if (normalized.startsWith("other:")) return "other";
    return "other";
  };

  const checkedRejectReasonValue = (rootNode) => String(rootNode?.querySelector?.("[data-review-reject-reason]:checked")?.value || "");

  const setRejectReasonValue = (rootNode, value = "") => {
    rootNode?.querySelectorAll?.("[data-review-reject-reason]").forEach((input) => {
      input.checked = Boolean(value) && input.value === value;
    });
  };

  const setRejectReasonsDisabled = (rootNode, disabled) => {
    rootNode?.querySelectorAll?.("[data-review-reject-reason]").forEach((input) => {
      input.disabled = Boolean(disabled);
      input.closest("label")?.classList.toggle("is-disabled", Boolean(disabled));
    });
  };

  const generatorDetails = (generator, fallback = {}) => {
    const source = generator && typeof generator === "object" ? generator : {};
    const backup = fallback && typeof fallback === "object" ? fallback : {};
    const model = cleanModelName(source.model || backup.generator_model || backup.model);
    const rawLevel = source.model_level ?? backup.generator_model_level ?? backup.model_level;
    const numericLevel = Number(rawLevel);
    return {
      model,
      level: Number.isFinite(numericLevel) ? numericLevel : null,
      maxed: source.model_maxed === true || backup.generator_model_maxed === true || backup.model_maxed === true,
    };
  };

  const modelDisplayName = (details) => {
    const model = cleanModelName(details?.model);
    if (!model) return "Missing / legacy provenance";
    if (model === "local-metadata-rules-v1") return "local-metadata-rules-v1";
    return model;
  };

  const modelMetaText = (details) => {
    const parts = [];
    if (Number.isFinite(details?.level)) parts.push(`level ${details.level}`);
    if (details?.model === "local-metadata-rules-v1") parts.push("no AI model");
    if (details?.maxed) parts.push("ladder max");
    return parts.join(" · ");
  };

  const modelLineHtml = (label, details) => {
    const meta = modelMetaText(details);
    return `
      <p>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(modelDisplayName(details))}</strong>
        ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
      </p>
    `;
  };

  const proposalModelHtml = (item) => {
    const actual = generatorDetails(item?.proposed?.generator, item?.proposed);
    const requested = generatorDetails(item?.state?.requested_generator || item?.state?.requestedGenerator);
    const previous = generatorDetails(item?.state?.previous_generator || item?.state?.previousGenerator);
    const lines = [modelLineHtml("Model used", actual)];
    if (previous.model) lines.push(modelLineHtml("Previous", previous));
    if (requested.model && requested.model !== actual.model) lines.push(modelLineHtml("Requested next", requested));
    return `<div class="title-keyword-review-model">${lines.join("")}</div>`;
  };

  const currentKeywordMarkup = (item) => {
    const keywords = Array.isArray(item?.current?.keywords)
      ? item.current.keywords
      : splitKeywordText(item?.current?.keywords_raw || "");
    const removed = new Set((item?.changes?.removed_blacklisted || [])
      .map((keyword) => String(keyword || "").trim().toLowerCase())
      .filter(Boolean));
    if (!keywords.length) return escapeHtml("No current keywords");
    return keywords.map((keyword) => {
      const value = String(keyword || "").trim();
      if (!value) return "";
      const escaped = escapeHtml(value);
      return removed.has(value.toLowerCase())
        ? `<span class="title-keyword-review-removed-keyword" title="Blacklisted keyword removed from proposal">${escaped}</span>`
        : escaped;
    }).filter(Boolean).join(", ");
  };

  const publicMediaUrl = (key) => {
    const base = String(window.photosByEliePublicMediaBase || "").replace(/\/+$/, "");
    const cleanKey = String(key || "").replace(/^\/+/, "");
    return base && cleanKey ? `${base}/${cleanKey}` : "";
  };

  const reviewThumbUrl = (item) => {
    const key = item?.thumbs?.gallery_key || item?.thumbs?.galleryKey || item?.thumbs?.detail_key || item?.thumbs?.detailKey;
    return publicMediaUrl(key);
  };

  const reviewDetailKey = (item) => item?.thumbs?.detail_key || item?.thumbs?.detailKey || item?.thumbs?.gallery_key || item?.thumbs?.galleryKey || "";
  const reviewDetailUrl = (item) => publicMediaUrl(reviewDetailKey(item)) || reviewThumbUrl(item);

  const videoExtensions = new Set(["mov", "mp4", "m4v", "webm"]);
  const looksLikeVideoValue = (value) => {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return false;
    if (text === "video") return true;
    return videoExtensions.has(text.replace(/^\./, ""));
  };

  const reviewItemIsVideo = (item) => {
    if (window.photosByElieIsVideo?.(item) === true) return true;
    const typedValues = [
      item?.media?.type,
      item?.type,
      item?.source?.type,
      item?.source?.file?.type,
      item?.source?.media_type,
      item?.source?.mediaType,
      item?.current?.type,
    ];
    if (typedValues.some(looksLikeVideoValue)) return true;
    const pathValues = [
      item?.source?.file?.path,
      item?.source?.path,
      item?.media?.path,
      item?.current?.path,
    ];
    return pathValues.some((value) => {
      const match = String(value || "").toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
      return match ? videoExtensions.has(match[1]) : false;
    });
  };

  const reviewDetailPhotoPayload = (item, card, blacklist, batchId) => {
    const photoId = String(item?.photo_id || item?.photoId || card?.dataset?.reviewPhotoId || "").trim();
    if (!photoId) return null;
    const currentTitle = String(item?.current?.title || photoId).trim() || photoId;
    const proposedTitle = String(card?.querySelector?.("[data-review-title]")?.value || item?.proposed?.title || currentTitle).trim() || currentTitle;
    const currentKeywords = normalizeKeywords(
      Array.isArray(item?.current?.keywords) ? item.current.keywords.join(", ") : item?.current?.keywords_raw || "",
      blacklist,
    );
    const proposedKeywords = normalizeKeywords(
      card?.querySelector?.("[data-review-keywords]")?.value
        || (Array.isArray(item?.proposed?.keywords) ? item.proposed.keywords.join(", ") : ""),
      blacklist,
    );
    const galleryKey = String(item?.gallery?.key || item?.gallery_key || card?.dataset?.reviewGalleryKey || "owner-review").trim() || "owner-review";
    const galleryLabel = String(item?.gallery?.label || item?.gallery_label || galleryKey || "Owner review").trim();
    const capture = String(item?.capture?.raw || item?.capture?.date || "").trim();
    const sourceFile = item?.source?.file && typeof item.source.file === "object" ? item.source.file : {};
    const sourcePath = String(sourceFile.path || item?.source?.path || "").trim();
    const sourceType = String(sourceFile.type || item?.source?.type || "").trim().toUpperCase();
    const isVideo = reviewItemIsVideo(item);
    const galleryKeyValue = item?.thumbs?.gallery_key || item?.thumbs?.galleryKey || "";
    const detailKeyValue = reviewDetailKey(item);
    const metadata = [
      { label: "Gallery", value: galleryLabel },
      capture ? { label: "Captured", value: capture } : null,
      { label: "Metadata title", value: proposedTitle },
      { label: "Keywords", value: proposedKeywords.join(", ") || currentKeywords.join(", ") },
      currentTitle !== proposedTitle ? { label: "Current title", value: currentTitle } : null,
      currentKeywords.length ? { label: "Current keywords", value: currentKeywords.join(", ") } : null,
      sourcePath ? { label: "Original file", value: sourcePath.split("/").pop() || sourcePath } : null,
    ].filter(Boolean);
    return {
      source: "owner-review",
      view: "title-keywords",
      mode: reviewMode,
      photoId,
      batchId: String(card?.dataset?.reviewBatchId || batchId || "").trim(),
      collectionKey: galleryKey,
      collectionTitle: galleryLabel,
      createdAt: Date.now(),
      photo: {
        id: photoId,
        className: "p1",
        title: proposedTitle,
        caption: [galleryLabel, capture.slice(0, 10)].filter(Boolean).join(" / "),
        full: sourceType ? `${sourceType} source` : "Owner review source",
        megapixels: 0,
        sourceOrigin: galleryKey === "ai" ? "ai" : "camera",
        pricingTier: galleryKey === "ai" ? "ai" : "original",
        gallerySrc: reviewThumbUrl(item),
        imageSrc: reviewDetailUrl(item),
        metadata,
        media: {
          type: isVideo ? "video" : "photo",
          sourcePolicy: "owner-review",
          publicPreview: {
            allowed: true,
            galleryKey: galleryKeyValue,
            detailKey: detailKeyValue,
            galleryUrl: reviewThumbUrl(item),
            detailUrl: reviewDetailUrl(item),
          },
        },
        sourceFiles: sourcePath ? [{ path: sourcePath, type: sourceType || "SOURCE" }] : [],
      },
    };
  };

  const savedReviewIds = (payload) => {
    const ids = new Set();
    for (const key of ["approvals", "rejections", "blocked"]) {
      for (const item of payload?.[key] || []) {
        const photoId = String(item?.photo_id || item?.photoId || "").trim();
        if (photoId) ids.add(photoId);
      }
    }
    return ids;
  };

  const warmReviewThumbnails = (items) => {
    const urls = uniqueKeywords(items.map(reviewThumbUrl).filter(Boolean));
    let nextIndex = 0;
    const loadNext = () => {
      if (nextIndex >= urls.length) return;
      const image = new Image();
      image.decoding = "async";
      image.onload = loadNext;
      image.onerror = loadNext;
      image.src = urls[nextIndex];
      nextIndex += 1;
    };
    for (let worker = 0; worker < Math.min(6, urls.length); worker += 1) {
      loadNext();
    }
  };

  const scheduleThumbnailWarmup = (items) => {
    const run = () => warmReviewThumbnails(items);
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 750 });
      return;
    }
    window.setTimeout(run, 150);
  };

  const render = async () => {
    if (!enabled) {
      lockedPanel.hidden = false;
      summaryRoot.hidden = true;
      root.replaceChildren();
      if (status) status.textContent = "localhost-only";
      return;
    }

    status.textContent = "Loading queue…";
    lockedPanel.hidden = true;
    summaryRoot.hidden = true;

    const [queueResult, blacklistPayload] = await Promise.all([
      loadReviewQueue(),
      loadJson(blacklistUrl).catch(() => ({ keywords: [] })),
    ]);
    const queue = queueResult.queue;
    const queueHref = queueResult.sourceHref || queueUrl;

    const batchId = String(queue?.batch_id || queue?.batchId || "").trim();
    const reviewScope = String(queue?.review_scope || queue?.reviewScope || "").trim();
    const pendingBatchCount = Array.isArray(queue?.pending_batches)
      ? queue.pending_batches.filter((item) => Number(item?.pending_count || 0) > 0).length
      : 0;
    const photos = Array.isArray(queue?.photos) ? queue.photos : [];
    const blacklist = keywordBlacklistSet(blacklistPayload);
    const shootWindowMs = 2 * 60 * 60 * 1000;

    if (!batchId || !photos.length) {
      status.textContent = "Queue is empty.";
      summaryRoot.hidden = true;
      root.replaceChildren();
      return;
    }

    const sqliteBackedQueue = queue?.queue_source === "owner-sqlite-helper";
    const approvalRecord = sqliteBackedQueue
      ? {}
      : await loadJson(`./assets/owner-actions/title-keyword-review-queue/approvals-${encodeURIComponent(batchId)}.json`).catch(() => ({}));
    const savedIds = sqliteBackedQueue ? new Set() : savedReviewIds(approvalRecord);
    const captureTimeForPhoto = (item) => parseCaptureTime(
      item?.capture?.raw || item?.capture?.date || item?.capture?.sort || "",
    );
    const visiblePhotos = photos
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const photoId = String(item?.photo_id || item?.photoId || "");
        return photoId && !savedIds.has(photoId);
      })
      .sort((left, right) => {
        const leftTime = captureTimeForPhoto(left.item);
        const rightTime = captureTimeForPhoto(right.item);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
          return leftTime - rightTime || left.index - right.index;
        }
        if (Number.isFinite(leftTime)) return -1;
        if (Number.isFinite(rightTime)) return 1;
        return left.index - right.index;
      })
      .map(({ item }) => item);
    const selection = queue?.selection && typeof queue.selection === "object" ? queue.selection : {};
    const totalReviewCount = Math.max(Number(selection.total_count || 0), visiblePhotos.length);
    const sqlitePendingCount = Number(selection.sqlite_pending_count || 0);
    const backlogTotalCount = Number(selection.incomplete_backlog_count || 0);
    const backlogLoadedCount = Number(selection.incomplete_backlog_loaded_count || 0) || Math.max(0, visiblePhotos.length - sqlitePendingCount);
    const loadedReviewCount = visiblePhotos.length;
    let shownReviewCount = Math.min(titleReviewInitialRenderCount, loadedReviewCount);
    const currentVisiblePhotos = () => visiblePhotos.slice(0, shownReviewCount);
    const queueStatusText = () => {
      if (!loadedReviewCount) return "All rows in this batch are already saved.";
      const loadedText = totalReviewCount > loadedReviewCount
        ? ` Showing ${formatCount(shownReviewCount)} of ${formatCount(loadedReviewCount)} loaded; ${formatCount(totalReviewCount - loadedReviewCount)} more remain after this window.`
        : ` Showing ${formatCount(shownReviewCount)} of ${formatCount(loadedReviewCount)}.`;
      return `${formatCount(totalReviewCount)} media items need review.${loadedText}`;
    };
    const newest = queue?.range?.newest || "";
    const oldest = queue?.range?.oldest || "";
    status.textContent = visiblePhotos.length
      ? queueStatusText()
      : "All rows in this batch are already saved.";

    summaryRoot.hidden = false;
    const summaryHeading = reviewScope === "all-pending"
      ? "All media needing review"
      : `Batch ${batchId}`;
    const summaryCounts = reviewScope === "all-pending"
      ? `<p class="gallery-status">Generated proposals: ${formatCount(sqlitePendingCount)} • Backlog needing review: ${formatCount(backlogTotalCount)} total, ${formatCount(backlogLoadedCount)} loaded • Queues: ${formatCount(pendingBatchCount)}</p>`
      : "";

    summaryRoot.innerHTML = `
      <h2>${escapeHtml(summaryHeading)}</h2>
      ${summaryCounts}
      <p class="gallery-status">Oldest: ${escapeHtml(oldest || "—")} • Newest: ${escapeHtml(newest || "—")}</p>
      <div class="cta title-keyword-review-actions">
        <button class="btn secondary" type="button" data-title-keyword-review-approve-all>Approve visible</button>
        <button class="btn secondary" type="button" data-title-keyword-review-save>Apply selected</button>
        <button class="btn secondary" type="button" data-title-keyword-review-download>Export selected JSON</button>
        <a class="btn secondary" href="${escapeHtml(queueHref)}" target="_blank" rel="noreferrer">Open proposal source</a>
      </div>
      <p class="gallery-status">Rows autosave as soon as you approve, reject, block, or edit. Apply selected updates catalog metadata for checked approvals, queues checked rejections for rework, and moves checked blocks to the Waste Basket.</p>
    `;

    root.replaceChildren();
    const modebar = document.createElement("div");
    modebar.className = "title-review-cull-toolbar";
    modebar.innerHTML = `
      <div class="title-review-mode-toggle" role="group" aria-label="Review mode">
        <button type="button" data-title-review-mode="cull">Cull</button>
        <button type="button" data-title-review-mode="edit">Edit</button>
      </div>
      <label class="gallery-density-control title-review-density-control">
        <span>Grid</span>
        <input type="range" min="2" max="14" step="1" value="7" data-title-review-density/>
        <b data-title-review-density-value>7</b>
      </label>
      <div class="gallery-fit-control title-review-fit-control" role="group" aria-label="Image layout">
        <button type="button" data-gallery-fit-mode="fit">Fit</button>
        <button type="button" data-gallery-fit-mode="fill">Fill</button>
        <button type="button" data-gallery-fit-mode="cull">Cull</button>
      </div>
      <button class="btn secondary title-review-import-edits" type="button" data-title-review-import-edits>Import edits</button>
      <p class="title-review-selection-status" data-title-review-selection-count>0 selected</p>
    `;
    root.append(modebar);
    const cullShell = document.createElement("div");
    cullShell.className = "title-review-cull-shell";
    const list = document.createElement("div");
    list.className = "title-keyword-review-list";
    cullShell.append(list);
    const cullPanel = document.createElement("aside");
    cullPanel.className = "title-review-cull-side-panel";
    cullPanel.setAttribute("aria-live", "polite");
    cullShell.append(cullPanel);
    root.append(cullShell);

    const cardById = new Map();
    const reviewItemById = new Map();
    visiblePhotos.forEach((item) => {
      const photoId = String(item?.photo_id || item?.photoId || "").trim();
      if (photoId) reviewItemById.set(photoId, item);
    });

    list.innerHTML = visiblePhotos.map((item, index) => {
      const photoId = String(item?.photo_id || item?.photoId || "");
      const photoBatchId = String(item?.batch_id || item?.proposal_batch_id || batchId || "");
      const title = String(item?.current?.title || "");
      const capture = String(item?.capture?.raw || item?.capture?.date || "");
      const galleryLabel = String(item?.gallery?.label || item?.gallery_label || item?.gallery_key || "");
      const galleryKey = String(item?.gallery?.key || item?.gallery_key || item?.gallery?.label || galleryLabel || "");
      const captureTime = parseCaptureTime(capture);
      const thumb = reviewThumbUrl(item);
      const isVideo = reviewItemIsVideo(item);
      const fetchPriority = index < 12 ? "high" : "low";
      const currentKeywords = Array.isArray(item?.current?.keywords) ? item.current.keywords.join(", ") : String(item?.current?.keywords_raw || "");
      const currentKeywordList = normalizeKeywords(currentKeywords, blacklist);
      const currentKeywordsHtml = currentKeywordMarkup(item);
      const proposedTitle = String(item?.proposed?.title || title || "");
      const previousRejectComment = stripRejectedProposalContext(String(
        item?.state?.rework_comment
        || item?.state?.reworkComment
        || item?.state?.latest_rejection_comment
        || item?.state?.latestRejectionComment
        || item?.state?.owner_comment
        || item?.state?.ownerComment
        || "",
      ));
      const previousRejectReason = rejectReasonValueForComment(previousRejectComment);
      const rawProposedKeywords = normalizeKeywords(
        Array.isArray(item?.proposed?.keywords) ? item.proposed.keywords.join(", ") : currentKeywords,
        blacklist,
      );
      const proposedKeywordList = rawProposedKeywords.length < currentKeywordList.length
        ? uniqueKeywords([...currentKeywordList, ...rawProposedKeywords])
        : rawProposedKeywords;
      const proposedKeywords = proposedKeywordList.join(", ");
      const titleInputId = `review-title-${index}`;
      const keywordsInputId = `review-keywords-${index}`;
      const href = detailHrefForReviewPhoto(photoId);
      const previewClasses = [
        "title-keyword-review-preview",
        thumb ? "has-image" : "is-missing-preview",
        isVideo ? "is-video" : "",
      ].filter(Boolean).join(" ");
      return `
        <article class="title-keyword-review-row${isVideo ? " is-video" : ""}" data-review-photo-id="${escapeHtml(photoId)}" data-photo-index="${index}" data-review-batch-id="${escapeHtml(photoBatchId)}" data-review-gallery-key="${escapeHtml(galleryKey)}" data-review-capture-time="${Number.isFinite(captureTime) ? String(captureTime) : ""}" data-review-detail-href="${escapeHtml(href)}" data-review-previous-reject-reason="${escapeHtml(previousRejectReason)}" tabindex="0"${index >= shownReviewCount ? " hidden" : ""}>
          <a class="${previewClasses}" href="${escapeHtml(href)}" aria-label="Open ${isVideo ? "video" : "photo"} ${escapeHtml(photoId)}">
            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(title || photoId)}" loading="eager" decoding="async" fetchpriority="${fetchPriority}"/>` : `<span class="unknown-missing-preview">No preview</span>`}
            ${isVideo ? `<span class="title-keyword-review-video-badge" aria-hidden="true">${window.photosByElieMdIcon?.("play") || "▶"}</span>` : ""}
          </a>
          <div class="title-keyword-review-current">
            <p class="eyebrow">${escapeHtml(galleryLabel || "Photo")}${capture ? ` / ${escapeHtml(capture)}` : ""}</p>
            <h2>${escapeHtml(title || photoId)}</h2>
            <p>${currentKeywordsHtml}</p>
          </div>
          <div class="title-keyword-review-cull-meta">
            <p class="eyebrow">${isVideo ? "Video" : "Photo"} / ${escapeHtml(galleryLabel || "Review")}</p>
            <h3>${escapeHtml(proposedTitle || title || photoId)}</h3>
            <p>${escapeHtml(proposedKeywords || currentKeywords || "No keywords")}</p>
          </div>
          <form class="title-keyword-review-proposed" data-review-editor autocomplete="off">
              <div class="title-keyword-review-field">
                <div class="title-keyword-review-field-heading">
                  <label for="${titleInputId}">Proposed title</label>
                  <button class="title-keyword-review-propagate-field" type="button" data-review-propagate-field="title" aria-label="Propagate proposed title down" title="Propagate this title to current and following rows in the same two-hour shoot window">↓</button>
                </div>
                <input id="${titleInputId}" type="text" value="${escapeHtml(proposedTitle)}" data-review-title/>
              </div>
              <div class="title-keyword-review-field">
                <div class="title-keyword-review-field-heading">
                  <label for="${keywordsInputId}">Proposed keywords</label>
                  <button class="title-keyword-review-propagate-field" type="button" data-review-propagate-field="keywords" aria-label="Propagate proposed keywords down" title="Propagate these keywords to current and following rows in the same two-hour shoot window">↓</button>
                </div>
                <textarea id="${keywordsInputId}" rows="3" data-review-keywords>${escapeHtml(proposedKeywords)}</textarea>
              </div>
              ${proposalModelHtml(item)}
          </form>
          <div class="title-keyword-review-approve title-keyword-review-decision">
            <label>
              <input type="checkbox" data-review-approve/>
              <span>Approve</span>
            </label>
            <label class="title-keyword-review-block-choice" title="Move this photo to the Waste Basket and record it as blocked (H/X)">
              <input type="checkbox" data-review-block/>
              <span>Block</span>
            </label>
            <input type="checkbox" data-review-reject hidden/>
            <div class="title-keyword-review-reject-reasons" role="group" aria-label="Reject reason">
              <p>Reject</p>
              ${rejectReasonCheckboxesHtml(previousRejectReason)}
            </div>
            <label class="title-keyword-review-reject-comment">
              <span>Reject note</span>
              <textarea rows="2" data-review-reject-comment placeholder="What should change?">${escapeHtml(previousRejectComment)}</textarea>
            </label>
            <p class="title-keyword-review-row-status" data-review-row-status>Not saved</p>
            <div class="title-keyword-review-row-tools">
              <button type="button" data-review-propagate title="Apply this row's approve/reject/block choice, including reject note, to current and following rows in the same two-hour shoot window">Propagate</button>
            </div>
          </div>
        </article>
      `;
    }).join("");

    scheduleThumbnailWarmup(currentVisiblePhotos());

    list.querySelectorAll("[data-review-photo-id]").forEach((card) => {
      const photoId = card.getAttribute("data-review-photo-id") || "";
      if (!photoId) return;
      cardById.set(photoId, card);
    });
    const bottomActions = document.createElement("div");
    bottomActions.className = "title-keyword-review-bottom-actions";
    bottomActions.innerHTML = `
      <div class="title-keyword-review-pagination">
        <p data-title-keyword-review-page-status></p>
        <button class="btn secondary" type="button" data-title-keyword-review-show-more="${titleReviewShowMoreSmallCount}">Show ${titleReviewShowMoreSmallCount} more</button>
        <button class="btn secondary" type="button" data-title-keyword-review-show-more="${titleReviewShowMoreLargeCount}">Show ${titleReviewShowMoreLargeCount} more</button>
      </div>
      <button class="btn secondary" type="button" data-title-keyword-review-approve-all>Approve visible</button>
      <button class="btn secondary" type="button" data-title-keyword-review-save>Apply selected</button>
      <button class="btn secondary" type="button" data-title-keyword-review-download>Export selected JSON</button>
    `;
    root.append(bottomActions);
    const pageStatus = bottomActions.querySelector("[data-title-keyword-review-page-status]");
    const showMoreButtons = [...bottomActions.querySelectorAll("[data-title-keyword-review-show-more]")];
    const updateReviewSliceControls = () => {
      cardById.forEach((card) => {
        const index = Number(card.dataset.photoIndex || 0);
        card.hidden = index >= shownReviewCount;
      });
      const atEndOfLoadedWindow = shownReviewCount >= loadedReviewCount;
      showMoreButtons.forEach((button) => {
        button.disabled = atEndOfLoadedWindow;
      });
      if (pageStatus) {
        const extraText = totalReviewCount > loadedReviewCount
          ? ` ${formatCount(totalReviewCount - loadedReviewCount)} more remain after this loaded window.`
          : "";
        pageStatus.textContent = `Showing ${formatCount(shownReviewCount)} of ${formatCount(loadedReviewCount)} loaded.${extraText}`;
      }
      status.textContent = queueStatusText();
      setSelectedIds(selectedPhotoIds, selectionAnchorId);
      applyReviewLayout();
      scheduleThumbnailWarmup(currentVisiblePhotos());
    };
    showMoreButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const increment = Number(button.dataset.titleKeywordReviewShowMore || titleReviewShowMoreLargeCount);
        shownReviewCount = Math.min(loadedReviewCount, shownReviewCount + Math.max(1, increment));
        updateReviewSliceControls();
      });
    });

    const batchIdForCard = (card) => String(card?.dataset?.reviewBatchId || batchId || "").trim();

    const buildRowDecision = (photoId, card) => {
      const rowBatchId = batchIdForCard(card);
      const title = String(card.querySelector("[data-review-title]")?.value || "").trim();
      const keywordsRaw = String(card.querySelector("[data-review-keywords]")?.value || "");
      const keywords = normalizeKeywords(keywordsRaw, blacklist);
      const comment = String(card.querySelector("[data-review-reject-comment]")?.value || "").trim();
      const blocked = Boolean(card.querySelector("[data-review-block]")?.checked);
      const rejected = !blocked && Boolean(card.querySelector("[data-review-reject]")?.checked);
      const approved = !blocked && Boolean(card.querySelector("[data-review-approve]")?.checked) && !rejected;
      return {
        approval: approved ? { photo_id: photoId, batch_id: rowBatchId, approved: true, title, keywords } : null,
        rejection: rejected ? {
          photo_id: photoId,
          batch_id: rowBatchId,
          rejected: true,
          title,
          keywords,
          comment: commentWithRejectedProposalContext({ comment, title, keywords }),
        } : null,
        blocked: blocked ? { photo_id: photoId, batch_id: rowBatchId, blocked: true } : null,
        approved,
        rejected,
        blockedSelected: blocked,
      };
    };

    const buildApprovalsPayload = (action = "apply-title-keyword-review-approvals") => {
      const approvals = [];
      const rejections = [];
      const blocked = [];
      for (const [photoId, card] of cardById.entries()) {
        const decision = buildRowDecision(photoId, card);
        if (decision.approval) approvals.push(decision.approval);
        if (decision.rejection) rejections.push(decision.rejection);
        if (decision.blocked) blocked.push(decision.blocked);
      }
      return {
        action,
        batch_id: batchId,
        approvals,
        rejections,
        blocked,
      };
    };

    const setRowStatus = (card, message, state = "", detail = "") => {
      const rowStatus = card.querySelector("[data-review-row-status]");
      if (!rowStatus) return;
      rowStatus.textContent = message;
      rowStatus.dataset.state = state;
      rowStatus.title = detail || "";
      if (reviewCardId(card) === focusedPhotoId) updateCullPreviewPanel();
    };
    const setBlockedControlsDisabled = (card, disabled) => {
      card.querySelectorAll([
        "[data-review-title]",
        "[data-review-keywords]",
        "[data-review-approve]",
        "[data-review-reject]",
        "[data-review-reject-reason]",
        "[data-review-reject-comment]",
        "[data-review-block]",
      ].join(",")).forEach((input) => {
        input.disabled = Boolean(disabled);
      });
    };

    let activeCard = null;
    let focusedPhotoId = "";
    let selectionAnchorId = "";
    let selectedPhotoIds = new Set();
    let lastBlockBatchPhotoIds = [];
    const modeButtons = [...modebar.querySelectorAll("[data-title-review-mode]")];
    const densityInput = modebar.querySelector("[data-title-review-density]");
    const densityValue = modebar.querySelector("[data-title-review-density-value]");
    const fitModeButtons = [...modebar.querySelectorAll("[data-gallery-fit-mode]")];
    const importEditsButton = modebar.querySelector("[data-title-review-import-edits]");
    const selectionStatus = modebar.querySelector("[data-title-review-selection-count]");
    const titleReviewLayout = window.photosByElieGalleryLayout?.createMasonryController?.({
      root: list,
      getPhotos: currentVisiblePhotos,
      densityKey: titleReviewDensityKey,
      fitModeKey: titleReviewFitModeKey,
      defaultDensity: 7,
      defaultFitMode: "cull",
      allowCull: true,
      dimensionsFor: (item) => {
        const dimensions = item?.thumbs?.dimensions || item?.media?.publicPreview?.dimensions || item?.dimensions;
        return dimensions?.width && dimensions?.height
          ? { width: Number(dimensions.width), height: Number(dimensions.height) }
          : null;
      },
      isPanorama: (item) => {
        const dimensions = item?.thumbs?.dimensions || item?.media?.publicPreview?.dimensions || item?.dimensions;
        return Boolean(dimensions?.width && dimensions?.height && Number(dimensions.width) / Number(dimensions.height) >= 2.1);
      },
    });
    const editableSelector = "input, textarea, select, button, [contenteditable='true']";
    const isEditableEventTarget = (event) => {
      const target = event?.target;
      return target instanceof HTMLElement && Boolean(target.closest(editableSelector));
    };
    const reviewCards = () => [...cardById.values()].filter((card) => !card.hidden);
    const reviewCardId = (card) => String(card?.dataset?.reviewPhotoId || "").trim();
    const updateDetailHrefsForMode = () => {
      cardById.forEach((card, photoId) => {
        const href = detailHrefForReviewPhoto(photoId, reviewMode);
        card.dataset.reviewDetailHref = href;
        const link = card.querySelector(".title-keyword-review-preview");
        link?.setAttribute("href", href);
      });
    };
    const applyReviewLayout = () => {
      titleReviewLayout?.applyDensityControls?.({ input: densityInput, value: densityValue });
      titleReviewLayout?.applyFitMode?.(fitModeButtons);
      titleReviewLayout?.applyPreviewLayout?.(currentVisiblePhotos());
    };
    const previewForCard = (card) => card?.querySelector?.(".title-keyword-review-preview") || null;
    const isCardSavedBlocked = (card) => card?.dataset?.reviewBlockSaved === "1";
    const isCardBlockPending = (card) => card?.dataset?.reviewBlockPending === "1";
    const isCardBlockedOrPending = (card) => isCardSavedBlocked(card) || isCardBlockPending(card);
    const setCardBlockPending = (card, pending) => {
      if (!card) return;
      if (pending) card.dataset.reviewBlockPending = "1";
      else delete card.dataset.reviewBlockPending;
    };
    const setCardBlockedVisual = (card, state = "") => {
      const preview = previewForCard(card);
      const blocking = state === "blocking";
      const blocked = state === "blocked";
      card?.classList?.toggle("is-review-blocking", blocking);
      card?.classList?.toggle("is-review-blocked", blocked);
      preview?.classList?.toggle("is-review-blocking", blocking);
      preview?.classList?.toggle("is-review-blocked", blocked);
      if (reviewCardId(card) === focusedPhotoId) updateCullPreviewPanel();
    };
    const updateCullPreviewPanel = () => {
      if (!cullPanel) return;
      const card = focusedPhotoId ? cardById.get(focusedPhotoId) : activeCard;
      if (!card || reviewMode !== "cull") {
        cullPanel.hidden = true;
        cullPanel.replaceChildren();
        return;
      }
      const photoId = reviewCardId(card);
      const item = reviewItemById.get(photoId) || {};
      const isVideo = reviewItemIsVideo(item);
      const thumb = reviewThumbUrl(item);
      const proposedTitle = String(card.querySelector("[data-review-title]")?.value || item?.proposed?.title || item?.current?.title || photoId).trim();
      const proposedKeywords = String(card.querySelector("[data-review-keywords]")?.value || "").trim();
      const currentKeywords = Array.isArray(item?.current?.keywords)
        ? item.current.keywords.join(", ")
        : String(item?.current?.keywords_raw || "");
      const galleryLabel = String(item?.gallery?.label || item?.gallery_label || item?.gallery_key || "Review");
      const capture = String(item?.capture?.raw || item?.capture?.date || "");
      const rowState = String(card.querySelector("[data-review-row-status]")?.textContent || "Not saved").trim();
      const blockedState = card.classList.contains("is-review-blocking")
        ? "blocking"
        : card.classList.contains("is-review-blocked") || isCardSavedBlocked(card)
          ? "blocked"
          : "";
      const mediaClass = [
        "title-review-cull-panel-media",
        thumb ? "has-image" : "is-missing-preview",
        isVideo ? "is-video" : "",
        blockedState === "blocking" ? "is-review-blocking" : "",
        blockedState === "blocked" ? "is-review-blocked" : "",
      ].filter(Boolean).join(" ");
      cullPanel.hidden = false;
      cullPanel.innerHTML = `
        <div class="${mediaClass}">
          ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(proposedTitle || photoId)}" loading="eager" decoding="async"/>` : `<span class="unknown-missing-preview">No preview</span>`}
          ${isVideo ? `<span class="title-keyword-review-video-badge" aria-hidden="true">${window.photosByElieMdIcon?.("play") || "▶"}</span>` : ""}
        </div>
        <div class="title-review-cull-panel-copy">
          <p class="eyebrow">${escapeHtml(isVideo ? "Video" : "Photo")} / ${escapeHtml(galleryLabel)}${capture ? ` / ${escapeHtml(capture)}` : ""}</p>
          <h2>${escapeHtml(proposedTitle || photoId)}</h2>
          <p>${escapeHtml(proposedKeywords || currentKeywords || "No keywords")}</p>
          <dl>
            <div><dt>ID</dt><dd>${escapeHtml(photoId)}</dd></div>
            <div><dt>Status</dt><dd>${escapeHtml(rowState)}</dd></div>
          </dl>
        </div>
      `;
    };
    const selectionLabel = () => {
      const count = selectedPhotoIds.size;
      if (!count && focusedPhotoId) return `Focused ${focusedPhotoId}`;
      return `${count} selected`;
    };
    const syncSelectionClasses = () => {
      cardById.forEach((card, photoId) => {
        const focused = photoId === focusedPhotoId;
        const selected = selectedPhotoIds.has(photoId);
        card.classList.toggle("is-selected", focused);
        card.classList.toggle("is-focused", focused);
        card.classList.toggle("is-multi-selected", selected);
        card.setAttribute("aria-selected", selected ? "true" : "false");
      });
      if (selectionStatus) selectionStatus.textContent = selectionLabel();
      updateCullPreviewPanel();
    };
    const setSelectedIds = (ids, anchorId = selectionAnchorId) => {
      selectedPhotoIds = new Set([...ids].map((id) => String(id || "").trim()).filter((id) => id && cardById.has(id) && !cardById.get(id).hidden));
      selectionAnchorId = anchorId && cardById.has(anchorId) && !cardById.get(anchorId).hidden ? anchorId : (selectedPhotoIds.values().next().value || focusedPhotoId);
      syncSelectionClasses();
    };
    const setActiveCard = (card, { select = false, anchor = false } = {}) => {
      if (!card || activeCard === card) return;
      activeCard = card;
      focusedPhotoId = reviewCardId(card);
      if (anchor || !selectionAnchorId) selectionAnchorId = focusedPhotoId;
      if (select) setSelectedIds([focusedPhotoId], focusedPhotoId);
      syncSelectionClasses();
    };
    const selectedCardsForAction = () => [...selectedPhotoIds]
      .map((photoId) => cardById.get(photoId))
      .filter(Boolean);
    const targetCardsForAction = () => {
      const selectedCards = selectedCardsForAction();
      if (reviewMode === "cull" && selectedCards.length) return selectedCards;
      return activeCard ? [activeCard] : [];
    };
    const cardRange = (anchorId, targetId) => {
      const cards = reviewCards();
      const start = cards.findIndex((card) => reviewCardId(card) === anchorId);
      const end = cards.findIndex((card) => reviewCardId(card) === targetId);
      if (start < 0 || end < 0) return targetId ? [targetId] : [];
      const [from, to] = start <= end ? [start, end] : [end, start];
      return cards.slice(from, to + 1).map(reviewCardId);
    };
    const setRangeSelectionTo = (card) => {
      const targetId = reviewCardId(card);
      const anchorId = selectionAnchorId || focusedPhotoId || targetId;
      activeCard = card;
      focusedPhotoId = targetId;
      setSelectedIds(cardRange(anchorId, targetId), anchorId);
    };
    const toggleCardSelection = (card) => {
      const photoId = reviewCardId(card);
      if (!photoId) return;
      const next = new Set(selectedPhotoIds);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      activeCard = card;
      focusedPhotoId = photoId;
      setSelectedIds(next, selectionAnchorId || photoId);
    };
    const selectOnlyCard = (card) => {
      activeCard = card;
      focusedPhotoId = reviewCardId(card);
      setSelectedIds([focusedPhotoId], focusedPhotoId);
    };
    const updateReviewModeUrl = () => {
      const current = new URL(window.location.href);
      current.searchParams.set("view", "title-keywords");
      current.searchParams.set("mode", reviewMode);
      window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
    };
    const setReviewMode = (mode, { preserveScroll = true } = {}) => {
      const nextMode = normalizedReviewMode(mode) || "cull";
      const scrollY = window.scrollY;
      reviewMode = nextMode;
      root.dataset.titleReviewMode = reviewMode;
      list.dataset.reviewMode = reviewMode;
      modeButtons.forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.titleReviewMode === reviewMode ? "true" : "false");
      });
      updateDetailHrefsForMode();
      updateReviewModeUrl();
      applyReviewLayout();
      syncSelectionClasses();
      updateCullPreviewPanel();
      if (preserveScroll) {
        window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, left: 0, behavior: "auto" }));
      }
    };
    const toggleReviewMode = () => setReviewMode(reviewMode === "cull" ? "edit" : "cull");
    const stepReviewDensity = (direction) => {
      if (!titleReviewLayout) return null;
      const next = titleReviewLayout.setDensityColumns(titleReviewLayout.preferredDensityColumns() + direction);
      applyReviewLayout();
      return next;
    };
    const setReviewFitMode = (mode) => {
      if (!titleReviewLayout) return mode;
      const next = titleReviewLayout.setFitMode(mode);
      applyReviewLayout();
      return next;
    };
    const cycleReviewFitMode = () => {
      const modes = ["fit", "fill", "cull"];
      const current = titleReviewLayout?.fitMode?.() || "cull";
      return setReviewFitMode(modes[(Math.max(0, modes.indexOf(current)) + 1) % modes.length]);
    };
    const photoForPreviewCard = (card) => {
      const photoId = reviewCardId(card);
      return reviewDetailPhotoPayload(reviewItemById.get(photoId), card, blacklist, batchId)?.photo || null;
    };
    const previewItemsForReview = () => reviewCards().map(photoForPreviewCard).filter(Boolean);
    const previewIndexForCard = (card) => Math.max(0, reviewCards().findIndex((item) => item === card));
    const openPreviewForCard = (card) => {
      const previewPhoto = photoForPreviewCard(card);
      if (!previewPhoto) return;
      window.photosByElieOpenFinderPreview?.(previewPhoto, {
        owner: true,
        items: previewItemsForReview(),
        index: previewIndexForCard(card),
      });
    };
    modeButtons.forEach((button) => {
      button.addEventListener("click", () => setReviewMode(button.dataset.titleReviewMode || "cull"));
    });
    densityInput?.addEventListener("input", () => {
      if (!titleReviewLayout) return;
      titleReviewLayout.setDensityColumns(Number(densityInput.value));
      applyReviewLayout();
    });
    fitModeButtons.forEach((button) => {
      button.addEventListener("click", () => setReviewFitMode(button.dataset.galleryFitMode || "cull"));
    });
    importEditsButton?.addEventListener("click", async () => {
      const originalText = importEditsButton.textContent;
      importEditsButton.disabled = true;
      importEditsButton.textContent = "Importing...";
      try {
        const result = await window.photosByElieImportAllSourceEdits?.();
        window.dispatchEvent(new CustomEvent("photosbyelie:sourceeditimportall", { detail: result }));
        const skipped = Number(result?.skipped_count || 0);
        const imported = Number(result?.imported_count || 0);
        const suffix = skipped ? ` ${skipped} skipped.` : "";
        window.alert?.(`Imported ${imported} edited version${imported === 1 ? "" : "s"}.${suffix}`);
      } catch (error) {
        window.alert?.(String(error?.message || "Could not import exported edits."));
      } finally {
        importEditsButton.disabled = false;
        importEditsButton.textContent = originalText || "Import edits";
      }
    });
    const scrollCardIntoReview = (card, block = "nearest") => {
      if (!card) return;
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      card.focus?.({ preventScroll: true });
      card.scrollIntoView?.({
        block,
        inline: "nearest",
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    };
    const writeOwnerReviewReturnState = (card) => {
      const photoId = String(card?.dataset?.reviewPhotoId || "").trim();
      if (!photoId) return;
      try {
        const detailPayload = reviewDetailPhotoPayload(reviewItemById.get(photoId), card, blacklist, batchId);
        if (detailPayload) {
          sessionStorage.setItem(ownerReviewDetailPhotoStateKey, JSON.stringify(detailPayload));
        }
        sessionStorage.setItem(ownerReviewReturnStateKey, JSON.stringify({
          source: "owner-review",
          view: "title-keywords",
          mode: reviewMode,
          photoId,
          batchId: String(card?.dataset?.reviewBatchId || batchId || "").trim(),
          href: ownerReviewReturnHrefFor(photoId, window.scrollY),
          scrollY: window.scrollY,
          createdAt: Date.now(),
        }));
      } catch {
        // The detail URL still carries enough context to return to the review page.
      }
    };
    const openReviewDetail = (card) => {
      const href = card?.getAttribute("data-review-detail-href") || "";
      if (!href) return;
      writeOwnerReviewReturnState(card);
      window.location.assign(href);
    };
    const restorePendingOwnerReviewReturn = () => {
      const pendingReturn = pendingOwnerReviewReturn();
      if (!pendingReturn) return false;
      try {
        sessionStorage.removeItem(ownerReviewReturnStateKey);
      } catch {}
      clearOwnerReviewReturnUrl();
      if (pendingReturn.mode) setReviewMode(pendingReturn.mode, { preserveScroll: false });
      const targetCard = pendingReturn.photoId ? cardById.get(pendingReturn.photoId) : null;
      const scrollY = Number(pendingReturn.scrollY);
      if (targetCard) {
        if (reviewMode === "cull") selectOnlyCard(targetCard);
        else setActiveCard(targetCard);
        targetCard.focus?.({ preventScroll: true });
        window.requestAnimationFrame(() => {
          if (Number.isFinite(scrollY) && scrollY >= 0) {
            window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
            return;
          }
          scrollCardIntoReview(targetCard, "center");
        });
        return true;
      }
      if (Number.isFinite(scrollY) && scrollY > 0) {
        window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, left: 0, behavior: "auto" }));
        return true;
      }
      return false;
    };
    const moveActiveCard = (delta) => {
      const cards = [...cardById.values()];
      if (!cards.length) return;
      const currentIndex = Math.max(0, cards.indexOf(activeCard));
      const nextIndex = Math.max(0, Math.min(cards.length - 1, currentIndex + delta));
      const nextCard = cards[nextIndex];
      setActiveCard(nextCard);
      scrollCardIntoReview(nextCard);
    };
    const advanceAfterApprove = (card) => {
      const cards = reviewCards();
      const currentIndex = cards.indexOf(card);
      if (currentIndex < 0 || currentIndex >= cards.length - 1) return;
      const nextCard = cards[currentIndex + 1];
      setActiveCard(nextCard);
      scrollCardIntoReview(nextCard, "center");
    };

    const postApprovalsPayload = async (payload) => {
      const ok = await window.photosByElieOwnerAuth?.requireAuth?.("Owner helper unavailable.") ?? true;
      if (!ok) return null;
      const response = await fetch(approvalsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Could not save approvals.");
      }
      return result;
    };

    const postPhotoActionPayload = async (payload) => {
      const ok = await window.photosByElieOwnerAuth?.requireAuth?.("Owner helper unavailable.") ?? true;
      if (!ok) return null;
      const response = await fetch(approvalsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Could not ${payload?.action || "update"} photo.`);
      }
      return result;
    };
    const postPhotoActionMany = async (action, photoIds) => postPhotoActionPayload({ action, photo_ids: photoIds });

    const removeReviewCard = (photoId, card) => {
      cardById.delete(photoId);
      const nextCard = reviewCards().find((candidate) => candidate !== card && !candidate.hidden) || null;
      card.remove();
      if (activeCard === card) {
        activeCard = null;
        if (nextCard?.matches?.("[data-review-photo-id]")) setActiveCard(nextCard);
      }
      if (!cardById.size && status) status.textContent = "Queue is empty.";
    };

    const rowSaveTimers = new Map();
    const saveBlockedTargets = async (targets) => {
      targets.forEach(({ card }) => {
        card.dataset.reviewDecisionTouched = "1";
        setCardBlockPending(card, true);
        setCardBlockedVisual(card, "blocking");
        setRowStatus(card, "Blocking...", "saving");
      });
      const photoIds = targets.map(({ photoId }) => photoId);
      let hideResult = null;
      try {
        hideResult = await postPhotoActionMany("hide-many", photoIds);
      } catch (error) {
        const message = error?.message || "Could not block photo.";
        targets.forEach(({ card }) => {
          setCardBlockPending(card, false);
          setCardBlockedVisual(card, "");
          setRowStatus(card, "Block failed", "error", message);
        });
        throw error;
      }
      if (!hideResult) {
        targets.forEach(({ card }) => {
          setCardBlockPending(card, false);
          setCardBlockedVisual(card, "");
          setRowStatus(card, "Auth required", "error");
        });
        return null;
      }
      const confirmedIds = [
        ...(Array.isArray(hideResult.hidden_ids) ? hideResult.hidden_ids : []),
        ...(Array.isArray(hideResult.already_hidden) ? hideResult.already_hidden : []),
        ...(Array.isArray(hideResult.moved) ? hideResult.moved.map((item) => item?.photo_id) : []),
      ];
      const hiddenIds = new Set(confirmedIds.map((item) => String(item || "")).filter(Boolean));
      const notFound = new Set((hideResult.not_found || []).map((item) => String(item || "")));
      const savedTargets = targets.filter(({ photoId }) => hiddenIds.has(photoId));
      targets.forEach(({ card, photoId }) => {
        if (hiddenIds.has(photoId)) return;
        setCardBlockPending(card, false);
        setCardBlockedVisual(card, "");
        if (notFound.has(photoId)) {
          setRowStatus(card, "Not in catalog", "error", "Could not move this photo to the Waste Basket because the helper could not find it.");
          return;
        }
        setRowStatus(card, "Block failed", "error", "The helper did not confirm this photo moved to the Waste Basket.");
      });
      if (!savedTargets.length) return { count: 0, photoIds: [], result: null };
      let result = null;
      try {
        result = await postApprovalsPayload({
          action: "save-title-keyword-review-approvals",
          batch_id: batchId,
          approvals: [],
          rejections: [],
          blocked: savedTargets.map(({ decision }) => decision.blocked),
        });
      } catch (error) {
        const message = error?.message || "Could not save block review records.";
        savedTargets.forEach(({ card }) => setRowStatus(card, "Review save failed", "error", message));
        throw error;
      }
      if (!result) {
        savedTargets.forEach(({ card }) => setRowStatus(card, "Auth required", "error"));
        return null;
      }
      savedTargets.forEach(({ card }) => {
        const block = card.querySelector("[data-review-block]");
        card.classList.add("is-owner-actioned");
        setCardBlockPending(card, false);
        card.dataset.reviewBlockSaved = "1";
        setCardBlockedVisual(card, "blocked");
        setBlockedControlsDisabled(card, true);
        if (block) {
          block.checked = true;
          block.disabled = false;
        }
        setRowStatus(card, "Blocked", "saved");
      });
      return { count: savedTargets.length, photoIds: savedTargets.map(({ photoId }) => photoId), result };
    };

    const isAlreadyUnhiddenError = (error) => /photo not found in Hidden/i.test(String(error?.message || ""));

    const saveUnblockedTarget = async (photoId, card) => {
      window.clearTimeout(rowSaveTimers.get(photoId));
      setRowStatus(card, "Unblocking...", "saving");
      const block = card.querySelector("[data-review-block]");
      if (block) block.disabled = true;
      let restoreResult = null;
      let alreadyRestored = false;
      try {
        restoreResult = await postPhotoActionPayload({ action: "undo-hide", photo_id: photoId });
      } catch (error) {
        if (!isAlreadyUnhiddenError(error)) {
          const message = error?.message || "Could not restore photo from the Waste Basket.";
          if (block) {
            block.checked = true;
            block.disabled = false;
          }
          setRowStatus(card, "Unblock failed", "error", message);
          throw error;
        }
        alreadyRestored = true;
      }
      if (!restoreResult && !alreadyRestored) {
        setRowStatus(card, "Auth required", "error");
        return null;
      }
      let result = null;
      try {
        result = await postPhotoActionPayload({
          action: "clear-title-keyword-review-block",
          photo_id: photoId,
          batch_id: batchIdForCard(card),
        });
      } catch (error) {
        const message = error?.message || "Could not reopen this review row.";
        if (block) block.disabled = false;
        setRowStatus(card, "Review reopen failed", "error", message);
        throw error;
      }
      if (!result) {
        if (block) block.disabled = false;
        setRowStatus(card, "Auth required", "error");
        return null;
      }
      card.classList.remove("is-owner-actioned");
      setCardBlockPending(card, false);
      delete card.dataset.reviewBlockSaved;
      setCardBlockedVisual(card, "");
      setBlockedControlsDisabled(card, false);
      if (block) {
        block.checked = false;
        block.disabled = false;
      }
      setRowStatus(card, "Unblocked", "saved", "Restored from the Waste Basket and reopened in the title/keyword review queue.");
      if (status) status.textContent = `${photoId} restored from the Waste Basket and reopened for review.`;
      return { result, restoreResult };
    };

    const saveRowDecision = async (photoId, card) => {
      const decision = buildRowDecision(photoId, card);
      if (!decision.approval && !decision.rejection && !decision.blocked) {
        setRowStatus(card, "Not saved");
        return;
      }
      if (decision.blocked) {
        const result = await saveBlockedTargets([{ card, decision, photoId }]);
        if (result?.count && status) {
          status.textContent = `${photoId} blocked, moved to Waste Basket, and saved to this review record.`;
        } else if (status) {
          status.textContent = `${photoId} was not confirmed blocked.`;
        }
        return;
      }
      setRowStatus(card, "Saving...", "saving");
      const result = await postApprovalsPayload({
        action: "save-title-keyword-review-approvals",
        batch_id: batchId,
        approvals: decision.approval ? [decision.approval] : [],
        rejections: decision.rejection ? [decision.rejection] : [],
        blocked: [],
      });
      if (!result) {
        setRowStatus(card, "Auth required", "error");
        return;
      }
      const missing = new Set((result.not_found || []).map((item) => String(item || "")));
      if (missing.has(photoId)) {
        setRowStatus(card, "Not in catalog", "error", "Marked blocked in Owner state because the helper could not find this photo in the current catalog.");
        if (status) status.textContent = `${photoId} was marked blocked because it is not in the current catalog.`;
        return;
      }
      const label = decision.rejection ? "Rejected and saved" : "Approved and applied";
      setRowStatus(card, label, "saved");
      if (status) {
        status.textContent = decision.rejection
          ? `${photoId} rejection saved to the review record.`
          : `${photoId} approval applied to catalog metadata and saved to the review record.`;
      }
    };

    const scheduleRowSave = (photoId, card, delay = 500) => {
      window.clearTimeout(rowSaveTimers.get(photoId));
      setRowStatus(card, "Save pending...", "pending");
      rowSaveTimers.set(photoId, window.setTimeout(() => {
        saveRowDecision(photoId, card).catch((error) => {
          const message = error?.message || "Could not save row.";
          setRowStatus(card, "Save failed", "error", message);
          if (status) status.textContent = error?.message || "Could not save row.";
        });
      }, delay));
    };

    const saveCardsDecisions = async (cards) => {
      const approvals = [];
      const rejections = [];
      const targets = [];
      const blockedTargets = [];
      cards.forEach((card) => {
        const targetPhotoId = card.getAttribute("data-review-photo-id") || "";
        if (!targetPhotoId) return;
        window.clearTimeout(rowSaveTimers.get(targetPhotoId));
        const decision = buildRowDecision(targetPhotoId, card);
        if (!decision.approval && !decision.rejection && !decision.blocked) {
          setRowStatus(card, "Not saved");
          return;
        }
        if (decision.blocked && isCardSavedBlocked(card)) {
          setCardBlockedVisual(card, "blocked");
          setRowStatus(card, "Blocked", "saved");
          return;
        }
        if (decision.blocked) {
          setCardBlockPending(card, true);
          blockedTargets.push({ card, decision, photoId: targetPhotoId });
          setCardBlockedVisual(card, "blocking");
          setRowStatus(card, "Blocking...", "saving");
          return;
        }
        if (decision.approval) approvals.push(decision.approval);
        if (decision.rejection) rejections.push(decision.rejection);
        targets.push({ card, decision, photoId: targetPhotoId });
        setRowStatus(card, "Saving...", "saving");
      });
      if (!targets.length && !blockedTargets.length) return { count: 0 };
      let result = null;
      if (targets.length) {
        result = await postApprovalsPayload({
          action: "save-title-keyword-review-approvals",
          batch_id: batchId,
          approvals,
          rejections,
          blocked: [],
        });
        if (!result) {
          targets.forEach(({ card }) => setRowStatus(card, "Auth required", "error"));
          return null;
        }
        const missing = new Set((result.not_found || []).map((item) => String(item || "")));
        targets.forEach(({ card, decision, photoId }) => {
          if (missing.has(photoId)) {
            setRowStatus(card, "Not in catalog", "error", "Marked blocked in Owner state because the helper could not find this photo in the current catalog.");
            return;
          }
          setRowStatus(card, decision.rejection ? "Rejected and saved" : "Approved and applied", "saved");
        });
      }
      const blockedResult = blockedTargets.length ? await saveBlockedTargets(blockedTargets) : null;
      return {
        count: targets.length + (blockedResult?.count || 0),
        approvals: approvals.length,
        rejections: rejections.length,
        blocked: blockedResult?.count || 0,
        blockedPhotoIds: blockedResult?.photoIds || [],
        result,
        blockedResult,
      };
    };

    const cardsInShootWindow = (sourceCard) => {
      const cards = [...cardById.values()];
      const sourceIndex = cards.indexOf(sourceCard);
      if (sourceIndex === -1) return [sourceCard];
      const sourceTime = Number(sourceCard.dataset.reviewCaptureTime || "");
      const sourceGallery = String(sourceCard.dataset.reviewGalleryKey || "");
      if (!Number.isFinite(sourceTime)) return [sourceCard];
      return cards.filter((card, index) => {
        if (index < sourceIndex) return false;
        const cardTime = Number(card.dataset.reviewCaptureTime || "");
        if (!Number.isFinite(cardTime)) return false;
        const cardGallery = String(card.dataset.reviewGalleryKey || "");
        if (sourceGallery && cardGallery && sourceGallery !== cardGallery) return false;
        return Math.abs(cardTime - sourceTime) <= shootWindowMs;
      });
    };

    const metadataFieldConfig = {
      title: {
        selector: "[data-review-title]",
        label: "title",
      },
      keywords: {
        selector: "[data-review-keywords]",
        label: "keywords",
      },
    };

    const markCardApprovedForMetadata = (targetCard) => {
      targetCard.dataset.reviewDecisionTouched = "1";
      const targetApprove = targetCard.querySelector("[data-review-approve]");
      const targetReject = targetCard.querySelector("[data-review-reject]");
      const targetBlock = targetCard.querySelector("[data-review-block]");
      const targetComment = targetCard.querySelector("[data-review-reject-comment]");
      if (targetApprove) targetApprove.checked = true;
      if (targetReject) targetReject.checked = false;
      if (targetBlock) targetBlock.checked = false;
      setCardBlockedVisual(targetCard, "");
      setRejectReasonValue(targetCard, "");
      setRejectReasonsDisabled(targetCard, true);
      targetComment?.closest("label")?.classList.add("is-disabled");
      if (targetComment) targetComment.readOnly = true;
    };

    const propagateMetadataField = (field, card) => {
      const config = metadataFieldConfig[field];
      if (!config) return;
      const sourceInput = card.querySelector(config.selector);
      if (!sourceInput) return;
      const value = String(sourceInput.value || "");
      const targets = cardsInShootWindow(card).filter((targetCard) => targetCard.querySelector(config.selector));
      targets.forEach((targetCard) => {
        const targetInput = targetCard.querySelector(config.selector);
        const targetPhotoId = targetCard.getAttribute("data-review-photo-id") || "";
        if (targetInput) targetInput.value = value;
        if (targetPhotoId) window.clearTimeout(rowSaveTimers.get(targetPhotoId));
        markCardApprovedForMetadata(targetCard);
        setRowStatus(targetCard, "Saving...", "saving");
      });
      if (status) status.textContent = `Propagated proposed ${config.label} to ${targets.length} current/following same-shoot rows; saving as approvals.`;
      saveCardsDecisions(targets).then((result) => {
        if (result && status) status.textContent = `Propagated proposed ${config.label} to ${result.count} current/following same-shoot rows.`;
      }).catch((error) => {
        const message = error?.message || `Could not save propagated ${config.label}.`;
        targets.forEach((targetCard) => setRowStatus(targetCard, "Save failed", "error", message));
        if (status) status.textContent = message;
      });
    };

    const propagateDecision = (photoId, card) => {
      const sourceDecision = buildRowDecision(photoId, card);
      if (!sourceDecision.approval && !sourceDecision.rejection && !sourceDecision.blocked) {
        window.alert?.("Choose Approve, Reject, or Block before propagating.");
        return;
      }
      const sourceComment = String(card.querySelector("[data-review-reject-comment]")?.value || "");
      const sourceRejectReason = checkedRejectReasonValue(card);
      const targets = cardsInShootWindow(card);
      targets.forEach((targetCard) => {
        const targetPhotoId = targetCard.getAttribute("data-review-photo-id") || "";
        targetCard.dataset.reviewDecisionTouched = "1";
        const targetApprove = targetCard.querySelector("[data-review-approve]");
        const targetReject = targetCard.querySelector("[data-review-reject]");
        const targetBlock = targetCard.querySelector("[data-review-block]");
        const targetComment = targetCard.querySelector("[data-review-reject-comment]");
        if (sourceDecision.approval) {
          if (targetApprove) targetApprove.checked = true;
          if (targetReject) targetReject.checked = false;
          if (targetBlock) targetBlock.checked = false;
          setCardBlockedVisual(targetCard, "");
          setRejectReasonValue(targetCard, "");
          setRejectReasonsDisabled(targetCard, true);
        } else if (sourceDecision.rejection) {
          if (targetApprove) targetApprove.checked = false;
          if (targetReject) targetReject.checked = true;
          if (targetBlock) targetBlock.checked = false;
          setCardBlockedVisual(targetCard, "");
          setRejectReasonsDisabled(targetCard, false);
          setRejectReasonValue(targetCard, sourceRejectReason);
          if (targetComment) {
            targetComment.value = sourceComment;
          }
        } else {
          if (targetApprove) targetApprove.checked = false;
          if (targetReject) targetReject.checked = false;
          if (targetBlock) targetBlock.checked = true;
          setCardBlockedVisual(targetCard, "blocking");
          setRejectReasonValue(targetCard, "");
          setRejectReasonsDisabled(targetCard, true);
        }
        targetComment?.closest("label")?.classList.toggle("is-disabled", Boolean(sourceDecision.approval || sourceDecision.blocked));
        if (targetComment) targetComment.readOnly = Boolean(sourceDecision.approval || sourceDecision.blocked);
      });
      const propagatedLabel = sourceDecision.blocked ? "block" : sourceDecision.rejection ? "reject + note" : "approve";
      if (status) status.textContent = `Propagated ${propagatedLabel} to ${targets.length} current/following same-shoot rows; saving as one batch.`;
      saveCardsDecisions(targets).then((result) => {
        if (result && status) status.textContent = `Propagated and saved ${result.count} current/following same-shoot rows.`;
      }).catch((error) => {
        const message = error?.message || "Could not save propagated rows.";
        targets.forEach((targetCard) => setRowStatus(targetCard, "Save failed", "error", message));
        if (status) status.textContent = message;
      });
    };

    const blockPhoto = (photoId, card) => {
      const block = card.querySelector("[data-review-block]");
      if (!block) return;
      card.dataset.reviewDecisionTouched = "1";
      setCardBlockPending(card, true);
      block.checked = true;
      block.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const markCardsApproved = (cards, { advance = false } = {}) => {
      const skipped = cards.filter(isCardBlockedOrPending).length;
      cards = cards.filter((card) => !isCardBlockedOrPending(card));
      if (skipped && status) status.textContent = `${skipped} blocked media item${skipped === 1 ? "" : "s"} kept blocked. Press U to unblock before approving.`;
      if (!cards.length) return;
      cards.forEach((card) => {
        card.dataset.reviewDecisionTouched = "1";
        const approve = card.querySelector("[data-review-approve]");
        const reject = card.querySelector("[data-review-reject]");
        const block = card.querySelector("[data-review-block]");
        const comment = card.querySelector("[data-review-reject-comment]");
        if (approve) approve.checked = true;
        if (reject) reject.checked = false;
        if (block) block.checked = false;
        setCardBlockedVisual(card, "");
        if (comment) {
          comment.readOnly = true;
          comment.closest("label")?.classList.add("is-disabled");
        }
        setRejectReasonValue(card, "");
        setRejectReasonsDisabled(card, true);
        setRowStatus(card, "Saving...", "saving");
      });
      saveCardsDecisions(cards).then((result) => {
        if (result && status) status.textContent = `${result.approvals || result.count || cards.length} approval${cards.length === 1 ? "" : "s"} applied.`;
      }).catch((error) => {
        const message = error?.message || "Could not save approval.";
        cards.forEach((card) => setRowStatus(card, "Save failed", "error", message));
        if (status) status.textContent = message;
      });
      if (advance && cards.length === 1) advanceAfterApprove(cards[0]);
    };

    const markCardsRejected = (cards) => {
      const skipped = cards.filter(isCardBlockedOrPending).length;
      cards = cards.filter((card) => !isCardBlockedOrPending(card));
      if (skipped && status) status.textContent = `${skipped} blocked media item${skipped === 1 ? "" : "s"} kept blocked. Press U to unblock before rejecting.`;
      if (!cards.length) return;
      const defaultReason = "incorrect";
      const defaultNote = rejectReasonByValue.get(defaultReason)?.note || "this title is incorrect";
      const note = window.prompt?.(`Reject ${cards.length} selected media item${cards.length === 1 ? "" : "s"} with note:`, defaultNote);
      if (note === null) return;
      const cleanNote = String(note || "").trim() || defaultNote;
      const reasonValue = rejectReasonValueForComment(cleanNote) || "other";
      cards.forEach((card) => {
        card.dataset.reviewDecisionTouched = "1";
        const approve = card.querySelector("[data-review-approve]");
        const reject = card.querySelector("[data-review-reject]");
        const block = card.querySelector("[data-review-block]");
        const comment = card.querySelector("[data-review-reject-comment]");
        if (approve) approve.checked = false;
        if (reject) reject.checked = true;
        if (block) block.checked = false;
        setCardBlockedVisual(card, "");
        setRejectReasonsDisabled(card, false);
        setRejectReasonValue(card, reasonValue);
        if (comment) {
          comment.readOnly = false;
          comment.value = cleanNote;
          comment.closest("label")?.classList.remove("is-disabled");
        }
        setRowStatus(card, "Saving...", "saving");
      });
      saveCardsDecisions(cards).then((result) => {
        if (result && status) status.textContent = `${result.rejections || cards.length} rejection${cards.length === 1 ? "" : "s"} saved.`;
      }).catch((error) => {
        const message = error?.message || "Could not save rejection.";
        cards.forEach((card) => setRowStatus(card, "Save failed", "error", message));
        if (status) status.textContent = message;
      });
    };

    const markCardsBlocked = (cards) => {
      const alreadyBlocked = cards.filter(isCardBlockedOrPending).length;
      cards = cards.filter((card) => !isCardBlockedOrPending(card));
      if (!cards.length) {
        if (status) status.textContent = `${alreadyBlocked || 1} media item${alreadyBlocked === 1 ? "" : "s"} already blocked. Press U to unblock the last block batch.`;
        return;
      }
      if (alreadyBlocked && status) status.textContent = `${alreadyBlocked} already-blocked media item${alreadyBlocked === 1 ? "" : "s"} left unchanged; blocking the rest.`;
      cards.forEach((card) => {
        card.dataset.reviewDecisionTouched = "1";
        setCardBlockPending(card, true);
        const approve = card.querySelector("[data-review-approve]");
        const reject = card.querySelector("[data-review-reject]");
        const block = card.querySelector("[data-review-block]");
        const comment = card.querySelector("[data-review-reject-comment]");
        if (approve) approve.checked = false;
        if (reject) reject.checked = false;
        if (block) block.checked = true;
        setCardBlockedVisual(card, "blocking");
        if (comment) {
          comment.readOnly = true;
          comment.closest("label")?.classList.add("is-disabled");
        }
        setRejectReasonValue(card, "");
        setRejectReasonsDisabled(card, true);
        setRowStatus(card, "Blocking...", "saving");
      });
      saveCardsDecisions(cards).then((result) => {
        const blockedIds = result?.blockedPhotoIds || [];
        if (blockedIds.length) {
          lastBlockBatchPhotoIds = blockedIds;
          if (status) status.textContent = `${blockedIds.length} media item${blockedIds.length === 1 ? "" : "s"} moved to Waste Basket. Press U to undo this block batch.`;
          return;
        }
        lastBlockBatchPhotoIds = [];
        if (status) status.textContent = "No selected media item was confirmed blocked.";
      }).catch((error) => {
        const message = error?.message || "Could not block media item.";
        cards.forEach((card) => {
          setCardBlockPending(card, false);
          setCardBlockedVisual(card, "");
          setRowStatus(card, "Block failed", "error", message);
        });
        if (status) status.textContent = message;
      });
    };

    const undoLastBlockBatch = () => {
      const targets = lastBlockBatchPhotoIds
        .map((photoId) => ({ photoId, card: cardById.get(photoId) }))
        .filter(({ card }) => Boolean(card));
      if (!targets.length) {
        if (status) status.textContent = "No title review block batch to undo.";
        return;
      }
      Promise.all(targets.map(({ photoId, card }) => saveUnblockedTarget(photoId, card))).then(() => {
        if (status) status.textContent = `Restored ${targets.length} media item${targets.length === 1 ? "" : "s"} from the Waste Basket.`;
        lastBlockBatchPhotoIds = [];
      }).catch((error) => {
        if (status) status.textContent = error?.message || "Could not undo block batch.";
      });
    };

    const approveAll = () => {
      const cards = reviewCards();
      cards.forEach((card) => {
        if (isCardSavedBlocked(card)) {
          setCardBlockedVisual(card, "blocked");
          setRowStatus(card, "Blocked", "saved");
          return;
        }
        card.dataset.reviewDecisionTouched = "1";
        const checkbox = card.querySelector("[data-review-approve]");
        if (checkbox) checkbox.checked = true;
        const reject = card.querySelector("[data-review-reject]");
        if (reject) reject.checked = false;
        const block = card.querySelector("[data-review-block]");
        if (block) block.checked = false;
        setCardBlockedVisual(card, "");
        setRejectReasonValue(card, "");
        setRejectReasonsDisabled(card, true);
        const comment = card.querySelector("[data-review-reject-comment]");
        if (comment) {
          comment.readOnly = true;
          comment.closest("label")?.classList.add("is-disabled");
        }
      });
      if (status) status.textContent = `${cards.length} visible photos selected for approval; saving as one batch.`;
      saveCardsDecisions(cards).then((result) => {
        if (result && status) status.textContent = `${result.count} visible approvals saved.`;
      }).catch((error) => {
        const message = error?.message || "Could not save visible approvals.";
        cards.forEach((card) => setRowStatus(card, "Save failed", "error", message));
        if (status) status.textContent = message;
      });
    };

    const saveApprovals = async () => {
      const payload = buildApprovalsPayload();
      if (!payload.approvals.length && !payload.rejections.length && !payload.blocked.length) {
        window.alert?.("Select at least one photo to approve, reject, or block.");
        return;
      }
      const confirmed = window.confirm?.(
        `Apply ${payload.approvals.length} approvals, save ${payload.rejections.length} rejections, and block ${payload.blocked.length} photos?\n\n` +
        "Approved rows update catalog metadata. Rejected rows are prioritized for a new proposal. Blocked rows move to the Waste Basket. JPG/source files, public previews, private masters, and render files will not be changed directly by title/keyword approval.",
      ) ?? true;
      if (!confirmed) return;
      const result = await saveCardsDecisions(reviewCards());
      if (!result) return;
      const saveResult = result.result || result.blockedResult?.result || {};
      window.alert?.(
        `Applied ${saveResult.applied_count || payload.approvals.length} approvals to catalog metadata files.\n` +
        `Saved ${result.rejections || payload.rejections.length} rejections for proposal rework.\n` +
        `Moved ${result.blocked || 0} photos to the Waste Basket.\n` +
        `Saved review record to ${saveResult.path || "assets/owner-actions/title-keyword-review-queue/"}.\n\n` +
        "Run validation and commit the metadata changes when ready.",
      );
    };

    const downloadApprovals = () => {
      const payload = buildApprovalsPayload();
      if (!payload.approvals.length && !payload.rejections.length && !payload.blocked.length) {
        window.alert?.("Select at least one photo to approve, reject, or block.");
        return;
      }
      downloadJson(`title-keyword-review-approvals-${batchId}.json`, payload);
    };

    cardById.forEach((card, photoId) => {
      const approve = card.querySelector("[data-review-approve]");
      const reject = card.querySelector("[data-review-reject]");
      const rejectReasonInputs = [...card.querySelectorAll("[data-review-reject-reason]")];
      const rejectReasonOptions = [...card.querySelectorAll("[data-review-reject-option]")];
      const comment = card.querySelector("[data-review-reject-comment]");
      const titleInput = card.querySelector("[data-review-title]");
      const keywordInput = card.querySelector("[data-review-keywords]");
      const propagateFieldButtons = [...card.querySelectorAll("[data-review-propagate-field]")];
      const propagate = card.querySelector("[data-review-propagate]");
      const block = card.querySelector("[data-review-block]");
      const previousRejectReason = card.dataset.reviewPreviousRejectReason || "";
      if (approve) approve.checked = false;
      if (reject) reject.checked = false;
      if (block) block.checked = false;
      setRejectReasonValue(card, previousRejectReason);
      card.addEventListener("click", (event) => {
        const previewLink = event.target instanceof HTMLElement ? event.target.closest(".title-keyword-review-preview") : null;
        if (previewLink) event.preventDefault();
        if (reviewMode === "cull" && !isEditableEventTarget(event)) {
          if (event.shiftKey) setRangeSelectionTo(card);
          else if (event.metaKey || event.ctrlKey) toggleCardSelection(card);
          else selectOnlyCard(card);
          return;
        }
        setActiveCard(card);
      });
      card.addEventListener("focusin", () => setActiveCard(card));
      card.addEventListener("dblclick", (event) => {
        if (isEditableEventTarget(event)) return;
        openReviewDetail(card);
      });
      card.addEventListener("contextmenu", (event) => {
        if (isEditableEventTarget(event)) return;
        window.photosByElieShowMediaContextMenu?.(photoForPreviewCard(card), event, {
          owner: true,
          previewItems: previewItemsForReview(),
          previewIndex: previewIndexForCard(card),
          onOpenDetail: () => openReviewDetail(card),
        });
      });
      const syncDecisionState = () => {
        const approved = Boolean(approve?.checked);
        const blocked = Boolean(block?.checked);
        const disabled = approved || blocked;
        if (comment) {
          comment.readOnly = disabled;
          comment.closest("label")?.classList.toggle("is-disabled", disabled);
        }
        setRejectReasonsDisabled(card, disabled);
      };
      const markDecisionTouched = () => {
        card.dataset.reviewDecisionTouched = "1";
      };
      const resetRestoredDecisionState = () => {
        if (card.dataset.reviewDecisionTouched === "1") return;
        window.clearTimeout(rowSaveTimers.get(photoId));
        if (isCardBlockPending(card)) {
          if (block) block.checked = true;
          setCardBlockedVisual(card, "blocking");
          syncDecisionState();
          setRowStatus(card, "Blocking...", "saving");
          return;
        }
        if (isCardSavedBlocked(card)) {
          if (block) block.checked = true;
          setCardBlockedVisual(card, "blocked");
          syncDecisionState();
          setRowStatus(card, "Blocked", "saved");
          return;
        }
        if (approve) approve.checked = false;
        if (reject) reject.checked = false;
        if (block) block.checked = false;
        setCardBlockedVisual(card, "");
        setRejectReasonValue(card, previousRejectReason);
        syncDecisionState();
        setRowStatus(card, "Not saved");
      };
      approve?.closest("label")?.addEventListener("pointerdown", markDecisionTouched);
      block?.closest("label")?.addEventListener("pointerdown", markDecisionTouched);
      [approve, block].forEach((input) => {
        input?.addEventListener("keydown", (event) => {
          if (event.key === " " || event.key === "Enter") markDecisionTouched();
        });
      });
      const fillRejectReasonNote = (value = "") => {
        const reason = rejectReasonByValue.get(value || checkedRejectReasonValue(card));
        if (!reason || !comment) return;
        comment.value = reason.note;
      };
      const activateReject = ({ reasonValue = "", fillNote = false, saveDelay = null } = {}) => {
        markDecisionTouched();
        if (approve?.checked) approve.checked = false;
        if (block?.checked) block.checked = false;
        setCardBlockedVisual(card, "");
        if (reject) reject.checked = true;
        if (reasonValue) setRejectReasonValue(card, reasonValue);
        if (fillNote) {
          fillRejectReasonNote(reasonValue);
        } else if (!checkedRejectReasonValue(card) && !String(comment?.value || "").trim()) {
          setRejectReasonValue(card, "incorrect");
          fillRejectReasonNote("incorrect");
        }
        syncDecisionState();
        if (saveDelay !== null) scheduleRowSave(photoId, card, saveDelay);
      };
      const activateApproveFromEdit = () => {
        markDecisionTouched();
        if (reject?.checked) reject.checked = false;
        if (block?.checked) block.checked = false;
        setCardBlockedVisual(card, "");
        if (approve) approve.checked = true;
        syncDecisionState();
        scheduleRowSave(photoId, card);
      };
      const activateRejectFromComment = () => {
        if (!checkedRejectReasonValue(card)) setRejectReasonValue(card, "other");
        activateReject();
      };
      approve?.addEventListener("change", () => {
        if (card.dataset.reviewDecisionTouched !== "1") {
          resetRestoredDecisionState();
          return;
        }
        if (approve.checked) {
          if (reject) reject.checked = false;
          if (block) block.checked = false;
          setCardBlockedVisual(card, "");
          setRejectReasonValue(card, "");
        }
        syncDecisionState();
        if (approve.checked) {
          scheduleRowSave(photoId, card, 150);
          advanceAfterApprove(card);
        } else {
          setRowStatus(card, "Not saved");
        }
      });
      reject?.addEventListener("change", () => {
        if (card.dataset.reviewDecisionTouched !== "1") {
          resetRestoredDecisionState();
          return;
        }
        if (reject.checked) activateReject({ saveDelay: 150 });
        else setRowStatus(card, "Not saved");
      });
      block?.addEventListener("change", () => {
        if (card.dataset.reviewDecisionTouched !== "1") {
          resetRestoredDecisionState();
          return;
        }
        if (block.checked) {
          setCardBlockPending(card, true);
          if (approve) approve.checked = false;
          if (reject) reject.checked = false;
          setCardBlockedVisual(card, "blocking");
          setRejectReasonValue(card, "");
          syncDecisionState();
          scheduleRowSave(photoId, card, 150);
        } else {
          if (card.dataset.reviewBlockSaved === "1") {
            saveUnblockedTarget(photoId, card).catch((error) => {
              const message = error?.message || "Could not unblock photo.";
              setRowStatus(card, "Unblock failed", "error", message);
              if (status) status.textContent = message;
            });
            return;
          }
          syncDecisionState();
          setCardBlockPending(card, false);
          setCardBlockedVisual(card, "");
          setRowStatus(card, "Not saved");
        }
      });
      const chooseRejectReason = (input) => {
        if (!input || input.disabled) return;
        markDecisionTouched();
        activateReject({ reasonValue: input.value, fillNote: true, saveDelay: 150 });
      };
      rejectReasonOptions.forEach((option) => {
        option.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          chooseRejectReason(option.querySelector("[data-review-reject-reason]"));
        });
        option.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          chooseRejectReason(option.querySelector("[data-review-reject-reason]"));
        });
      });
      rejectReasonInputs.forEach((input) => {
        input.addEventListener("keydown", (event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          chooseRejectReason(input);
        });
      });
      comment?.addEventListener("input", () => {
        activateRejectFromComment();
        scheduleRowSave(photoId, card);
        syncDecisionState();
      });
      comment?.addEventListener("focus", activateRejectFromComment);
      comment?.addEventListener("pointerdown", activateRejectFromComment);
      titleInput?.addEventListener("input", activateApproveFromEdit);
      keywordInput?.addEventListener("input", activateApproveFromEdit);
      propagateFieldButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          propagateMetadataField(button.getAttribute("data-review-propagate-field") || "", card);
        });
      });
      propagate?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        propagateDecision(photoId, card);
      });
      syncDecisionState();
      window.setTimeout(resetRestoredDecisionState, 0);
      window.setTimeout(resetRestoredDecisionState, 500);
      window.setTimeout(resetRestoredDecisionState, 1500);
    });

    const firstCard = cardById.values().next().value;
    if (firstCard) {
      setActiveCard(firstCard);
      if (reviewMode === "cull") selectOnlyCard(firstCard);
    }
    setReviewMode(reviewMode, { preserveScroll: false });
    updateReviewSliceControls();
    restorePendingOwnerReviewReturn();

    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event) || !activeCard) return;
      const key = event.key.toLowerCase();
      const cards = reviewCards();
      const activeIndex = Math.max(0, cards.indexOf(activeCard));
      const columns = Math.max(1, titleReviewLayout?.preferredDensityColumns?.() || 1);
      const moveFocus = (delta) => {
        const nextIndex = Math.max(0, Math.min(cards.length - 1, activeIndex + delta));
        const nextCard = cards[nextIndex];
        if (!nextCard) return;
        if (event.shiftKey && reviewMode === "cull") setRangeSelectionTo(nextCard);
        else if (reviewMode === "cull") selectOnlyCard(nextCard);
        else setActiveCard(nextCard);
        scrollCardIntoReview(nextCard);
      };
      if (event.key === "ArrowDown") {
        moveFocus(reviewMode === "cull" ? columns : 1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowRight") {
        moveFocus(1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp") {
        moveFocus(reviewMode === "cull" ? -columns : -1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowLeft") {
        moveFocus(-1);
        event.preventDefault();
        return;
      }
      if (event.key === " ") {
        openPreviewForCard(activeCard);
        event.preventDefault();
        return;
      }
      if (event.key === "Enter") {
        openReviewDetail(activeCard);
        event.preventDefault();
        return;
      }
      if (key === "e") {
        toggleReviewMode();
        event.preventDefault();
        return;
      }
      if (event.key === "g" || event.key === "G") {
        const next = stepReviewDensity(event.key === "G" ? 1 : -1);
        if (status && next) status.textContent = `Cull grid ${next}.`;
        event.preventDefault();
        return;
      }
      if (key === "z") {
        const nextMode = cycleReviewFitMode();
        if (status && nextMode) status.textContent = `Cull layout ${nextMode}.`;
        event.preventDefault();
        return;
      }
      if (key === "a") {
        const targets = targetCardsForAction();
        if (!targets.length) {
          if (status) status.textContent = "Focus or select media to approve.";
          event.preventDefault();
          return;
        }
        markCardsApproved(targets, { advance: reviewMode === "edit" });
        event.preventDefault();
        return;
      }
      if (key === "r") {
        const targets = targetCardsForAction();
        if (!targets.length) {
          if (status) status.textContent = "Focus or select media to reject.";
          event.preventDefault();
          return;
        }
        markCardsRejected(targets);
        event.preventDefault();
        return;
      }
      if (key === "p") {
        propagateDecision(reviewCardId(activeCard), activeCard);
        event.preventDefault();
        return;
      }
      if (key === "u") {
        undoLastBlockBatch();
        event.preventDefault();
        return;
      }
      if (key === "h" || key === "x" || key === "b") {
        const targets = targetCardsForAction();
        if (!targets.length) {
          if (status) status.textContent = "Focus or select media to block.";
          event.preventDefault();
          return;
        }
        if (reviewMode === "edit" && targets.length === 1) {
          blockPhoto(reviewCardId(activeCard), activeCard);
        } else {
          markCardsBlocked(targets);
        }
        event.preventDefault();
      }
    });

    document.querySelectorAll("[data-title-keyword-review-approve-all]").forEach((button) => {
      button.addEventListener("click", approveAll);
    });
    document.querySelectorAll("[data-title-keyword-review-save]").forEach((button) => {
      button.addEventListener("click", () => {
        saveApprovals().catch((error) => {
          window.alert?.(error?.message || "Could not save approvals.");
        });
      });
    });
    document.querySelectorAll("[data-title-keyword-review-download]").forEach((button) => {
      button.addEventListener("click", downloadApprovals);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => render().catch((error) => {
      if (status) status.textContent = error?.message || "Could not load queue.";
    }), { once: true });
  } else {
    render().catch((error) => {
      if (status) status.textContent = error?.message || "Could not load queue.";
    });
  }
})();
