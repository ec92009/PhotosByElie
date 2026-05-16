(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const enabled = localHosts.has(window.location.hostname);

  const status = document.querySelector("[data-title-keyword-review-status]");
  const lockedPanel = document.querySelector("[data-title-keyword-review-locked]");
  const summaryRoot = document.querySelector("[data-title-keyword-review-summary]");
  const root = document.querySelector("[data-title-keyword-review-root]");

  const queueUrl = "./assets/owner-actions/title-keyword-review-queue/latest.json";
  const blacklistUrl = "./assets/owner-actions/keyword-blacklist.json";
  const approvalsEndpoint = "/__photosbyelie/photo-action";

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

  const keywordBlacklistSet = (payload) => {
    const keywords = payload?.keywords;
    if (!Array.isArray(keywords)) return new Set();
    return new Set(keywords.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  };

  const normalizeKeywords = (raw, blacklist) => uniqueKeywords(splitKeywordText(raw))
    .filter((keyword) => !blacklist.has(keyword.toLowerCase()));

  const publicMediaUrl = (key) => {
    const base = String(window.photosByEliePublicMediaBase || "").replace(/\/+$/, "");
    const cleanKey = String(key || "").replace(/^\/+/, "");
    return base && cleanKey ? `${base}/${cleanKey}` : "";
  };

  const reviewThumbUrl = (item) => {
    const key = item?.thumbs?.gallery_key || item?.thumbs?.galleryKey || item?.thumbs?.detail_key || item?.thumbs?.detailKey;
    return publicMediaUrl(key);
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

    const [queue, blacklistPayload] = await Promise.all([
      loadJson(queueUrl),
      loadJson(blacklistUrl).catch(() => ({ keywords: [] })),
    ]);

    const batchId = String(queue?.batch_id || queue?.batchId || "").trim();
    const photos = Array.isArray(queue?.photos) ? queue.photos : [];
    const blacklist = keywordBlacklistSet(blacklistPayload);
    const shootWindowMs = 2 * 60 * 60 * 1000;

    if (!batchId || !photos.length) {
      status.textContent = "Queue is empty.";
      summaryRoot.hidden = true;
      root.replaceChildren();
      return;
    }

    const approvalRecord = await loadJson(`./assets/owner-actions/title-keyword-review-queue/approvals-${encodeURIComponent(batchId)}.json`)
      .catch(() => ({}));
    const savedIds = savedReviewIds(approvalRecord);
    const visiblePhotos = photos.filter((item) => {
      const photoId = String(item?.photo_id || item?.photoId || "");
      return photoId && !savedIds.has(photoId);
    });
    const newest = queue?.range?.newest || "";
    const oldest = queue?.range?.oldest || "";
    status.textContent = visiblePhotos.length
      ? `${visiblePhotos.length} photos ready for review.`
      : "All rows in this batch are already saved.";

    summaryRoot.hidden = false;
    summaryRoot.innerHTML = `
      <h2>Batch ${escapeHtml(batchId)}</h2>
      <p class="gallery-status">Newest: ${escapeHtml(newest || "—")} • Oldest: ${escapeHtml(oldest || "—")}</p>
      <div class="cta title-keyword-review-actions">
        <button class="btn secondary" type="button" data-title-keyword-review-approve-all>Approve visible</button>
        <button class="btn secondary" type="button" data-title-keyword-review-save>Apply selected</button>
        <button class="btn secondary" type="button" data-title-keyword-review-download>Export selected JSON</button>
        <a class="btn secondary" href="${escapeHtml(queueUrl)}" target="_blank" rel="noreferrer">Open proposal JSON</a>
      </div>
      <p class="gallery-status">Rows autosave as soon as you approve, reject, block, or edit. Apply selected updates catalog metadata for checked approvals and queues checked rejections for rework.</p>
    `;

    root.replaceChildren();
    const list = document.createElement("div");
    list.className = "title-keyword-review-list";
    root.append(list);

    const cardById = new Map();

    list.innerHTML = visiblePhotos.map((item, index) => {
      const photoId = String(item?.photo_id || item?.photoId || "");
      const title = String(item?.current?.title || "");
      const capture = String(item?.capture?.raw || item?.capture?.date || "");
      const galleryLabel = String(item?.gallery?.label || item?.gallery_label || item?.gallery_key || "");
      const galleryKey = String(item?.gallery?.key || item?.gallery_key || item?.gallery?.label || galleryLabel || "");
      const captureTime = parseCaptureTime(capture);
      const thumb = reviewThumbUrl(item);
      const fetchPriority = index < 12 ? "high" : "low";
      const currentKeywords = Array.isArray(item?.current?.keywords) ? item.current.keywords.join(", ") : String(item?.current?.keywords_raw || "");
      const proposedTitle = String(item?.proposed?.title || title || "");
      const proposedKeywords = normalizeKeywords(
        Array.isArray(item?.proposed?.keywords) ? item.proposed.keywords.join(", ") : currentKeywords,
        blacklist,
      ).join(", ");
      const href = versionedHref(`./photo.html?id=${encodeURIComponent(photoId)}`);
      return `
        <article class="title-keyword-review-row" data-review-photo-id="${escapeHtml(photoId)}" data-review-gallery-key="${escapeHtml(galleryKey)}" data-review-capture-time="${Number.isFinite(captureTime) ? String(captureTime) : ""}" data-review-detail-href="${escapeHtml(href)}" tabindex="0">
          <a class="title-keyword-review-preview ${thumb ? "has-image" : "is-missing-preview"}" href="${escapeHtml(href)}" aria-label="Open photo ${escapeHtml(photoId)}">
            ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(title || photoId)}" loading="eager" decoding="async" fetchpriority="${fetchPriority}"/>` : `<span class="unknown-missing-preview">No preview</span>`}
          </a>
          <div class="title-keyword-review-current">
            <p class="eyebrow">${escapeHtml(galleryLabel || "Photo")}${capture ? ` / ${escapeHtml(capture)}` : ""}</p>
            <h2>${escapeHtml(title || photoId)}</h2>
            <p>${escapeHtml(currentKeywords || "No current keywords")}</p>
          </div>
          <form class="title-keyword-review-proposed" data-review-editor>
              <label>
                <span>Proposed title</span>
                <input type="text" value="${escapeHtml(proposedTitle)}" data-review-title/>
              </label>
              <label>
                <span>Proposed keywords</span>
                <textarea rows="3" data-review-keywords>${escapeHtml(proposedKeywords)}</textarea>
              </label>
          </form>
          <div class="title-keyword-review-approve title-keyword-review-decision">
            <label>
              <input type="checkbox" data-review-approve/>
              <span>Approve</span>
            </label>
            <label>
              <input type="checkbox" data-review-reject/>
              <span>Reject</span>
            </label>
            <label class="title-keyword-review-reject-comment">
              <span>Reject note</span>
              <textarea rows="2" data-review-reject-comment placeholder="What should change?"></textarea>
            </label>
            <p class="title-keyword-review-row-status" data-review-row-status>Not saved</p>
            <div class="title-keyword-review-row-tools">
              <button type="button" data-review-propagate title="Apply this row's approve/reject choice to the same two-hour shoot window">Propagate</button>
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

    const buildRowDecision = (photoId, card) => {
      const title = String(card.querySelector("[data-review-title]")?.value || "").trim();
      const keywordsRaw = String(card.querySelector("[data-review-keywords]")?.value || "");
      const keywords = normalizeKeywords(keywordsRaw, blacklist);
      const comment = String(card.querySelector("[data-review-reject-comment]")?.value || "").trim();
      const rejected = Boolean(card.querySelector("[data-review-reject]")?.checked);
      const approved = Boolean(card.querySelector("[data-review-approve]")?.checked) && !rejected;
      return {
        approval: approved ? { photo_id: photoId, approved: true, title, keywords } : null,
        rejection: rejected ? { photo_id: photoId, rejected: true, title, keywords, comment } : null,
        approved,
        rejected,
      };
    };

    const buildApprovalsPayload = (action = "apply-title-keyword-review-approvals") => {
      const approvals = [];
      const rejections = [];
      for (const [photoId, card] of cardById.entries()) {
        const decision = buildRowDecision(photoId, card);
        if (decision.approval) approvals.push(decision.approval);
        if (decision.rejection) rejections.push(decision.rejection);
      }
      return {
        action,
        batch_id: batchId,
        approvals,
        rejections,
      };
    };

    const setRowStatus = (card, message, state = "", detail = "") => {
      const rowStatus = card.querySelector("[data-review-row-status]");
      if (!rowStatus) return;
      rowStatus.textContent = message;
      rowStatus.dataset.state = state;
      rowStatus.title = detail || "";
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
    const moveActiveCard = (delta) => {
      const cards = [...cardById.values()];
      if (!cards.length) return;
      const currentIndex = Math.max(0, cards.indexOf(activeCard));
      const nextIndex = Math.max(0, Math.min(cards.length - 1, currentIndex + delta));
      const nextCard = cards[nextIndex];
      setActiveCard(nextCard);
      nextCard?.focus?.({ preventScroll: true });
      nextCard?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
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

    const postPhotoAction = async (action, photoId) => {
      const ok = await window.photosByElieOwnerAuth?.requireAuth?.("Owner helper unavailable.") ?? true;
      if (!ok) return null;
      const response = await fetch(approvalsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, photo_id: photoId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Could not ${action} photo.`);
      }
      return result;
    };

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
    const saveRowDecision = async (photoId, card) => {
      const decision = buildRowDecision(photoId, card);
      if (!decision.approval && !decision.rejection) {
        setRowStatus(card, "Not saved");
        return;
      }
      setRowStatus(card, "Saving...", "saving");
      const result = await postApprovalsPayload({
        action: "save-title-keyword-review-approvals",
        batch_id: batchId,
        approvals: decision.approval ? [decision.approval] : [],
        rejections: decision.rejection ? [decision.rejection] : [],
      });
      if (!result) {
        setRowStatus(card, "Auth required", "error");
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

    const cardsInShootWindow = (sourceCard) => {
      const sourceTime = Number(sourceCard.dataset.reviewCaptureTime || "");
      const sourceGallery = String(sourceCard.dataset.reviewGalleryKey || "");
      if (!Number.isFinite(sourceTime)) return [sourceCard];
      return [...cardById.values()].filter((card) => {
        const cardTime = Number(card.dataset.reviewCaptureTime || "");
        if (!Number.isFinite(cardTime)) return false;
        const cardGallery = String(card.dataset.reviewGalleryKey || "");
        if (sourceGallery && cardGallery && sourceGallery !== cardGallery) return false;
        return Math.abs(cardTime - sourceTime) <= shootWindowMs;
      });
    };

    const propagateDecision = (photoId, card) => {
      const sourceDecision = buildRowDecision(photoId, card);
      if (!sourceDecision.approved && !sourceDecision.rejected) {
        window.alert?.("Choose Approve or Reject before propagating.");
        return;
      }
      const sourceComment = String(card.querySelector("[data-review-reject-comment]")?.value || "");
      const targets = cardsInShootWindow(card);
      targets.forEach((targetCard) => {
        const targetPhotoId = targetCard.getAttribute("data-review-photo-id") || "";
        const targetApprove = targetCard.querySelector("[data-review-approve]");
        const targetReject = targetCard.querySelector("[data-review-reject]");
        const targetComment = targetCard.querySelector("[data-review-reject-comment]");
        if (sourceDecision.approved) {
          if (targetApprove) targetApprove.checked = true;
          if (targetReject) targetReject.checked = false;
        } else {
          if (targetApprove) targetApprove.checked = false;
          if (targetReject) targetReject.checked = true;
          if (targetComment && sourceComment && !String(targetComment.value || "").trim()) {
            targetComment.value = sourceComment;
          }
        }
        targetComment?.closest("label")?.classList.toggle("is-disabled", sourceDecision.approved);
        if (targetComment) targetComment.readOnly = sourceDecision.approved;
        if (targetPhotoId) scheduleRowSave(targetPhotoId, targetCard, 150);
      });
      if (status) status.textContent = `Propagated ${sourceDecision.rejected ? "reject" : "approve"} to ${targets.length} same-shoot rows.`;
    };

    const blockPhoto = (photoId, card) => {
      setRowStatus(card, "Blocking...", "saving");
      postPhotoAction("hide", photoId).then((result) => {
        if (!result) {
          setRowStatus(card, "Auth required", "error");
          return;
        }
        return postApprovalsPayload({
          action: "save-title-keyword-review-approvals",
          batch_id: batchId,
          approvals: [],
          rejections: [],
          blocked: [{ photo_id: photoId, blocked: true }],
        }).then(() => {
          card.classList.add("is-owner-actioned");
          setRowStatus(card, "Basketed", "saved");
          removeReviewCard(photoId, card);
          if (status) status.textContent = `${photoId} moved to Waste Basket and saved to this review record.`;
        });
      }).catch((error) => {
        setRowStatus(card, "Block failed", "error");
        if (status) status.textContent = error?.message || "Could not block photo.";
      });
    };

    const approveAll = () => {
      cardById.forEach((card, photoId) => {
        const checkbox = card.querySelector("[data-review-approve]");
        if (checkbox) checkbox.checked = true;
        const reject = card.querySelector("[data-review-reject]");
        if (reject) reject.checked = false;
        if (photoId) scheduleRowSave(photoId, card, 150);
      });
      if (status) status.textContent = `${cardById.size} visible photos selected for approval and queued for autosave.`;
    };

    const saveApprovals = async () => {
      const payload = buildApprovalsPayload();
      if (!payload.approvals.length && !payload.rejections.length) {
        window.alert?.("Select at least one photo to approve or reject.");
        return;
      }
      const confirmed = window.confirm?.(
        `Apply ${payload.approvals.length} approvals and save ${payload.rejections.length} rejections?\n\n` +
        "Approved rows update catalog metadata. Rejected rows are prioritized for a new proposal. JPG/source files, public previews, private masters, and render files will not be changed.",
      ) ?? true;
      if (!confirmed) return;
      const result = await postApprovalsPayload(payload);
      if (!result) return;
      window.alert?.(
        `Applied ${result.applied_count || payload.approvals.length} approvals to catalog metadata files.\n` +
        `Saved ${result.rejected_count || payload.rejections.length} rejections for proposal rework.\n` +
        `Saved approval record to ${result.path || "assets/owner-actions/title-keyword-review-queue/"}.\n\n` +
        "Run validation and commit the metadata changes when ready.",
      );
    };

    const downloadApprovals = () => {
      const payload = buildApprovalsPayload();
      if (!payload.approvals.length && !payload.rejections.length) {
        window.alert?.("Select at least one photo to approve or reject.");
        return;
      }
      downloadJson(`title-keyword-review-approvals-${batchId}.json`, payload);
    };

    cardById.forEach((card, photoId) => {
      const approve = card.querySelector("[data-review-approve]");
      const reject = card.querySelector("[data-review-reject]");
      const comment = card.querySelector("[data-review-reject-comment]");
      const titleInput = card.querySelector("[data-review-title]");
      const keywordInput = card.querySelector("[data-review-keywords]");
      const propagate = card.querySelector("[data-review-propagate]");
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
        if (!comment) return;
        const approved = Boolean(approve?.checked);
        comment.readOnly = approved;
        comment.closest("label")?.classList.toggle("is-disabled", approved);
      };
      const activateApproveFromEdit = () => {
        if (reject?.checked) reject.checked = false;
        if (approve) approve.checked = true;
        syncDecisionState();
        scheduleRowSave(photoId, card);
      };
      const activateRejectFromComment = () => {
        if (approve?.checked) approve.checked = false;
        if (reject) reject.checked = true;
        syncDecisionState();
      };
      approve?.addEventListener("change", () => {
        if (approve.checked && reject) reject.checked = false;
        syncDecisionState();
        if (approve.checked) scheduleRowSave(photoId, card, 150);
        else setRowStatus(card, "Not saved");
      });
      reject?.addEventListener("change", () => {
        if (reject.checked && approve) approve.checked = false;
        syncDecisionState();
        if (reject.checked) scheduleRowSave(photoId, card, 150);
        else setRowStatus(card, "Not saved");
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
      propagate?.addEventListener("click", () => propagateDecision(photoId, card));
      syncDecisionState();
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
        if (approve) approve.checked = true;
        if (reject) reject.checked = false;
        if (comment) {
          comment.readOnly = true;
          comment.closest("label")?.classList.add("is-disabled");
        }
        scheduleRowSave(photoId, activeCard, 150);
        event.preventDefault();
        return;
      }
      if (key === "r") {
        if (approve) approve.checked = false;
        if (reject) reject.checked = true;
        if (comment) {
          comment.readOnly = false;
          comment.closest("label")?.classList.remove("is-disabled");
        }
        scheduleRowSave(photoId, activeCard, 150);
        event.preventDefault();
        return;
      }
      if (key === "p") {
        propagateDecision(photoId, activeCard);
        event.preventDefault();
        return;
      }
      if (key === "h" || key === "x") {
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
