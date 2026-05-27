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
    const newest = queue?.range?.newest || "";
    const oldest = queue?.range?.oldest || "";
    status.textContent = visiblePhotos.length
      ? `${visiblePhotos.length} photos ready for review.`
      : "All rows in this batch are already saved.";

    summaryRoot.hidden = false;
    const summaryHeading = reviewScope === "all-pending"
      ? `All pending proposals${pendingBatchCount ? ` (${pendingBatchCount} batches)` : ""}`
      : `Batch ${batchId}`;

    summaryRoot.innerHTML = `
      <h2>${escapeHtml(summaryHeading)}</h2>
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
    const list = document.createElement("div");
    list.className = "title-keyword-review-list";
    root.append(list);

    const cardById = new Map();

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
      const href = versionedHref(`./photo.html?id=${encodeURIComponent(photoId)}`);
      const previewClasses = [
        "title-keyword-review-preview",
        thumb ? "has-image" : "is-missing-preview",
        isVideo ? "is-video" : "",
      ].filter(Boolean).join(" ");
      return `
        <article class="title-keyword-review-row" data-review-photo-id="${escapeHtml(photoId)}" data-review-batch-id="${escapeHtml(photoBatchId)}" data-review-gallery-key="${escapeHtml(galleryKey)}" data-review-capture-time="${Number.isFinite(captureTime) ? String(captureTime) : ""}" data-review-detail-href="${escapeHtml(href)}" data-review-previous-reject-reason="${escapeHtml(previousRejectReason)}" tabindex="0">
          <a class="${previewClasses}" href="${escapeHtml(href)}" aria-label="Open ${isVideo ? "video" : "photo"} ${escapeHtml(photoId)}">
            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(title || photoId)}" loading="eager" decoding="async" fetchpriority="${fetchPriority}"/>` : `<span class="unknown-missing-preview">No preview</span>`}
            ${isVideo ? `<span class="title-keyword-review-video-badge" aria-hidden="true">${window.photosByElieMdIcon?.("play") || "▶"}</span>` : ""}
          </a>
          <div class="title-keyword-review-current">
            <p class="eyebrow">${escapeHtml(galleryLabel || "Photo")}${capture ? ` / ${escapeHtml(capture)}` : ""}</p>
            <h2>${escapeHtml(title || photoId)}</h2>
            <p>${currentKeywordsHtml}</p>
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

    scheduleThumbnailWarmup(visiblePhotos);

    list.querySelectorAll("[data-review-photo-id]").forEach((card) => {
      const photoId = card.getAttribute("data-review-photo-id") || "";
      if (!photoId) return;
      cardById.set(photoId, card);
    });
    const bottomActions = document.createElement("div");
    bottomActions.className = "title-keyword-review-bottom-actions";
    bottomActions.innerHTML = `
      <button class="btn secondary" type="button" data-title-keyword-review-approve-all>Approve visible</button>
      <button class="btn secondary" type="button" data-title-keyword-review-save>Apply selected</button>
      <button class="btn secondary" type="button" data-title-keyword-review-download>Export selected JSON</button>
    `;
    root.append(bottomActions);

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
    const editableSelector = "input, textarea, select, button, [contenteditable='true']";
    const isEditableEventTarget = (event) => {
      const target = event?.target;
      return target instanceof HTMLElement && Boolean(target.closest(editableSelector));
    };
    const setActiveCard = (card) => {
      if (!card || activeCard === card) return;
      activeCard?.classList.remove("is-selected");
      activeCard = card;
      activeCard.classList.add("is-selected");
    };
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
      const cards = [...cardById.values()];
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
      const nextCard = card.nextElementSibling || card.previousElementSibling;
      card.remove();
      if (activeCard === card) {
        activeCard = null;
        if (nextCard?.matches?.("[data-review-photo-id]")) setActiveCard(nextCard);
      }
      if (!cardById.size && status) status.textContent = "Queue is empty.";
    };

    const rowSaveTimers = new Map();
    const saveBlockedTargets = async (targets) => {
      targets.forEach(({ card }) => setRowStatus(card, "Blocking...", "saving"));
      const photoIds = targets.map(({ photoId }) => photoId);
      let hideResult = null;
      try {
        hideResult = await postPhotoActionMany("hide-many", photoIds);
      } catch (error) {
        const message = error?.message || "Could not block photo.";
        targets.forEach(({ card }) => setRowStatus(card, "Block failed", "error", message));
        throw error;
      }
      if (!hideResult) {
        targets.forEach(({ card }) => setRowStatus(card, "Auth required", "error"));
        return null;
      }
      const hiddenIds = new Set((hideResult.hidden_ids || []).map((item) => String(item || "")));
      const notFound = new Set((hideResult.not_found || []).map((item) => String(item || "")));
      const savedTargets = targets.filter(({ photoId }) => hiddenIds.has(photoId));
      targets.forEach(({ card, photoId }) => {
        if (hiddenIds.has(photoId)) return;
        if (notFound.has(photoId)) {
          setRowStatus(card, "Not in catalog", "error", "Could not move this photo to the Waste Basket because the helper could not find it.");
          return;
        }
        setRowStatus(card, "Block failed", "error", "The helper did not confirm this photo moved to the Waste Basket.");
      });
      if (!savedTargets.length) return { count: 0, result: null };
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
        card.dataset.reviewBlockSaved = "1";
        setBlockedControlsDisabled(card, true);
        if (block) {
          block.checked = true;
          block.disabled = false;
        }
        setRowStatus(card, "Blocked", "saved");
      });
      return { count: savedTargets.length, result };
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
      delete card.dataset.reviewBlockSaved;
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
        if (result && status) status.textContent = `${photoId} blocked, moved to Waste Basket, and saved to this review record.`;
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
        if (decision.blocked) {
          blockedTargets.push({ card, decision, photoId: targetPhotoId });
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
          setRejectReasonValue(targetCard, "");
          setRejectReasonsDisabled(targetCard, true);
        } else if (sourceDecision.rejection) {
          if (targetApprove) targetApprove.checked = false;
          if (targetReject) targetReject.checked = true;
          if (targetBlock) targetBlock.checked = false;
          setRejectReasonsDisabled(targetCard, false);
          setRejectReasonValue(targetCard, sourceRejectReason);
          if (targetComment) {
            targetComment.value = sourceComment;
          }
        } else {
          if (targetApprove) targetApprove.checked = false;
          if (targetReject) targetReject.checked = false;
          if (targetBlock) targetBlock.checked = true;
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
      block.checked = true;
      block.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const approveAll = () => {
      cardById.forEach((card, photoId) => {
        card.dataset.reviewDecisionTouched = "1";
        const checkbox = card.querySelector("[data-review-approve]");
        if (checkbox) checkbox.checked = true;
        const reject = card.querySelector("[data-review-reject]");
        if (reject) reject.checked = false;
        const block = card.querySelector("[data-review-block]");
        if (block) block.checked = false;
        setRejectReasonValue(card, "");
        setRejectReasonsDisabled(card, true);
        const comment = card.querySelector("[data-review-reject-comment]");
        if (comment) {
          comment.readOnly = true;
          comment.closest("label")?.classList.add("is-disabled");
        }
      });
      if (status) status.textContent = `${cardById.size} visible photos selected for approval; saving as one batch.`;
      saveCardsDecisions([...cardById.values()]).then((result) => {
        if (result && status) status.textContent = `${result.count} visible approvals saved.`;
      }).catch((error) => {
        const message = error?.message || "Could not save visible approvals.";
        cardById.forEach((card) => setRowStatus(card, "Save failed", "error", message));
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
      const result = await saveCardsDecisions([...cardById.values()]);
      if (!result) return;
      const saveResult = result.result || result.blockedResult?.result || {};
      window.alert?.(
        `Applied ${saveResult.applied_count || payload.approvals.length} approvals to catalog metadata files.\n` +
        `Saved ${result.rejections || payload.rejections.length} rejections for proposal rework.\n` +
        `Moved ${result.blocked || payload.blocked.length} photos to the Waste Basket.\n` +
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
        setActiveCard(card);
      });
      card.addEventListener("focusin", () => setActiveCard(card));
      card.addEventListener("dblclick", (event) => {
        if (isEditableEventTarget(event)) return;
        const href = card.getAttribute("data-review-detail-href");
        if (href) window.location.assign(href);
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
        if (approve) approve.checked = false;
        if (reject) reject.checked = false;
        if (block) block.checked = false;
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
          if (approve) approve.checked = false;
          if (reject) reject.checked = false;
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
    if (firstCard) setActiveCard(firstCard);

    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event) || !activeCard) return;
      const photoId = activeCard.getAttribute("data-review-photo-id") || "";
      const key = event.key.toLowerCase();
      const approve = activeCard.querySelector("[data-review-approve]");
      const reject = activeCard.querySelector("[data-review-reject]");
      const block = activeCard.querySelector("[data-review-block]");
      const comment = activeCard.querySelector("[data-review-reject-comment]");
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        moveActiveCard(1);
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        moveActiveCard(-1);
        event.preventDefault();
        return;
      }
      if (key === "a") {
        activeCard.dataset.reviewDecisionTouched = "1";
        if (approve) approve.checked = true;
        if (reject) reject.checked = false;
        if (block) block.checked = false;
        if (comment) {
          comment.readOnly = true;
          comment.closest("label")?.classList.add("is-disabled");
        }
        setRejectReasonsDisabled(activeCard, true);
        scheduleRowSave(photoId, activeCard, 150);
        advanceAfterApprove(activeCard);
        event.preventDefault();
        return;
      }
      if (key === "r") {
        activeCard.dataset.reviewDecisionTouched = "1";
        if (reject) {
          reject.checked = true;
          reject.dispatchEvent(new Event("change", { bubbles: true }));
        }
        event.preventDefault();
        return;
      }
      if (key === "p") {
        propagateDecision(photoId, activeCard);
        event.preventDefault();
        return;
      }
      if (key === "h" || key === "x") {
        activeCard.dataset.reviewDecisionTouched = "1";
        blockPhoto(photoId, activeCard);
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
